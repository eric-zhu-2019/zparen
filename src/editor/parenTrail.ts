// Dims the closing parens that end a line, the ones parinfer moves when the
// indentation changes, so it is clear they are not typed by hand. These are
// parinfer's "paren trails", found here in the shared syntax tree instead of
// by running parinfer on every change. The trail on the cursor's line stays
// as it is, since parinfer holds those parens while you type there.

import { syntaxTree } from "@codemirror/language";
import { type EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { useSettings } from "../settings";
import { parinferStatus, USER_EDITS } from "./parinfer";
import { run_parinfer } from "./parinfer/pkg/parinfer_wasm.js";
import { regionOf } from "./region";

/** The run of closing parens that ends each line in `from`..`to`, a trailing comment aside, as [from, to] ranges. */
export function parenTrails(tree: Tree, text: { lineAt(pos: number): { number: number } }, from = 0, to = tree.length): [number, number][] {
  const out: [number, number][] = [];
  let line = -1;
  let start = -1;
  let end = -1;
  const close = () => {
    if (start >= 0) out.push([start, end]);
    start = -1;
  };
  tree.iterate({
    from,
    to,
    enter: (n) => {
      if (n.name === "Data") return false;
      if (n.node.firstChild) return;
      const at = text.lineAt(n.from).number;
      if (at !== line) {
        close();
        line = at;
      }
      if (n.name.startsWith("Close")) {
        if (start < 0) start = n.from;
        end = n.to;
      } else if (n.name !== "Comment" && n.name !== "BlockComment") start = -1;
    },
  });
  close();
  return out;
}

const DIM = Decoration.mark({ class: "cm-paren-trail" });

/** Parinfer moves trails only in smart and indent mode, and only while it accepts the text. */
function moving(state: EditorState): boolean {
  const status = state.field(parinferStatus, false);
  return !!status && status.enabled && status.mode !== "paren";
}

/** Parinfer refuses text such as a lone quote in a comment, and then moves nothing. */
function refused(state: EditorState): boolean {
  const status = state.field(parinferStatus)!;
  if (status.error) return true;
  try {
    const request = { mode: status.mode, text: regionOf(state).text.toString(), options: { lispVlineSymbols: true, lispBlockComments: true } };
    return !JSON.parse(run_parinfer(JSON.stringify(request))).success;
  } catch {
    return true;
  }
}

class Trails {
  decorations: DecorationSet = Decoration.none;
  private refused = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly unsubscribe: () => void;

  constructor(readonly view: EditorView) {
    this.check();
    this.decorations = this.build();
    this.unsubscribe = useSettings.subscribe((s, prev) => {
      if (s.dimParenTrails !== prev.dimParenTrails) this.redraw();
    });
  }

  update(u: ViewUpdate) {
    const status = u.state.field(parinferStatus, false);
    const statusChanged = status !== u.startState.field(parinferStatus, false);
    if (u.docChanged && USER_EDITS.some((e) => u.transactions.some((tr) => tr.isUserEvent(e)))) {
      // Parinfer has just read the whole text for this edit, and its error says whether it refused it.
      this.refused = !!status?.error;
    } else if (u.docChanged || statusChanged) {
      // A reload, an undo or a new mode: no parinfer run says yet whether it accepts the text.
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.check();
        this.redraw();
      }, 300);
    }
    if (u.docChanged || u.viewportChanged || u.selectionSet || statusChanged) this.decorations = this.build();
  }

  destroy() {
    clearTimeout(this.timer);
    this.unsubscribe();
  }

  private check() {
    this.refused = useSettings.getState().dimParenTrails && moving(this.view.state) && refused(this.view.state);
  }

  private redraw() {
    this.decorations = this.build();
    this.view.dispatch({});
  }

  private build(): DecorationSet {
    const { state } = this.view;
    if (!useSettings.getState().dimParenTrails || !moving(state) || this.refused) return Decoration.none;
    const start = regionOf(state).from;
    const cursorLine = state.doc.lineAt(state.selection.main.head).number;
    const b = new RangeSetBuilder<Decoration>();
    const tree = syntaxTree(state);
    let last = -1;
    for (const { from, to } of this.view.visibleRanges) {
      for (const [a, z] of parenTrails(tree, state.doc, Math.max(from, start), to)) {
        if (a < start || a < last || state.doc.lineAt(a).number === cursorLine) continue;
        b.add(a, z, DIM);
        last = z;
      }
    }
    return b.finish();
  }
}

export const dimParenTrails = ViewPlugin.fromClass(Trails, { decorations: (v) => v.decorations });
