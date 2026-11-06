// Thin vertical lines in the indentation, one under the open paren of each
// form that spans more lines, as Python editors draw at each indent level. In
// Lisp a body lines up under its form, so the line under a form's paren shows
// which lines are in that form. The guide of the form around the cursor takes
// its paren's depth color.

import { syntaxTree } from "@codemirror/language";
import { countColumn, type EditorState, RangeSetBuilder, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { useSettings } from "../settings";

/** A guide at a display column, for the list that opens at `open`, with its paren depth color. */
export type Guide = { col: number; depth: number; open: number };

/** The open paren of a list that spans lines, and the lines its guide runs down. */
type Form = Guide & { firstLine: number; lastLine: number };

function formOf(list: SyntaxNode, doc: Text, tabSize: number): Form | null {
  const open = list.firstChild;
  if (!open || !open.name.startsWith("Open")) return null;
  const line = doc.lineAt(open.from);
  const lastLine = doc.lineAt(list.to).number;
  if (lastLine === line.number) return null;
  // The paren itself, after a # of #(.
  const paren = open.to - 1;
  return { col: countColumn(line.text, tabSize, paren - line.from), depth: Number(open.name.slice(4)), open: open.from, firstLine: line.number + 1, lastLine };
}

/**
 * For a line that starts in a string or a block comment, the column where that
 * text opens: its spaces are text, so only guides left of it show. Otherwise
 * Infinity.
 */
function textColumn(tree: Tree, doc: Text, pos: number, tabSize: number): number {
  const n = tree.resolveInner(pos, 1);
  if ((n.name !== "String" && n.name !== "BlockComment") || n.from >= pos) return Infinity;
  const line = doc.lineAt(n.from);
  return countColumn(line.text, tabSize, n.from - line.from);
}

/**
 * The guides on each line from `from` to `to`, by line number. A guide shows
 * on the lines after its form's first line, up to the last, where the line's
 * indentation passes its column. A blank line shows the guides of the forms
 * that go on below it.
 */
export function indentGuides(tree: Tree, doc: Text, from = 0, to = doc.length, tabSize = 8): Map<number, Guide[]> {
  const forms: Form[] = [];
  tree.iterate({
    from,
    to,
    enter: (n) => {
      if (n.name !== "List") return n.name === "" || n.name === "Document" || n.name === "Code" || n.name === "Data" ? undefined : false;
      const form = formOf(n.node, doc, tabSize);
      if (!form) return false;
      forms.push(form);
    },
  });
  const out = new Map<number, Guide[]>();
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(to).number;
  for (const f of forms) {
    for (let n = Math.max(f.firstLine, first); n <= Math.min(f.lastLine, last); n++) {
      const line = doc.line(n);
      const indent = /^[ \t]*/.exec(line.text)![0];
      const blank = indent.length === line.text.length;
      if (blank ? n === f.lastLine : countColumn(indent, tabSize) <= f.col) continue;
      if (f.col >= textColumn(tree, doc, line.from, tabSize)) continue;
      const list = out.get(n);
      const guide = { col: f.col, depth: f.depth, open: f.open };
      if (list) list.push(guide);
      else out.set(n, [guide]);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.col - b.col);
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/** The open paren of the innermost form around `pos` that spans lines, whose guide is the cursor's. */
export function activeGuide(tree: Tree, doc: Text, pos: number): number | null {
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
    if (n.name !== "List" || n.to === pos) continue;
    const open = n.firstChild;
    if (open?.name.startsWith("Open") && doc.lineAt(n.from).number !== doc.lineAt(n.to).number) return open.from;
  }
  return null;
}

const guideColor = (g: Guide, active: boolean) =>
  active ? `color-mix(in srgb, var(--paren-${g.depth}) 75%, transparent)` : "var(--indent-guide)";

/** The guides as background lines, so the text, the cursor and the selection are left as they are. */
function lineStyle(guides: Guide[], active: number | null): string {
  const images = guides.map((g) => {
    const c = guideColor(g, g.open === active);
    return `linear-gradient(${c}, ${c})`;
  });
  const positions = guides.map((g) => `calc(${g.col + 0.5}ch - 0.5px) 0`);
  return `background-image: ${images.join(", ")}; background-position: ${positions.join(", ")}; background-size: 1px 100%; background-repeat: no-repeat; background-origin: content-box`;
}

class Guides {
  decorations: DecorationSet = Decoration.none;
  private readonly unsubscribe: () => void;

  constructor(readonly view: EditorView) {
    this.decorations = this.build(view.state);
    this.unsubscribe = useSettings.subscribe((s, prev) => {
      if (s.indentGuides === prev.indentGuides) return;
      this.decorations = this.build(this.view.state);
      this.view.dispatch({});
    });
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = this.build(u.state);
  }

  destroy() {
    this.unsubscribe();
  }

  private build(state: EditorState): DecorationSet {
    if (!useSettings.getState().indentGuides) return Decoration.none;
    const tree = syntaxTree(state);
    const active = activeGuide(tree, state.doc, state.selection.main.head);
    const b = new RangeSetBuilder<Decoration>();
    let done = 0;
    for (const { from, to } of this.view.visibleRanges) {
      for (const [n, guides] of indentGuides(tree, state.doc, from, to, state.tabSize)) {
        if (n <= done) continue;
        const line = state.doc.line(n);
        b.add(line.from, line.from, Decoration.line({ attributes: { style: lineStyle(guides, active) } }));
        done = n;
      }
    }
    return b.finish();
  }
}

export const lispIndentGuides = ViewPlugin.fromClass(Guides, { decorations: (v) => v.decorations });
