import type { Vim } from "@replit/codemirror-vim";
import { isSymbolChar } from "../lisp/forms";

// Vim's word is letters, digits and "_", so w stops inside rect-shape. Vim's Lisp
// support adds the other symbol characters to a word, and so does this. The library
// fixes its word test when it loads, so this replaces its word motion, moveByWords,
// with the same code (findWord and moveToWord from codemirror-vim, MIT) and a Lisp
// test. The name stays, so w, b, e, ge, W, B, E, gE, insert-mode ⌃W and cw's
// special case all use it.

type Lines = { getLine(n: number): string; firstLine(): number; lastLine(): number };
type Pos = { line: number; ch: number };
type Word = { from: number; to: number; line: number };

const isWord = (c: string) => c !== "" && isSymbolChar(c);
const isPunct = (c: string) => c !== "" && !isSymbolChar(c) && !/\s/.test(c);
const isBig = (c: string) => /\S/.test(c);

function findWord(cm: Lines, cur: Pos, forward: boolean, bigWord: boolean, emptyLineIsWord: boolean): Word | null {
  let lineNum = cur.line;
  let pos = cur.ch;
  let line = cm.getLine(lineNum);
  const dir = forward ? 1 : -1;
  const tests = bigWord ? [isBig] : [isWord, isPunct];
  const isLine = (n: number) => n >= cm.firstLine() && n <= cm.lastLine();

  if (emptyLineIsWord && line === "") {
    lineNum += dir;
    if (!isLine(lineNum)) return null;
    line = cm.getLine(lineNum);
    pos = forward ? 0 : line.length;
  }
  while (true) {
    if (emptyLineIsWord && line === "") return { from: 0, to: 0, line: lineNum };
    const stop = dir > 0 ? line.length : -1;
    while (pos !== stop) {
      let found = false;
      for (let i = 0; i < tests.length && !found; i++) {
        if (!tests[i](line.charAt(pos))) continue;
        const start = pos;
        while (pos !== stop && tests[i](line.charAt(pos))) pos += dir;
        found = start !== pos;
        // Started at the end of a word: find the next one.
        if (start === cur.ch && lineNum === cur.line && pos === start + dir) continue;
        return { from: Math.min(start, pos + 1), to: Math.max(start, pos), line: lineNum };
      }
      if (!found) pos += dir;
    }
    lineNum += dir;
    if (!isLine(lineNum)) return null;
    line = cm.getLine(lineNum);
    pos = dir > 0 ? 0 : line.length;
  }
}

/** Where w, e, b or ge moves from cur, repeat times, with Lisp symbols as words. */
export function moveToWord(cm: Lines, cur: Pos, repeat: number, forward: boolean, wordEnd: boolean, bigWord: boolean): Pos | undefined {
  const curStart = { ...cur };
  const words: Word[] = [];
  if ((forward && !wordEnd) || (!forward && wordEnd)) repeat++;
  // For e, empty lines are not words, as in Vim.
  const emptyLineIsWord = !(forward && wordEnd);
  for (let i = 0; i < repeat; i++) {
    const word = findWord(cm, cur, forward, bigWord, emptyLineIsWord);
    if (!word) {
      const eod = cm.getLine(cm.lastLine()).length;
      words.push(forward ? { line: cm.lastLine(), from: eod, to: eod } : { line: 0, from: 0, to: 0 });
      break;
    }
    words.push(word);
    cur = { line: word.line, ch: forward ? word.to - 1 : word.from };
  }
  const shortCircuit = words.length !== repeat;
  const first = words[0];
  let last = words.pop();
  if (forward && !wordEnd) {
    // w: not started inside a word, so the extra word at the end goes.
    if (!shortCircuit && (first.from !== curStart.ch || first.line !== curStart.line)) last = words.pop();
    return last && { line: last.line, ch: last.from };
  }
  if (forward && wordEnd) return last && { line: last.line, ch: last.to - 1 };
  if (!forward && wordEnd) {
    // ge
    if (!shortCircuit && (first.to !== curStart.ch || first.line !== curStart.line)) last = words.pop();
    return last && { line: last.line, ch: last.to };
  }
  return last && { line: last.line, ch: last.from };
}

export function configureLispWords(vim: typeof Vim) {
  vim.defineMotion("moveByWords", ((cm: Lines, head: Pos, args: { repeat?: number; forward?: boolean; wordEnd?: boolean; bigWord?: boolean }) =>
    moveToWord(cm, head, args.repeat ?? 1, !!args.forward, !!args.wordEnd, !!args.bigWord)) as never);
}
