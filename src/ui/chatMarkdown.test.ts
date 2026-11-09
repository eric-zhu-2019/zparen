import { describe, expect, it } from "vitest";
import { answerParts } from "./Chat";

const html = (text: string) => answerParts(text).flatMap((p) => ("html" in p ? [p.html] : [])).join("");

describe("an assistant answer", () => {
  it("renders headings, lists, emphasis, links and tables", () => {
    const out = html("## Why\n\n- one *two*\n- `three`\n\n1. first\n2. [spec](https://example.com)\n\n| a | b |\n| - | - |\n| 1 | 2 |");
    expect(out).toContain("<h2>Why</h2>");
    expect(out).toContain("<li>one <em>two</em></li>");
    expect(out).toContain("<code>three</code>");
    expect(out).toContain("<ol>");
    expect(out).toContain('<a href="https://example.com">spec</a>');
    expect(out).toContain("<td>1</td>");
  });

  it("keeps a line break inside a paragraph", () => {
    expect(html("first\nsecond")).toBe("<p>first<br>second</p>\n");
  });

  it("gives each top-level code block its own part, in order, while it is still arriving", () => {
    const parts = answerParts("Try this:\n\n```lisp\n(+ 1 2)\n;; => 3\n```\n\nThen **this**:\n\n```lisp\n(car");
    expect(parts.map((p) => ("html" in p ? "html" : p.lang))).toEqual(["html", "lisp", "html", "lisp"]);
    expect(parts[1]).toEqual({ lang: "lisp", code: "(+ 1 2)\n;; => 3" });
    expect(parts[3]).toEqual({ lang: "lisp", code: "(car" });
  });

  it("shows HTML as text, and an image as its description", () => {
    const out = html('<script>alert(1)</script>\n\n![a chart](https://example.com/x.png)');
    expect(out).not.toContain("<script");
    expect(out).toContain("&#60;script&#62;");
    expect(out).not.toContain("<img");
    expect(out).toContain('<span class="md-image">a chart</span>');
  });
});
