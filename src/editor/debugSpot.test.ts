import { describe, expect, it } from "vitest";
import { valuePlaces } from "./debugSpot";

describe("values beside a stopped frame's code", () => {
  const text = '(in-package :demo)\n\n(defun greet (name)\n  "Says hello to NAME."\n  ; name is a string\n  (format nil "Hello, ~a!" name))\n';
  const at = text.indexOf("(format");

  it("go after each local's first use in the function, which is its lambda list", () => {
    const places = valuePlaces(text, at, [{ name: "NAME", value: '"Lisp"' }]);
    expect(places.map((p) => text.slice(p.pos - 4, p.pos))).toEqual(["name"]);
    expect(places[0].pos).toBe(text.indexOf("(name)") + 5);
  });

  it("skip strings, comments, other forms and compiler temporaries", () => {
    const body = '(defun f (x)\n  "x in a docstring"\n  ; x in a comment\n  (let ((#:g2 1)) x))';
    const places = valuePlaces(`(defvar x 1)\n${body}`, 20, [
      { name: "X", value: "3" },
      { name: "#:G2", value: "1" },
    ]);
    expect(places.map((p) => p.pos)).toEqual([13 + "(defun f (x".length]);
    expect(valuePlaces(text, 2, [{ name: "NAME", value: "1" }]), "a form with no such name gets none").toEqual([]);
  });
});
