import { readdirSync, readFileSync } from "node:fs";
import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { buildDocument } from "./lispSyntax";
import { initParinferSync } from "./parinfer";
import { run_parinfer, text_width } from "./parinfer/pkg/parinfer_wasm.js";
import { parenTrails } from "./parenTrail";

initParinferSync({ module: readFileSync(new URL("./parinfer/pkg/parinfer_wasm_bg.wasm", import.meta.url)) });

/** The trails as parinfer reports them: line, and start and end column in display width. */
function ours(source: string): string[] {
  const doc = Text.of(source.split("\n"));
  return parenTrails(buildDocument(source), doc).map(([from, to]) => {
    const line = doc.lineAt(from);
    const col = (pos: number) => text_width(line.text.slice(0, pos - line.from));
    return `${line.number - 1}:${col(from)}-${col(to)}`;
  });
}

/** Parinfer's own trails, and the text they are in, which it may have corrected. */
function parinfers(source: string): { text: string; trails: string[] } | null {
  const request = { mode: "smart", text: source, options: { lispVlineSymbols: true, lispBlockComments: true } };
  const answer = JSON.parse(run_parinfer(JSON.stringify(request)));
  if (!answer.success) return null;
  return { text: answer.text, trails: answer.parenTrails.map((t: { lineNo: number; startX: number; endX: number }) => `${t.lineNo}:${t.startX}-${t.endX}`) };
}

const trailText = (source: string) => {
  const doc = Text.of(source.split("\n"));
  return parenTrails(buildDocument(source), doc).map(([from, to]) => source.slice(from, to));
};

describe("paren trails", () => {
  it("are the closing parens that end a line, a comment after them aside", () => {
    expect(trailText("(defun f (x)\n  (when x ; c\n    (print x))) ; done\n(a (b) c)")).toEqual([")", ")))", ")"]);
    expect(trailText("(a\n )")).toEqual([")"]);
    expect(trailText("(a) b")).toEqual([]);
  });

  it("leave out parens that only look like closers", () => {
    expect(trailText('(a #\\)\n b "x)"\n |y)|)')).toEqual([")"]);
    expect(trailText("(a) #| ) |#\n")).toEqual([")"]);
  });

  it("keep the spaces between closers in one trail", () => {
    expect(trailText("(a (b) )")).toEqual([") )"]);
  });

  it("are the ones parinfer reports, in ZParen's own Lisp", () => {
    for (const f of readdirSync("resources/lisp").filter((name) => name.endsWith(".lisp"))) {
      const answer = parinfers(readFileSync(`resources/lisp/${f}`, "utf8"));
      expect(answer, `parinfer accepts ${f}`).not.toBeNull();
      expect(ours(answer!.text), f).toEqual(answer!.trails);
    }
  });

  it("are the ones parinfer reports, whatever the edit", () => {
    let text = readFileSync("resources/lisp/tools.lisp", "utf8");
    let seed = 11;
    const random = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const pieces = ["(", ")", ")))", "\n", "  ", "x", "; c", "#|", "|#", "|", '"', "#\\)", "'"];
    let compared = 0;
    for (let i = 0; i < 300; i++) {
      const at = random(text.length);
      const edited = random(3) === 0 ? text.slice(0, at) + text.slice(Math.min(text.length, at + random(30))) : text.slice(0, at) + pieces[random(pieces.length)] + text.slice(at);
      // Text parinfer refuses, such as an open string, stays refused, so such an edit is dropped.
      const answer = parinfers(edited);
      if (!answer) continue;
      text = answer.text;
      expect(ours(text), `after edit ${i}`).toEqual(answer.trails);
      compared++;
    }
    expect(compared).toBeGreaterThan(200);
  });
});
