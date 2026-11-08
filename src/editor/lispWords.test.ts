import { describe, expect, it } from "vitest";
import { moveToWord } from "./lispWords";

const doc = (...lines: string[]) => ({ getLine: (n: number) => lines[n], firstLine: () => 0, lastLine: () => lines.length - 1 });
const at = (ch: number, line = 0) => ({ line, ch });

describe("Lisp word motions", () => {
  const d = doc("(draw rect-shape 'my-rect)", "", "  (*x*)");

  it("w moves over a whole symbol, then stops at punctuation", () => {
    expect(moveToWord(d, at(1), 1, true, false, false)).toEqual(at(6));
    expect(moveToWord(d, at(6), 1, true, false, false)).toEqual(at(17));
    expect(moveToWord(d, at(17), 1, true, false, false)).toEqual(at(18));
    expect(moveToWord(d, at(6), 2, true, false, false)).toEqual(at(18));
  });

  it("e and ge end at the symbol's last character", () => {
    expect(moveToWord(d, at(6), 1, true, true, false)).toEqual(at(15));
    expect(moveToWord(d, at(18), 1, false, true, false)).toEqual(at(17));
  });

  it("b goes back to the symbol's start", () => {
    expect(moveToWord(d, at(12), 1, false, false, false)).toEqual(at(6));
    expect(moveToWord(d, at(6), 1, false, false, false)).toEqual(at(1));
  });

  it("keeps Vim's empty lines and line ends", () => {
    expect(moveToWord(d, at(25), 1, true, false, false)).toEqual(at(0, 1));
    expect(moveToWord(d, at(0, 1), 1, true, false, false)).toEqual(at(2, 2));
    expect(moveToWord(d, at(2, 2), 1, true, false, false)).toEqual(at(3, 2));
  });

  it("W still takes every non-blank run", () => {
    expect(moveToWord(d, at(0), 1, true, false, true)).toEqual(at(6));
    expect(moveToWord(d, at(6), 1, true, false, true)).toEqual(at(17));
  });
});
