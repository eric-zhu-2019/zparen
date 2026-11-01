import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import * as actions from "../actions";
import { backend } from "../backend";
import { type Edit, localRename, renameLocal } from "../lisp/rename";
import { get } from "../store";
import { bufferPackage } from "./commands";
import { planGlobalRename } from "./renameGlobal";
import { showInline } from "./inline";

/**
 * The symbol being renamed: where it is, and its name as written. A global one
 * also has its whole token, package prefix included, and the package it is read in.
 */
type Target = { pos: number; from: number; to: number; text: string; global?: { token: string; pkg: string } };

const open = StateEffect.define<Target | null>();

const target = StateField.define<Target | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(open)) return e.value;
    // Positions mean nothing once the text changes under the box.
    return tr.docChanged ? null : value;
  },
  provide: (field) => showTooltip.from(field, (t): Tooltip | null => (t ? { pos: t.from, above: false, create: (view) => renameBox(view, t) } : null)),
});

function close(view: EditorView) {
  view.dispatch({ effects: open.of(null) });
  view.focus();
}

function renameBox(view: EditorView, t: Target) {
  const dom = document.createElement("div");
  dom.className = "cm-rename";
  const input = document.createElement("input");
  input.value = t.text;
  input.spellcheck = false;
  input.setAttribute("aria-label", `Rename ${t.text}`);
  const error = document.createElement("div");
  error.className = "cm-rename-error";
  error.setAttribute("role", "alert");
  dom.append(input, error);
  // After Lisp finds the renamed code expands differently, Return again renames anyway.
  let override: string | null = null;
  let busy = false;
  const renameGlobal = async (global: { token: string; pkg: string }) => {
    busy = true;
    error.textContent = "Finding every use in the project…";
    const why = await planGlobalRename(global.token, global.pkg, input.value.trim());
    busy = false;
    if (view.state.field(target) !== t) return;
    if (why) error.textContent = why;
    else close(view);
  };
  const rename = async () => {
    if (t.global) return renameGlobal(t.global);
    const name = input.value.trim();
    const text = view.state.doc.toString();
    const r = renameLocal(text, t.pos, name);
    if (!r.ok) return void (error.textContent = r.reason);
    let unchecked: string | null = null;
    if (r.edits.length && override !== name) {
      busy = true;
      error.textContent = "Checking with Lisp…";
      const verdict = await checkRename(view, text, r.edits, r.owner);
      busy = false;
      if (view.state.doc.toString() !== text || view.state.field(target) !== t) return;
      if (verdict === "different") {
        override = name;
        error.textContent = "Lisp expands the renamed code differently, so this rename could change what the code does. Press Return again to rename anyway.";
        return;
      }
      if (verdict !== "same") unchecked = verdict;
    }
    view.dispatch({ changes: r.edits, effects: open.of(null), userEvent: "rename", scrollIntoView: true });
    view.focus();
    if (unchecked) actions.flash(`Renamed. Lisp did not check it: ${unchecked}`);
  };
  input.addEventListener("keydown", (e) => {
    // The box owns its keys, so Vim and the window shortcuts never see them.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close(view);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!busy) void rename();
    }
  });
  input.addEventListener("input", () => {
    error.textContent = "";
    override = null;
  });
  input.addEventListener("blur", () => setTimeout(() => !busy && view.state.field(target) === t && close(view)));
  return {
    dom,
    mount() {
      input.focus();
      input.select();
    },
  };
}

/**
 * Asks the running Lisp whether the binding form expands to the same code once
 * renamed: "same", "different", or why it could not tell.
 */
async function checkRename(view: EditorView, text: string, edits: Edit[], owner: { from: number; to: number }): Promise<string> {
  if (get().status.session.state !== "ready") return "Lisp is not running.";
  let after = text.slice(owner.from, owner.to);
  for (const e of [...edits].reverse()) after = after.slice(0, e.from - owner.from) + e.insert + after.slice(e.to - owner.from);
  const op = { op: "checkRename", before: text.slice(owner.from, owner.to), after, package: bufferPackage(view, owner.from) } as const;
  const r = await backend.request({ type: "lisp", op }).catch(() => null);
  if (r?.type !== "lisp" || r.reply.kind !== "text") return "Lisp did not answer.";
  const verdict = r.reply.text;
  return verdict.startsWith("unchecked: ") ? verdict.slice("unchecked: ".length) : verdict;
}

/**
 * Opens the rename box on the symbol at the cursor: a local variable or
 * function renames in this form, any other symbol across the project.
 */
export function renameAtCursor(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const text = view.state.doc.toString();
  const r = localRename(text, pos);
  if (!r.ok && r.global) {
    const token = text.slice(r.global.from, r.global.to);
    const nameFrom = r.global.from + token.lastIndexOf(":") + 1;
    const global = { token, pkg: bufferPackage(view, pos) };
    view.dispatch({ effects: open.of({ pos, from: nameFrom, to: r.global.to, text: text.slice(nameFrom, r.global.to), global }) });
    return true;
  }
  if (!r.ok) {
    const line = view.state.doc.lineAt(pos);
    view.dispatch({ effects: showInline.of({ from: pos, to: Math.max(pos, Math.min(line.to, pos + 1)), kind: "error", text: r.reason }) });
    return true;
  }
  const at = r.uses.find((n) => n.start <= pos && pos <= n.to) ?? r.uses[0];
  view.dispatch({ effects: open.of({ pos, from: at.start, to: at.to, text: text.slice(at.start, at.to) }) });
  return true;
}

export const renameBoxField = [
  target,
  EditorView.baseTheme({
    ".cm-rename": { padding: "6px", display: "flex", flexDirection: "column", gap: "4px", maxWidth: "36em" },
    ".cm-rename input": { font: "inherit", fontFamily: "var(--mono)", minWidth: "16em" },
    ".cm-rename-error:empty": { display: "none" },
    ".cm-rename-error": { color: "var(--danger)", fontSize: "12px" },
  }),
];
