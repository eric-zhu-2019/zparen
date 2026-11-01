// The warning or error under the cursor, shown as hovering it would show it.
// It appears when the cursor moves onto a mark, not while typing, since the
// check that marks code runs as typing pauses and a box would chase the cursor.
// With problems shown at the end of their lines, it opens only when one is clicked.

import { type Diagnostic, forEachDiagnostic } from "@codemirror/lint";
import { type EditorState, Facet, StateEffect, StateField } from "@codemirror/state";
import { showTooltip, type Tooltip } from "@codemirror/view";

/** Whether moving the cursor onto a mark opens its box. */
export const boxAtCursor = Facet.define<boolean, boolean>({ combine: (v) => (v.length ? v[v.length - 1] : true) });

/** Opens the box for the problems at a position, as clicking a problem's message does. */
export const openProblem = StateEffect.define<number>();

/** `pinned` is where a click opened the box; it stays until the cursor moves or the text changes. */
type Shown = { armed: boolean; tooltip: Tooltip | null; key: string; pinned: number | null };
const none = { tooltip: null, key: "" };

/** The diagnostics covering `pos`, most severe first. */
export function diagnosticsAt(state: EditorState, pos: number): Diagnostic[] {
  const found: Diagnostic[] = [];
  forEachDiagnostic(state, (d, from, to) => {
    if (from <= pos && (pos < to || (from === to && pos === from))) found.push({ ...d, from, to });
  });
  const rank = { error: 0, warning: 1, info: 2, hint: 3 };
  return found.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function tooltipAt(state: EditorState, pos: number | null): { tooltip: Tooltip | null; key: string } {
  const sel = state.selection.main;
  const at = pos ?? sel.head;
  const found = pos !== null || sel.empty ? diagnosticsAt(state, at) : [];
  if (!found.length) return none;
  // The box sits on the cursor's line, above it or else below it, so it never
  // covers that line: at the mark's start when the mark starts on that line,
  // or else at the line's start. Pinned to an earlier line, it could cover it.
  const line = state.doc.lineAt(at);
  const key = `${line.number}:${found[0].from}:${found.map((d) => d.message).join("\n")}`;
  const tooltip: Tooltip = {
    pos: Math.max(line.from, found[0].from),
    above: true,
    create: (view) => {
      const dom = document.createElement("ul");
      dom.className = "cm-tooltip-lint cm-cursor-diagnostic";
      for (const d of found) {
        const li = document.createElement("li");
        li.className = `cm-diagnostic cm-diagnostic-${d.severity}`;
        const text = document.createElement("span");
        text.className = "cm-diagnosticText";
        text.textContent = d.message;
        li.appendChild(text);
        if (d.source) {
          const source = document.createElement("div");
          source.className = "cm-diagnosticSource";
          source.textContent = d.source;
          li.appendChild(source);
        }
        for (const action of d.actions ?? []) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "cm-diagnosticAction";
          button.textContent = action.name;
          button.onmousedown = (e) => e.preventDefault();
          button.onclick = () => action.apply(view, d.from, d.to);
          li.appendChild(button);
        }
        dom.appendChild(li);
      }
      return { dom };
    },
  };
  return { tooltip, key };
}

export const cursorDiagnostic = StateField.define<Shown>({
  create: () => ({ armed: false, ...none, pinned: null }),
  update(shown, tr) {
    const open = tr.effects.find((e) => e.is(openProblem));
    if (open) return { armed: true, ...tooltipAt(tr.state, open.value), pinned: open.value };
    if (shown.pinned !== null && !tr.docChanged && !tr.selection) return shown;
    // Typing disarms it until the cursor next moves. A click leaves it to the
    // mouse hover, which shows the same box where the pointer already is.
    const auto = tr.state.facet(boxAtCursor);
    const armed = !auto || tr.docChanged || tr.isUserEvent("select.pointer") ? false : tr.selection ? true : shown.armed && shown.pinned === null;
    const next = armed ? tooltipAt(tr.state, null) : none;
    // The same messages on the same line keep their box, so moving along a line does not redraw it.
    if (armed === shown.armed && next.key === shown.key && shown.pinned === null) return shown;
    return { armed, ...next, pinned: null };
  },
  provide: (f) => [showTooltip.compute([f], (state) => state.field(f).tooltip)],
});
