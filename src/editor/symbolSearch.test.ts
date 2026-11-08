import { describe, expect, it } from "vitest";
import { symbolQuery } from "./symbolSearch";

const matches = (line: string, ch: number, text: string, whole = true) => {
  const q = symbolQuery(line, ch, whole)!;
  return [...text.matchAll(new RegExp(q.source, "gim"))].map((m) => m.index);
};

describe("symbolQuery", () => {
  it("takes the whole symbol, not the word before a hyphen", () => {
    expect(symbolQuery("(rect-shape x)", 2, true)?.start).toBe(1);
    expect(matches("(rect-shape x)", 2, "(rect-shape rect my-rect-shape #'rect-shape RECT-SHAPE)")).toEqual([1, 33, 44]);
  });

  it("matches inside other symbols for g*", () => {
    expect(matches("rect-shape", 0, "my-rect-shape rect-shapes", false)).toEqual([3, 14]);
  });

  it("seeks the next symbol on the line, as Vim seeks the next word", () => {
    expect(symbolQuery("  (*foo* 1)", 0, true)).toMatchObject({ start: 3 });
    expect(matches("  (*foo* 1)", 0, "*foo* foo")).toEqual([0]);
  });

  it("falls back to punctuation, and to nothing on a blank line", () => {
    expect(symbolQuery("  ))", 0, true)).toEqual({ start: 2, source: "\\)\\)" });
    expect(symbolQuery("   ", 0, true)).toBeNull();
  });
});
