import type { CodeMirrorV, Vim } from "@replit/codemirror-vim";
import { isSymbolChar } from "../lisp/forms";

// Vim's * takes a word of letters, digits and "_", so on rect-shape it searches for
// rect. These bindings take the whole Lisp symbol instead, and leave w, b and e as
// they are.

/** Characters that end a symbol, the same as isSymbolChar. */
const DELIMITER = "\\s()'\"`,;|";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * What * searches for from column ch: the symbol there or next on the line, as Vim
 * seeks the next word. With no symbol, the next run of other characters, as Vim
 * does. Whole symbols match only between delimiters, so rect does not match
 * rect-shape.
 */
export function symbolQuery(line: string, ch: number, whole: boolean): { start: number; source: string } | null {
  const isSym = (c: string | undefined) => c !== undefined && isSymbolChar(c);
  const isOther = (c: string | undefined) => c !== undefined && !isSymbolChar(c) && !/\s/.test(c);
  let at = ch;
  while (at < line.length && !isSym(line[at])) at++;
  let test = isSym;
  if (at >= line.length) {
    at = ch;
    while (at < line.length && !isOther(line[at])) at++;
    if (at >= line.length) return null;
    test = isOther;
  }
  let start = at;
  let end = at;
  while (start > 0 && test(line[start - 1])) start--;
  while (end < line.length && test(line[end])) end++;
  const text = escape(line.slice(start, end));
  const source = whole && test === isSym ? `(?<![^${DELIMITER}])${text}(?![^${DELIMITER}])` : text;
  return { start, source };
}

type GlobalState = {
  query: RegExp;
  isReversed: boolean;
  jumpList: { cachedCursor?: unknown };
  registerController: { getRegister(name: string): { setText(text: string): void } };
  searchHistoryController: { pushInput(text: string): void; reset(): void };
};

/** Binds *, #, g* and g# to search for the Lisp symbol under the cursor. */
export function configureSymbolSearch(vim: typeof Vim) {
  vim.defineAction("zlSymbolSearch", (cm: CodeMirrorV, args: { forward?: boolean; whole?: boolean; repeat?: number }) => {
    const head = cm.getCursor();
    const found = symbolQuery(cm.getLine(head.line), head.ch, !!args.whole);
    if (!found) return;
    const g = vim.getVimGlobalState_() as unknown as GlobalState;
    // Lisp reads symbols in any case, and Vim's * ignores case too.
    g.query = new RegExp(found.source, "im");
    g.isReversed = !args.forward;
    g.registerController.getRegister("/").setText(found.source);
    g.searchHistoryController.pushInput(found.source);
    g.searchHistoryController.reset();
    // As Vim's *: the jump starts where the cursor was, and the search from the symbol's start.
    g.jumpList.cachedCursor = head;
    cm.setCursor({ line: head.line, ch: found.start });
    vim.handleKey(cm, `${(args.repeat ?? 1) > 1 ? args.repeat : ""}n`, "mapping");
  });
  for (const [keys, forward, whole] of [["*", true, true], ["#", false, true], ["g*", true, false], ["g#", false, false]] as const) {
    vim.mapCommand(keys, "action", "zlSymbolSearch", { forward, whole }, { context: "normal" });
  }
}
