// The editor's context menu: what a right-click offers for the selection, or
// for the form and symbol under the pointer. Each item runs a command the
// editor already has, so the menu, the keys and the palette agree.

import type { EditorView } from "@codemirror/view";
import type { EditorContext } from "../protocol/EditorContext";
import * as actions from "../actions";
import { symbolAt } from "../lisp/forms";
import { get, set } from "../store";
import {
  compileForm,
  contextOf,
  describeSymbol,
  disassembleAtCursor,
  documentSymbol,
  evalForm,
  findReferencesAtCursor,
  goToDefinition,
  inspectAtCursor,
  macroexpand,
  profileAtCursor,
  toggleTraceAtCursor,
  viewPath,
} from "./commands";
import { renameAtCursor } from "./rename";

export type MenuItem = { id: string; label: string; run: (view: EditorView) => unknown };

/** A menu's items, with null where a separator goes. */
export type Menu = (MenuItem | null)[];

/** What the assistant is asked when the user asks it to explain code. */
export const EXPLAIN = "Explain what this code does, step by step, and point out anything surprising in it.";

/** What the assistant is asked about text from the REPL, which can be code, output, a result or an error. */
export const EXPLAIN_REPL = "Explain this REPL text step by step: what the code does, and what its output, result or error means.";

/** How the chat names the code a menu item is about: the selection or the form, and where it is. */
export function codeLabel(view: EditorView): string {
  const sel = view.state.selection.main;
  const file = (viewPath.get(view) ?? "").split("/").pop() ?? "";
  const line = (pos: number) => view.state.doc.lineAt(pos).number;
  if (sel.empty) return `the form at ${file}:${line(sel.head)}`;
  const [a, b] = [line(sel.from), line(Math.max(sel.from, sel.to - 1))];
  return `the selection in ${file}:${a === b ? a : `${a}–${b}`}`;
}

/** Asks the assistant QUESTION about CONTEXT now, or, while it is busy, waits for the user to send it. */
export function askNow(context: EditorContext, label: string, question: string) {
  set({ right: "assistant" });
  if (get().chatBusy) return set({ chatAbout: { context, label } });
  void actions.askAssistant(question, context);
}

/** Opens the assistant with CONTEXT attached, for the user to type a question. */
export function askAbout(context: EditorContext, label: string) {
  set({ right: "assistant", chatAbout: { context, label } });
}

/** Runs F with VIEW's selection or form, when it has one. */
const withCode = (f: (context: EditorContext, label: string) => unknown) => (view: EditorView) => {
  const context = contextOf(view);
  if (context) f(context, codeLabel(view));
};

export const copy = (view: EditorView) => {
  const { from, to } = view.state.selection.main;
  return navigator.clipboard.writeText(view.state.sliceDoc(from, to));
};

export const cut = (view: EditorView) => {
  const { from, to } = view.state.selection.main;
  return copy(view).then(() => view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: "delete.cut" }));
};

/** The items for VIEW's selection, or for the form and symbol at its cursor. Items that do not apply are left out. */
export function editorMenu(view: EditorView): Menu {
  const sel = view.state.selection.main;
  const picked = !sel.empty;
  const text = view.state.doc.toString();
  const symbol = picked ? null : symbolAt(text, sel.head);
  const what = picked ? "Selection" : "Form";
  const items: Menu = [
    { id: "explain", label: picked ? "Explain This Code" : "Explain This Form", run: withCode((c, l) => askNow(c, l, EXPLAIN)) },
    { id: "ask", label: "Ask Assistant About It…", run: withCode(askAbout) },
    null,
    { id: "eval", label: `Evaluate ${what}`, run: evalForm },
    { id: "compile", label: `Compile ${what}`, run: compileForm },
    ...(picked ? [] : [{ id: "macroexpand", label: "Expand Macro", run: (v: EditorView) => macroexpand(v) }]),
    ...(picked || symbol ? [{ id: "inspect", label: picked ? "Inspect Value" : "Inspect", run: inspectAtCursor }] : []),
    { id: "profile", label: `Profile ${what}`, run: profileAtCursor },
  ];
  if (symbol) {
    const name = symbol.name.toLowerCase().replace(/^.*:/, "");
    const traced = get().traces.specs.some((spec) => actions.shortName(spec).toLowerCase() === name);
    items.push(
      null,
      { id: "definition", label: "Go to Definition", run: goToDefinition },
      { id: "references", label: "Find References", run: findReferencesAtCursor },
      { id: "describe", label: "Describe Symbol", run: describeSymbol },
      { id: "docs", label: "Show Documentation", run: documentSymbol },
      ...(view.state.readOnly ? [] : [{ id: "rename", label: "Rename Symbol…", run: renameAtCursor }]),
      { id: "trace", label: traced ? "Stop Tracing Function" : "Trace Function", run: toggleTraceAtCursor },
      { id: "disassemble", label: "Disassemble Function", run: disassembleAtCursor },
    );
  }
  if (picked) items.push(null, ...(view.state.readOnly ? [] : [{ id: "cut", label: "Cut", run: cut }]), { id: "copy", label: "Copy", run: copy });
  return items;
}
