// Each marked line ends with its problem's message, so it reads without a
// box over the code. Clicking the message opens the full box, with its actions.

import { type Diagnostic, forEachDiagnostic, setDiagnosticsEffect } from "@codemirror/lint";
import { type EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { openProblem } from "./cursorDiagnostic";

const RANK = { error: 0, warning: 1, info: 2, hint: 3 };

/** A message as one short line: SBCL's "(during macroexpansion of ...)" preamble dropped, spaces collapsed. */
export function inlayText(message: string): string {
  const body = message.replace(/^\(during (?:macro)?expansion of [\s\S]*?\.\.\.\)\)\s*/, "");
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/**
 * For each line where an error or warning starts: the most severe one, and how
 * many more start there. SBCL's notes keep their marks but add no text.
 */
export function inlays(state: EditorState): { line: number; diagnostic: Diagnostic; more: number }[] {
  const byLine = new Map<number, Diagnostic[]>();
  forEachDiagnostic(state, (d, from, to) => {
    if (d.severity !== "error" && d.severity !== "warning") return;
    const line = state.doc.lineAt(from).number;
    byLine.set(line, [...(byLine.get(line) ?? []), { ...d, from, to }]);
  });
  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([line, list]) => {
      const sorted = list.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
      return { line, diagnostic: sorted[0], more: sorted.length - 1 };
    });
}

class InlayWidget extends WidgetType {
  constructor(
    readonly severity: Diagnostic["severity"],
    readonly message: string,
    readonly more: number,
    readonly at: number,
  ) {
    super();
  }
  eq(o: InlayWidget) {
    return o.severity === this.severity && o.message === this.message && o.more === this.more && o.at === this.at;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = `cm-inlay-diagnostic cm-inlay-${this.severity}`;
    el.textContent = inlayText(this.message) + (this.more ? `  +${this.more}` : "");
    el.title = "Click for the full message and its actions";
    el.onmousedown = (e) => e.preventDefault();
    // The cursor goes to the line's end, where the message is, and the editor
    // takes the keys, as a click on the line would.
    el.onclick = () => {
      view.dispatch({ selection: { anchor: view.state.doc.lineAt(this.at).to }, scrollIntoView: false });
      view.dispatch({ effects: openProblem.of(this.at) });
      view.focus();
    };
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function decorate(state: EditorState): DecorationSet {
  return Decoration.set(
    inlays(state).map(({ line, diagnostic, more }) =>
      Decoration.widget({ widget: new InlayWidget(diagnostic.severity, diagnostic.message, more, diagnostic.from), side: 1 }).range(
        state.doc.line(line).to,
      ),
    ),
  );
}

export const inlayDiagnostics = StateField.define<DecorationSet>({
  create: (state) => decorate(state),
  update(decorations, tr) {
    if (tr.effects.some((e) => e.is(setDiagnosticsEffect))) return decorate(tr.state);
    return tr.docChanged ? decorate(tr.state) : decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});
