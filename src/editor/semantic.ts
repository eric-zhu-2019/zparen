// Colors the heads of forms by what the running Lisp knows of them: a macro,
// the user's own included, reads as syntax, as `when` does, and a function
// reads as a call, even when its name looks like syntax, such as `do-thing`.
// The tokens come from lispSyntax.ts; this only adds marks on top of them.
// Without a running Lisp, or before it answers, the token colors stay.

import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { backend } from "../backend";
import { packageAt } from "../lisp/forms";
import { useSettings } from "../settings";
import { useStore } from "../store";
import { COALTON_FORMS } from "./lispSyntax";
import { lispPackage } from "./region";

type Kind = "special" | "macro" | "function" | "";

/** What each name names, by package and name, for every view. */
const kinds = new Map<string, Kind>();
let generation = 0;
const views = new Set<Semantic>();
const key = (pkg: string, name: string) => `${pkg}\u0000${name}`;

/** Code changed in the image, so names may name something else now. */
export function forgetKinds() {
  kinds.clear();
  generation++;
  for (const v of views) v.schedule(0);
}

// A new Lisp, a finished load and the setting all change what is known.
useStore.subscribe((s, prev) => {
  const finished = Object.entries(s.tasks).some(([name, t]) => !t.running && prev.tasks[name]?.running);
  if (s.status.session.state !== prev.status.session.state || finished) forgetKinds();
});
useSettings.subscribe((s, prev) => {
  if (s.semanticColors !== prev.semanticColors) forgetKinds();
});

const MARKS = {
  special: Decoration.mark({ class: "tok-special" }),
  macro: Decoration.mark({ class: "tok-macro" }),
  function: Decoration.mark({ class: "tok-function" }),
};

type Head = { from: number; to: number; name: string; pkg: string };

/** The symbols that head a visible form of code. Printed results and Coalton's own forms are left out. */
function visibleHeads(view: EditorView): Head[] {
  const { state } = view;
  const tree = syntaxTree(state);
  const text = state.doc.toString();
  const heads = new Map<number, Head>();
  for (const { from, to } of view.visibleRanges) {
    const pkg = packageAt(text, from) ?? state.facet(lispPackage)?.(state) ?? "COMMON-LISP-USER";
    tree.iterate({
      from,
      to,
      enter: (n) => {
        if (n.name === "Data") return false;
        if (n.name !== "List") return;
        let c = n.node.firstChild?.nextSibling ?? null;
        while (c && (c.name === "Comment" || c.name === "BlockComment")) c = c.nextSibling;
        if (!c || (c.name !== "Symbol" && c.name !== "Special")) return;
        const name = text.slice(c.from, c.to);
        if (!COALTON_FORMS.test(name.toLowerCase())) heads.set(c.from, { from: c.from, to: c.to, name, pkg });
      },
    });
  }
  return [...heads.values()].sort((a, b) => a.from - b.from);
}

const BATCH = 400;

class Semantic {
  decorations: DecorationSet = Decoration.none;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly view: EditorView) {
    views.add(this);
    this.schedule(0);
  }

  update(u: ViewUpdate) {
    if (u.docChanged) this.decorations = this.decorations.map(u.changes);
    if (u.docChanged || u.viewportChanged) this.schedule(250);
  }

  destroy() {
    clearTimeout(this.timer);
    views.delete(this);
  }

  schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), ms);
  }

  private async refresh() {
    const on = useSettings.getState().semanticColors && useStore.getState().status.session.state === "ready";
    if (!on) return this.show(Decoration.none);
    const gen = generation;
    const missing = new Map<string, Set<string>>();
    for (const h of visibleHeads(this.view)) {
      if (!kinds.has(key(h.pkg, h.name))) missing.set(h.pkg, (missing.get(h.pkg) ?? new Set()).add(h.name));
    }
    for (const [pkg, set] of missing) {
      const names = [...set].slice(0, BATCH);
      // Straight to the backend: a failed lookup only leaves the token colors, with no notice in the REPL.
      const r = await backend.request({ type: "lisp", op: { op: "classifySymbols", names, package: pkg } }).catch(() => null);
      if (gen !== generation || !views.has(this)) return;
      if (r?.type !== "lisp" || r.reply.kind !== "names") return;
      const items = r.reply.items;
      names.forEach((n, i) => kinds.set(key(pkg, n), (items[i] ?? "") as Kind));
    }
    const b = new RangeSetBuilder<Decoration>();
    for (const h of visibleHeads(this.view)) {
      const kind = kinds.get(key(h.pkg, h.name));
      if (kind) b.add(h.from, h.to, MARKS[kind]);
    }
    this.show(b.finish());
  }

  private show(set: DecorationSet) {
    if (set.size === 0 && this.decorations.size === 0) return;
    this.decorations = set;
    this.view.dispatch({});
  }
}

export const semanticHeads = ViewPlugin.fromClass(Semantic, { decorations: (v) => v.decorations });
