import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { beforeAll, describe, expect, it } from "vitest";
import { set, type TranscriptItem, useStore } from "../store";
import { promptText, replBuffer, TranscriptRenderer } from "./replBuffer";
import { replMenu, replTarget } from "./replMenu";

beforeAll(() => {
  // The renderer keeps new output in view; there is no layout here to watch.
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const TRANSCRIPT: TranscriptItem[] = [
  { id: 1, kind: "input", text: "(list 'twice 21)", package: "CL-USER" },
  { id: 2, kind: "output", text: "twice is printed\n" },
  { id: 3, kind: "result", text: "(TWICE 21)", presentation: 7 },
];

/** A REPL view, as the menu reads it, with TRANSCRIPT and INPUT typed at the prompt. */
function repl(input = ""): EditorView {
  const dom = { addEventListener() {} };
  const view = {
    state: EditorState.create({ doc: promptText("CL-USER"), extensions: replBuffer({ reading: () => false, submit: () => {}, history: () => null, inspect: () => {} }) }),
    scrollDOM: dom,
    contentDOM: dom,
    dispatch(...specs: Parameters<EditorView["dispatch"]>) {
      (view as { state: EditorState }).state = view.state.update(...(specs as [])).state;
    },
  } as unknown as EditorView;
  new TranscriptRenderer().sync(view, TRANSCRIPT, "CL-USER");
  if (input) view.dispatch({ changes: { from: view.state.doc.length, insert: input } });
  return view;
}

/** VIEW with the cursor on the first WORD, or WORD selected. */
function at(view: EditorView, word: string, select = false) {
  const from = view.state.doc.toString().indexOf(word) + (select ? 0 : 1);
  view.dispatch({ selection: select ? EditorSelection.single(from, from + word.length) : EditorSelection.cursor(from) });
  return view;
}

const handlers = { package: "CL-USER", run: () => {}, inspect: () => {}, clear: () => {}, say: () => {} };
const ids = (view: EditorView) => replMenu(view, handlers).map((i) => i?.id ?? "-");

describe("the REPL's context menu", () => {
  it("offers to explain an earlier input, copy it down, and the symbol's commands", () => {
    const view = at(repl(), "twice");
    expect(replTarget(view.state)).toMatchObject({ kind: "input" });
    expect(ids(view)).toEqual(["explain", "ask", "-", "copy-down", "-", "definition", "references", "docs", "inspect-symbol", "trace", "-", "clear"]);
  });

  it("offers to use and inspect a result", () => {
    const view = at(repl(), "TWICE");
    expect(replTarget(view.state)).toMatchObject({ kind: "result", presentation: 7 });
    expect(ids(view)).toEqual(["explain", "ask", "-", "use", "inspect", "-", "definition", "references", "docs", "trace", "-", "clear"]);
    expect(replMenu(view, handlers)[0]?.label).toBe("Explain This Result");
  });

  it("offers to evaluate, inspect and copy a selection, and to cut it only from the input", () => {
    const view = at(repl(), "twice is printed", true);
    expect(ids(view)).toEqual(["explain", "ask", "-", "eval", "inspect", "-", "copy", "-", "clear"]);
    expect(ids(at(repl("(+ 1 2)"), "(+ 1 2)", true))).toContain("cut");
  });

  it("offers no symbol commands in output, and only Clear in an empty prompt", () => {
    expect(ids(at(repl(), "printed"))).toEqual(["clear"]);
    const view = repl();
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    expect(replTarget(view.state)).toBeNull();
    expect(ids(view)).toEqual(["clear"]);
  });

  it("attaches the text clicked, with the REPL's package, for the assistant", () => {
    const view = at(repl("(* 6 7)"), "(* 6 7)");
    replMenu(view, handlers)[1]!.run(view);
    expect(useStore.getState().chatAbout).toEqual({ context: { file: null, package: "CL-USER", form: "(* 6 7)", formLabel: "The REPL input being typed" }, label: "the input in the REPL" });
    set({ chatAbout: null });
  });
});
