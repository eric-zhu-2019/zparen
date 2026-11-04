import { readFileSync } from "node:fs";
import { matchBrackets, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { highlightTree } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { lisp } from "./lisp";
import { buildDocument, buildTree, highlightLispHtml, lispHighlighter, looksLikeLisp, type Region, regionTree, sessionRegions } from "./lispSyntax";

/** Each colored token as [text, class], class shortened: "tok-def" → "def", "cm-paren-1" → "p1". */
function tokens(text: string, regions?: Region[]): [string, string][] {
  const out: [string, string][] = [];
  highlightTree(buildTree(text, regions), lispHighlighter, (from, to, cls) => {
    out.push([text.slice(from, to), cls.replace(/^tok-/, "").replace(/^cm-paren-/, "p")]);
  });
  return out;
}

/** The class of each named token, the last one winning. */
const classes = (text: string, regions?: Region[]) => Object.fromEntries(tokens(text, regions));

describe("Lisp highlighting", () => {
  it("colors comments, strings, numbers, keywords and reader syntax", () => {
    expect(classes('(f ; c\n "s" #\\a 12 -3/4 1.5d0 #x1F :k nil #:g #P"/x" #S(p) 1+ &key)')).toMatchObject({
      "; c": "comment",
      '"s"': "string",
      "#\\a": "string",
      "12": "number",
      "-3/4": "number",
      "1.5d0": "number",
      "#x1F": "number",
      ":k": "atom",
      nil: "atom",
      "#:g": "meta",
      "#P": "meta",
      "#S": "meta",
      "1+": "symbol",
      "&key": "symbol",
    });
  });

  it("colors special heads, and the name a def form defines", () => {
    expect(classes("(defun square (x) (let* ((y x)) (when y (* y y))))")).toMatchObject({
      defun: "special",
      square: "def",
      "let*": "special",
      when: "special",
      "*": "symbol",
    });
    expect(classes("(defmethod (setf name) (v p) v)")).toMatchObject({ defmethod: "special", setf: "def", name: "def" });
    expect(classes("(defstruct (point (:conc-name p-)) x)")).toMatchObject({ point: "def", ":conc-name": "atom", "p-": "symbol" });
    expect(classes("(cl:defun main () t)")).toMatchObject({ "cl:defun": "special", main: "def" });
  });

  it("keeps a defined name's own color when it is a keyword or a string", () => {
    expect(classes('(defpackage :zen (:use :cl)) (defsystem "zen")')).toMatchObject({ ":zen": "atom", '"zen"': "string" });
  });

  it("colors Coalton operators that head a form, as it does Lisp's", () => {
    const s = classes("(coalton-toplevel (declare f (Integer -> Integer)) (define (f x) (match x (_ (fn (y) y)))))");
    expect(s).toMatchObject({ "coalton-toplevel": "special", declare: "special", define: "special", match: "special", fn: "special", Integer: "symbol" });
  });

  it("colors a .coal file's package form and its clauses", () => {
    expect(classes("(package zen-coal (import coalton-prelude) (export double))")).toMatchObject({
      package: "special",
      import: "special",
      export: "special",
      "zen-coal": "symbol",
    });
  });

  it("leaves Lisp's import and export alone outside a package form", () => {
    expect(classes("(export '(double))")).toMatchObject({ export: "symbol" });
    expect(classes("(progn (package x) (export y))")).toMatchObject({ package: "symbol", export: "symbol" });
  });

  it("leaves the same names alone where they are not a form's head", () => {
    expect(classes("(list match fn when)")).toMatchObject({ list: "symbol", match: "symbol", fn: "symbol", when: "symbol" });
  });

  it("colors parens by depth and skips parens that are not code", () => {
    const parens = tokens('(a (b (c)) "(" #\\( |x (y| ; (\n #| (z) #| ( |# |# d)').filter(([, c]) => c.startsWith("p"));
    expect(parens.map(([text, c]) => text + c).join(" ")).toBe("(p0 (p1 (p2 )p2 )p1 )p0");
  });

  it("colors a close paren with no open one, at the outer depth", () => {
    expect(tokens(") (a)").filter(([, c]) => c.startsWith("p"))).toEqual([[")", "p0"], ["(", "p0"], [")", "p0"]]);
  });

  it("does not take a feature expression's parens for stray ones", () => {
    expect(tokens("#+(or sbcl ccl) (foo)").filter(([, c]) => c.startsWith("p"))).toEqual([["(", "p0"], [")", "p0"]]);
  });
});

describe("Lisp highlighting by region", () => {
  it("reads printed results as data: a list is a value, not a call", () => {
    expect(classes("(IF X 2)", [{ from: 0, to: 8, mode: "data" }])).toMatchObject({ IF: "symbol", "2": "number", "(": "p0" });
    expect(classes("(DEFUN F)", [{ from: 0, to: 9, mode: "data" }])).toMatchObject({ DEFUN: "symbol", F: "symbol" });
  });

  it("reads an unreadable object as one token, even inside a list", () => {
    const text = '(#<HASH-TABLE :TEST EQL {1001}> #<THREAD "main (x)" {2}>)';
    expect(tokens(text, [{ from: 0, to: text.length, mode: "data" }])).toEqual([
      ["(", "p0"],
      ["#<HASH-TABLE :TEST EQL {1001}>", "meta"],
      ['#<THREAD "main (x)" {2}>', "meta"],
      [")", "p0"],
    ]);
  });

  it("never lets text outside the regions color what follows", () => {
    const text = 'CL-USER> (print "a")\nHe said "hi (\nCL-USER> (+ 1 2)\n3';
    const at = (s: string) => text.indexOf(s);
    const regions: Region[] = [
      { from: at("(print"), to: at("\nHe"), mode: "code" },
      { from: at("(+"), to: at("\n3"), mode: "code" },
      { from: at("3"), to: text.length, mode: "data" },
    ];
    expect(tokens(text, regions)).toEqual([
      ["(", "p0"],
      ["print", "symbol"],
      ['"a"', "string"],
      [")", "p0"],
      ["(", "p0"],
      ["+", "symbol"],
      ["1", "number"],
      ["2", "number"],
      [")", "p0"],
      ["3", "number"],
    ]);
  });

  it("reuses a region's tree in place of reading it again", () => {
    const text = "x (a b)";
    const reused = regionTree("(a b)", "data");
    expect(tokens(text, [{ from: 2, to: 7, mode: "data", tree: reused }])).toEqual(tokens(text, [{ from: 2, to: 7, mode: "data" }]));
  });
});

describe("code shown as HTML", () => {
  it("escapes the text and colors it the same way", () => {
    expect(highlightLispHtml('(defun f () "<b>")')).toBe(
      '<span class="cm-paren-0">(</span><span class="tok-special">defun</span> <span class="tok-def">f</span> ' +
        '<span class="cm-paren-1">(</span><span class="cm-paren-1">)</span> <span class="tok-string">&quot;&lt;b&gt;&quot;</span><span class="cm-paren-0">)</span>',
    );
  });

  it("reads a REPL session: prompts, inputs as code, and printed values as data", () => {
    const text = 'CL-USER> (list \'if "a)\nb")\n(IF "a)\nb")\nCL-USER> 1\n1';
    expect(sessionRegions(text).map((r) => [text.slice(r.from, r.to), r.mode])).toEqual([
      ["CL-USER> ", "prompt"],
      ['(list \'if "a)\nb")\n', "code"],
      ['(IF "a)\nb")\n', "data"],
      ["CL-USER> ", "prompt"],
      ["1\n", "code"],
      ["1", "data"],
    ]);
    expect(highlightLispHtml("CL-USER> (+ 1 2)\n3")).toContain('<span class="tok-prompt">CL-USER&gt; </span>');
  });

  it("tells a block of Lisp from other text", () => {
    expect(looksLikeLisp("  (defun f ())")).toBe(true);
    expect(looksLikeLisp(";; a note")).toBe(true);
    expect(looksLikeLisp("CL-USER> (+ 1 2)")).toBe(true);
    expect(looksLikeLisp("npm install")).toBe(false);
    expect(looksLikeLisp('{"a": 1}')).toBe(false);
  });
});

describe("the Lisp language in an editor", () => {
  const state = (doc: string) => EditorState.create({ doc, extensions: [lisp()] });

  it("matches parens by structure, not inside strings or comments", () => {
    const s = state('(a "(" ; )\n b)');
    expect(matchBrackets(s, 0, 1)).toMatchObject({ matched: true, end: { from: 13, to: 14 } });
  });

  it("reports a paren with no partner as unmatched", () => {
    expect(matchBrackets(state("(a (b)"), 0, 1)).toMatchObject({ matched: false });
    expect(matchBrackets(state("a)"), 2, -1)).toMatchObject({ matched: false });
  });

  it("keeps the comment syntax and closing brackets the old mode had", () => {
    const s = state("(a)");
    expect(s.languageDataAt("commentTokens", 1)[0]).toEqual({ line: ";;", block: { open: "#|", close: "|#" } });
    expect(s.languageDataAt("closeBrackets", 1)[0]).toEqual({ brackets: ["(", "[", "{", '"'] });
  });
});

describe("an editor's tree after edits", () => {
  /** Every colored range, so two trees compare by what they show. */
  const shown = (tree: Tree) => {
    const out: string[] = [];
    highlightTree(tree, lispHighlighter, (from, to, cls) => void out.push(`${from}-${to}:${cls}`));
    return out;
  };

  it("keeps the parts an edit did not touch", () => {
    const doc = readFileSync("resources/lisp/tools.lisp", "utf8");
    const before = EditorState.create({ doc, extensions: [lisp()] });
    const after = before.update({ changes: { from: doc.length, insert: "\n(f)" } }).state;
    const [a, b] = [syntaxTree(before), syntaxTree(after)];
    expect(a.children.length).toBeGreaterThan(2);
    expect(b.children[0]).toBe(a.children[0]);
    expect(b.children[1]).toBe(a.children[1]);
  });

  it("colors the text as reading it from scratch would, whatever the edit", () => {
    const base = ["tools", "plugins", "tests"].map((f) => readFileSync(`resources/lisp/${f}.lisp`, "utf8")).join("\n");
    let seed = 7;
    const random = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const pieces = ["(", ")", '"', ";", "#|", "|#", "|", "x", "\n", " ", "'", "#+", "(defun f ()\n", "\\"];
    let state = EditorState.create({ doc: base, extensions: [lisp()] });
    for (let i = 0; i < 300; i++) {
      const at = random(state.doc.length);
      const change = random(3) === 0 ? { from: at, to: Math.min(state.doc.length, at + random(40)) } : { from: at, insert: pieces[random(pieces.length)] };
      state = state.update({ changes: change }).state;
      expect(shown(syntaxTree(state)), `after edit ${i}`).toEqual(shown(buildDocument(state.doc.toString())));
    }
  });
});
