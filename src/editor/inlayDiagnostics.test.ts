import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { boxAtCursor, cursorDiagnostic, openProblem } from "./cursorDiagnostic";
import { inlays, inlayText } from "./inlayDiagnostics";

const doc = "(defpackage #:myapp\n  (:use (:cl)))\n\n(defun f () x y)\n";
const at = (s: string) => doc.indexOf(s);

function withProblems(problems: Diagnostic[], extensions: Extension[] = [cursorDiagnostic]) {
  const state = EditorState.create({ doc, extensions });
  return state.update(setDiagnostics(state, problems)).state;
}

describe("problems at the end of their lines", () => {
  it("say the message in one short line, without SBCL's macroexpansion preamble", () => {
    expect(inlayText("(during macroexpansion of (DEFPACKAGE #:MYAPP\n  ...))\n(:CL) does not designate a package")).toBe(
      "(:CL) does not designate a package",
    );
    expect(inlayText("undefined variable:\n  COMMON-LISP-USER::X")).toBe("undefined variable: COMMON-LISP-USER::X");
    expect(inlayText("x".repeat(200))).toHaveLength(120);
  });

  it("show the most severe problem on the line where it starts, and count the rest", () => {
    const state = withProblems([
      { from: at("x y"), to: at("x y") + 1, severity: "warning", message: "undefined variable: X" },
      { from: at("(defun"), to: doc.length - 1, severity: "info", message: "a note" },
      { from: at("y)"), to: at("y)") + 1, severity: "error", message: "bad Y" },
      { from: 0, to: at("\n\n"), severity: "error", message: "(:CL) does not designate a package" },
    ]);
    expect(inlays(state).map(({ line, diagnostic, more }) => `${line} ${diagnostic.message} +${more}`)).toEqual([
      "1 (:CL) does not designate a package +0",
      "4 bad Y +2",
    ]);
  });
});

describe("the box for a problem", () => {
  it("opens when a problem's message is clicked, and closes when the cursor moves", () => {
    let state = withProblems([{ from: 0, to: at("\n\n"), severity: "error", message: "bad package" }], [cursorDiagnostic, boxAtCursor.of(false)]);
    state = state.update({ selection: EditorSelection.cursor(at(":use")) }).state;
    expect(state.field(cursorDiagnostic).tooltip, "the cursor alone does not open it when problems show at line ends").toBeNull();
    state = state.update({ effects: openProblem.of(0) }).state;
    expect(state.field(cursorDiagnostic).tooltip).not.toBeNull();
    state = state.update({ effects: [] }).state;
    expect(state.field(cursorDiagnostic).tooltip, "it stays while nothing moves").not.toBeNull();
    state = state.update({ selection: EditorSelection.cursor(at("(defun")) }).state;
    expect(state.field(cursorDiagnostic).tooltip).toBeNull();
  });

  it("still opens at the cursor when problems show in a box", () => {
    let state = withProblems([{ from: 0, to: at("\n\n"), severity: "error", message: "bad package" }]);
    state = state.update({ selection: EditorSelection.cursor(at(":use")) }).state;
    expect(state.field(cursorDiagnostic).tooltip).not.toBeNull();
  });
});
