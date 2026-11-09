import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { set } from "../store";
import { contextOf, viewPath } from "./commands";
import { codeLabel, editorMenu } from "./contextMenu";

const CODE = "(defun twice (x)\n  (* 2 x))\n\n(twice 21)\n";

/** A view as the menu reads it: its state and its file. */
function editor(selection: EditorSelection, readOnly = false): EditorView {
  const view = { state: EditorState.create({ doc: CODE, selection, extensions: EditorState.readOnly.of(readOnly) }) } as EditorView;
  viewPath.set(view, "/p/src/main.lisp");
  return view;
}

const ids = (view: EditorView) => editorMenu(view).map((i) => i?.id ?? "-");
const labels = (view: EditorView) => editorMenu(view).flatMap((i) => (i ? [i.label] : []));

describe("the editor's context menu", () => {
  it("offers the assistant, Lisp commands, and Cut and Copy for a selection", () => {
    const view = editor(EditorSelection.single(0, 26));
    expect(ids(view)).toEqual(["explain", "ask", "-", "eval", "compile", "inspect", "profile", "-", "cut", "copy"]);
    expect(labels(view)).toContain("Explain This Code");
    expect(labels(view)).toContain("Evaluate Selection");
    expect(codeLabel(view)).toBe("the selection in main.lisp:1–2");
    expect(contextOf(view)?.formLabel, "the assistant is told it is a selection").toBe("The selection");
  });

  it("offers the symbol's commands on a symbol, and no Cut or Copy without a selection", () => {
    const view = editor(EditorSelection.single(CODE.indexOf("twice 21") + 2));
    expect(ids(view)).toEqual(["explain", "ask", "-", "eval", "compile", "macroexpand", "inspect", "profile", "-", "definition", "references", "describe", "docs", "rename", "trace", "disassemble"]);
    expect(labels(view)).toContain("Explain This Form");
    expect(codeLabel(view)).toBe("the form at main.lisp:4");
    expect(contextOf(view)?.formLabel, "a form at the cursor needs no label").toBeUndefined();
  });

  it("says Stop Tracing for a function being traced", () => {
    set((s) => ({ traces: { ...s.traces, specs: ["MY-APP::TWICE"] } }));
    expect(labels(editor(EditorSelection.single(CODE.indexOf("twice 21") + 2)))).toContain("Stop Tracing Function");
    set((s) => ({ traces: { ...s.traces, specs: [] } }));
  });

  it("leaves out what would change a read-only file", () => {
    expect(ids(editor(EditorSelection.single(0, 26), true))).not.toContain("cut");
    expect(ids(editor(EditorSelection.single(CODE.indexOf("twice 21") + 2), true))).not.toContain("rename");
  });

  it("leaves out the symbol's commands where there is no symbol", () => {
    expect(ids(editor(EditorSelection.single(CODE.indexOf("\n\n") + 1)))).not.toContain("definition");
  });
});
