import { readFileSync } from "node:fs";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { beforeAll, describe, expect, it } from "vitest";
import { lispIndentation } from "../editor/indent";
import { initParinferSync, parinfer } from "../editor/parinfer";
import { lispRegionStart } from "../editor/region";
import { layout, replBuffer } from "./replBuffer";

beforeAll(() => {
  initParinferSync({ module: readFileSync(new URL("../editor/parinfer/pkg/parinfer_wasm_bg.wasm", import.meta.url)) });
});

const PROMPT = "LEARN-LISP> ";

/** A REPL at an empty prompt, with its extensions in the order the REPL has them. */
function repl(): EditorState {
  return EditorState.create({
    doc: `${PROMPT}(+ 1 2)\n3\n${PROMPT}`,
    extensions: [
      replBuffer({ reading: () => false, submit: () => {}, history: () => null, inspect: () => {} }),
      lispRegionStart.of((s) => s.field(layout).inputStart),
      lispIndentation(() => ({})),
      parinfer(),
    ],
  });
}

const input = (s: EditorState) => s.doc.sliceString(s.field(layout).inputStart);
const at = (s: EditorState, pos: number, text: string, userEvent: string) =>
  s.update({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, userEvent } as TransactionSpec).state;

describe("text that lands in the REPL input", () => {
  it("is balanced when pasted at the prompt", () => {
    const s = repl();
    expect(input(at(s, s.doc.length, "(count '(+ 1 2)", "input.paste"))).toBe("(count '(+ 1 2))");
  });

  it("is balanced when pasted or typed where the cursor stood in the transcript", () => {
    const s = repl();
    // Vim's normal mode keeps the cursor on the prompt's last character, before the input.
    for (const pos of [s.doc.length - 1, 3]) {
      expect(input(at(s, pos, "(count '(+ 1 2)", "input.paste")), `paste at ${pos}`).toBe("(count '(+ 1 2))");
      expect(input(at(s, pos, "(", "input.type")), `typed at ${pos}`).toBe("()");
    }
  });

  it("leaves the transcript as it was", () => {
    const s = repl();
    const pasted = at(s, 3, "(count", "input.paste");
    expect(pasted.doc.sliceString(0, pasted.field(layout).inputStart)).toBe(s.doc.toString());
  });
});
