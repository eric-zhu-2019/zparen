import { describe, expect, it } from "vitest";
import { applyEdits, candidates } from "./globalRename";

const shown = (text: string, path = "/p/src/a.lisp") =>
  candidates(text, path, "area").map((c) => `${c.designator ? "designator" : "code"} ${c.pkg} ${c.token} ${text.slice(c.from, c.to)}`);

describe("tokens that could name a global symbol", () => {
  it("finds code tokens with the file's package at that point, qualified or not, quoted or not", () => {
    const text = "(in-package #:shapes)\n(defun area (s) s)\n(list 'area #'area shapes::area (area-of x))\n(in-package #:client)\n(shapes:area 1)";
    expect(shown(text)).toEqual([
      "code SHAPES area area",
      "code SHAPES area area",
      "code SHAPES area area",
      "code SHAPES shapes::area area",
      "code CLIENT shapes:area area",
    ]);
  });

  it("reads exported and imported names in DEFPACKAGE as names in those packages", () => {
    const text =
      "(defpackage #:shapes (:use #:cl) (:export #:area :perimeter))\n(defpackage :client (:use :cl) (:import-from #:shapes #:area) (:shadow area))";
    expect(shown(text)).toEqual(["designator SHAPES #:area area", "designator SHAPES #:area area", "designator CLIENT area area"]);
  });

  it("leaves keywords, strings, comments, IN-PACKAGE and escaped names alone", () => {
    expect(shown('(f :area "area" #:area |area|) ; area\n(in-package area)')).toEqual([]);
  });

  it("reads a file with no IN-PACKAGE in CL-USER, and an .asd file in ASDF-USER", () => {
    expect(shown("(area)")).toEqual(["code COMMON-LISP-USER area area"]);
    expect(shown("(area)", "/p/app.asd")).toEqual(["code ASDF-USER area area"]);
  });

  it("makes edits in any order", () => {
    expect(applyEdits("(a b a)", [{ from: 1, to: 2, insert: "x" }, { from: 5, to: 6, insert: "yy" }])).toBe("(x b yy)");
  });
});
