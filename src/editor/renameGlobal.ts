// Renaming a global function, macro, variable or class across the project.
// Lisp names the symbol and reads every candidate token; the user looks the
// result over in the search panel before any file changes.

import * as actions from "../actions";
import { applyEdits, candidates } from "../lisp/globalRename";
import { badName } from "../lisp/rename";
import type { Op } from "../protocol/Op";
import { get, set, type RenamePlan, type RenameSpot } from "../store";

async function lispText(op: Op): Promise<string> {
  const r = await actions.lisp(op);
  return r.kind === "text" ? r.text : "";
}

const outside = (file: string, root: string) => !file.startsWith(root.endsWith("/") ? root : `${root}/`);

/**
 * Works out the rename of the global symbol written as `token` in `pkg` to
 * `newName`, and shows it in the search panel. Returns why it cannot, or null.
 */
export async function planGlobalRename(token: string, pkg: string, newName: string): Promise<string | null> {
  const root = get().status.project?.root;
  if (!root) return "Open a project to rename across it.";
  if (get().status.session.state !== "ready") return "Lisp is not running, and a rename across the project needs it to read the code.";
  const bad = badName(newName);
  if (bad) return bad;

  const target = await lispText({ op: "renameTarget", token, package: pkg });
  if (!target.includes("\n")) return target.replace(/^error: /, "") || "Lisp could not name the symbol.";
  const [home, name] = target.split("\n");
  const symbol = `${home}::${name}`;

  const defs = await actions.lisp({ op: "findDefinitions", name: token, package: pkg });
  const files = defs.kind === "definitions" ? defs.items.map((d) => d.location?.file).filter((f): f is string => !!f) : [];
  if (files.length === 0) return `Lisp has no record of where ${token} is defined. Load the system that defines it first.`;
  const far = files.find((f) => outside(f, root));
  if (far) return `${token} is also defined in ${far}, outside this project, so ZParen does not rename it.`;

  const conflict = await lispText({ op: "renameConflict", home, name, newName });
  if (conflict) return conflict;

  const found = await actions.request({ type: "search", query: { pattern: name, regex: false, caseSensitive: false, wholeWord: false } });
  if (found.type !== "search") return "The project search failed.";
  const texts = await Promise.all(found.files.map(async (f) => ({ path: f.path, text: await actions.readText(f.path) })));
  const perFile = texts.flatMap(({ path, text }) => (text === null ? [] : [{ path, text, cands: candidates(text, path, name) }]));
  const lines = perFile.flatMap((f) => f.cands.map((c) => `${c.pkg}\t${c.designator ? 1 : 0}\t${c.token}`));
  const verdicts = lines.length ? await lispText({ op: "renameMatches", home, name, tokens: lines.join("\n") }) : "";

  let i = 0;
  const plan: RenamePlan = {
    symbol,
    newName,
    truncated: found.truncated,
    files: perFile
      .map(({ path, text, cands }) => {
        const spots: RenameSpot[] = [];
        for (const c of cands) {
          const v = verdicts[i++];
          if (v !== "y" && v !== "?") continue;
          const lineStart = text.lastIndexOf("\n", c.from - 1) + 1;
          const lineEnd = text.indexOf("\n", c.from);
          spots.push({
            from: c.from,
            to: c.to,
            line: text.slice(0, c.from).split("\n").length,
            column: c.from - lineStart,
            lineText: text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd),
            sure: v === "y",
            checked: v === "y",
          });
        }
        return { path, text, spots };
      })
      .filter((f) => f.spots.length > 0),
  };
  if (plan.files.length === 0) return `Found no uses of ${symbol} in the project.`;
  set({ renamePlan: plan, sidebar: "search" });
  return null;
}

/** Ticks or unticks one place in the rename waiting in the search panel. */
export function toggleSpot(path: string, from: number) {
  const plan = get().renamePlan;
  if (!plan) return;
  const files = plan.files.map((f) =>
    f.path !== path ? f : { ...f, spots: f.spots.map((s) => (s.from === from ? { ...s, checked: !s.checked } : s)) },
  );
  set({ renamePlan: { ...plan, files } });
}

/** Writes the ticked changes, after checking no file changed since the preview. */
export async function applyGlobalRename() {
  const plan = get().renamePlan;
  if (!plan) return;
  const changes = plan.files.map((f) => ({ ...f, spots: f.spots.filter((s) => s.checked) })).filter((f) => f.spots.length);
  const unsaved = get().tabs.filter((t) => changes.some((f) => f.path === t.path) && t.text !== t.saved);
  if (unsaved.length) return actions.flash(`Save ${unsaved.map((t) => t.name).join(", ")} before renaming.`, "error");
  for (const f of changes) {
    if ((await actions.readText(f.path)) !== f.text) {
      return actions.flash(`${f.path.split("/").pop()} changed since the preview. Press F2 to rename again.`, "error");
    }
  }
  for (const f of changes) {
    const content = applyEdits(f.text, f.spots.map((s) => ({ from: s.from, to: s.to, insert: plan.newName })));
    await actions.request({ type: "writeFile", path: f.path, content });
  }
  await actions.syncWithDisk(changes.map((f) => f.path));
  set({ renamePlan: null });
  const count = changes.reduce((n, f) => n + f.spots.length, 0);
  actions.flash(`Renamed ${plan.symbol} to ${plan.newName} in ${count} place${count === 1 ? "" : "s"} in ${changes.length} file${changes.length === 1 ? "" : "s"}.`);
}
