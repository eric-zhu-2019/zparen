// The REPL's context menu. The REPL has no file and its transcript is not one
// program, so the menu acts on what was clicked: the selection, an earlier
// input, a result, or the input being typed.

import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import * as actions from "../actions";
import { askAbout, askNow, copy, cut, EXPLAIN_REPL, type Menu } from "../editor/contextMenu";
import { symbolAt } from "../lisp/forms";
import { get } from "../store";
import { copyDown, insertResult, layout } from "./replBuffer";

/** What the REPL's menu needs from the REPL it is in. */
export type ReplMenuHandlers = {
  package: string;
  /** Runs CODE in this REPL as if it were typed. */
  run: (code: string) => void;
  inspect: (presentation: number) => void;
  clear: () => void;
  /** Shows a short message, such as what Trace did, in this REPL's transcript. */
  say: (text: string) => void;
};

type Target = { kind: "selection" | "input" | "result" | "prompt"; from: number; to: number; presentation?: number };

/** What a right-click at the cursor is about: the selection, an earlier input or result there, or the input being typed. */
export function replTarget(state: EditorState): Target | null {
  const sel = state.selection.main;
  if (!sel.empty) return { kind: "selection", from: sel.from, to: sel.to };
  const l = state.field(layout);
  const pos = sel.head;
  if (pos >= l.promptFrom) return state.doc.length > l.inputStart ? { kind: "prompt", from: l.inputStart, to: state.doc.length } : null;
  const input = l.inputs.find((r) => r.from <= pos && pos <= r.to);
  if (input) return { kind: "input", ...input };
  let found: Target | null = null;
  l.marks.between(pos, pos, (from, to, deco) => {
    const id = deco.spec.attributes?.["data-presentation"];
    if (id !== undefined) found = { kind: "result", from, to, presentation: Number(id) };
  });
  if (found) return found;
  const region = l.regions.find((r) => r.mode === "data" && r.from <= pos && pos <= r.to);
  return region ? { kind: "result", from: region.from, to: region.to } : null;
}

const EXPLAIN_LABEL = { selection: "Explain Selection", input: "Explain This Input", result: "Explain This Result", prompt: "Explain This Input" } as const;
/** How the assistant is told what the text is. */
const FORM_LABELS = { selection: "Selected REPL text", input: "An earlier REPL input", result: "A REPL result", prompt: "The REPL input being typed" } as const;
const NAMES = { selection: "the selection", input: "an earlier input", result: "a result", prompt: "the input" } as const;

/** The items for a right-click in the REPL. Items that do not apply are left out. */
export function replMenu(view: EditorView, h: ReplMenuHandlers): Menu {
  const state = view.state;
  const target = replTarget(state);
  const text = target ? state.sliceDoc(target.from, target.to) : "";
  const context = { file: null, package: h.package, form: text.slice(0, 4000), ...(target ? { formLabel: FORM_LABELS[target.kind] } : {}) };
  const label = target ? `${NAMES[target.kind]} in the REPL` : "";
  const items: Menu = [];
  if (target) {
    items.push(
      { id: "explain", label: EXPLAIN_LABEL[target.kind], run: () => askNow(context, label, EXPLAIN_REPL) },
      { id: "ask", label: "Ask Assistant About It…", run: () => askAbout(context, label) },
      null,
    );
    if (target.kind === "selection") items.push({ id: "eval", label: "Evaluate Selection", run: () => h.run(text) });
    if (target.kind === "input") items.push({ id: "copy-down", label: "Copy to Input", run: copyDown });
    if (target.presentation !== undefined) {
      const id = target.presentation;
      items.push({ id: "use", label: "Use in Input", run: (v) => insertResult(v, id) }, { id: "inspect", label: "Inspect Result", run: () => h.inspect(id) });
    } else if (target.kind === "selection") items.push({ id: "inspect", label: "Inspect Value", run: () => void actions.inspectForm(text, h.package) });
  }
  // A symbol in Lisp: an input, a result, or the input being typed. Not in output or a prompt.
  const symbol = target && target.kind !== "selection" ? symbolAt(state.doc.toString(), state.selection.main.head) : null;
  if (symbol && symbol.from >= target!.from && symbol.to <= target!.to) {
    const name = symbol.name;
    const short = name.toLowerCase().replace(/^.*:/, "");
    const traced = get().traces.specs.some((spec) => actions.shortName(spec).toLowerCase() === short);
    items.push(
      ...(items.length && items[items.length - 1] !== null ? [null] : []),
      { id: "definition", label: "Go to Definition", run: () => void actions.findDefinition(name, h.package) },
      { id: "references", label: "Find References", run: () => void actions.findReferences(name, h.package) },
      { id: "docs", label: "Show Documentation", run: () => actions.showDocs(name, h.package) },
      ...(target!.presentation === undefined ? [{ id: "inspect-symbol", label: "Inspect", run: () => void actions.inspectForm(name, h.package) }] : []),
      { id: "trace", label: traced ? "Stop Tracing Function" : "Trace Function", run: () => void actions.toggleTrace(name, h.package).then(h.say, (e) => h.say(String(e?.message ?? e))) },
    );
  }
  if (target?.kind === "selection") {
    const { inputStart } = state.field(layout);
    items.push(null, ...(target.from >= inputStart ? [{ id: "cut", label: "Cut", run: cut }] : []), { id: "copy", label: "Copy", run: copy });
  }
  if (items.length && items[items.length - 1] !== null) items.push(null);
  items.push({ id: "clear", label: "Clear REPL", run: h.clear });
  return items;
}
