import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { activeGuide, indentGuides } from "./indentGuides";
import { buildDocument } from "./lispSyntax";

/** Each line with a | at each guide's column, over the space there. */
function draw(source: string): string {
  const doc = Text.of(source.split("\n"));
  const guides = indentGuides(buildDocument(source), doc);
  return source
    .split("\n")
    .map((text, i) => {
      const chars = [...text];
      for (const g of guides.get(i + 1) ?? []) chars[g.col] = "|";
      return Array.from(chars, (c) => c ?? " ").join("").replace(/\s+$/, "");
    })
    .join("\n");
}

describe("indent guides", () => {
  it("run down from each form's open paren, in the indentation of the lines below", () => {
    const text = "(defun f (x)\n  (let ((a 1)\n        (b 2))\n    (when a\n      (print b))))";
    expect(draw(text)).toBe("(defun f (x)\n| (let ((a 1)\n| |    |(b 2))\n| | (when a\n| | | (print b))))");
  });

  it("skip forms on one line, and lines indented no further than the paren", () => {
    expect(draw("(a (b c)\n   d)")).toBe("(a (b c)\n|  d)");
    expect(draw("(a\n)")).toBe("(a\n)");
  });

  it("go on through a blank line inside a form, but not after the form ends", () => {
    expect(draw("(a\n  (b\n\n    c))\n\n(d)").split("\n")[2]).toBe("| |");
    expect(draw("(a\n  b)\n\n(d)").split("\n")[2]).toBe("");
  });

  it("show inside a string only left of where the string opens", () => {
    expect(draw('(defun f ()\n  "Doc\n   more"\n  1)')).toBe('(defun f ()\n| "Doc\n|  more"\n| 1)');
    expect(draw('(a\n  (b "x\n      y"))')).toBe('(a\n| (b "x\n| |   y"))');
  });

  it("are the depth of their paren", () => {
    const text = "(a\n  (b\n    c))";
    const guides = indentGuides(buildDocument(text), Text.of(text.split("\n")));
    expect(guides.get(3)!.map((g) => g.depth)).toEqual([0, 1]);
  });

  it("mark the innermost form around the cursor that spans lines", () => {
    const text = "(a\n  (b\n    (c d)))";
    const doc = Text.of(text.split("\n"));
    const tree = buildDocument(text);
    expect(activeGuide(tree, doc, text.indexOf("d"))).toBe(text.indexOf("(b"));
    expect(activeGuide(tree, doc, text.indexOf("a"))).toBe(0);
    expect(activeGuide(buildDocument("(a b)"), Text.of(["(a b)"]), 1)).toBe(null);
  });
});
