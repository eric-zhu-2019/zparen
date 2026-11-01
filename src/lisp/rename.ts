// Renaming a local variable or local function: the binding and every use that
// resolves to it, read from text as gd does, so it works on code not yet loaded.

import { bindersIn, bindingOf, symbolName } from "./scope";
import { type Node, parse, pathAt } from "./tree";

export type Edit = { from: number; to: number; insert: string };

/** What renaming the symbol at a position would change, or why it cannot. */
export type LocalRename =
  | { ok: true; name: string; uses: Node[]; owner: Node }
  | { ok: false; reason: string; global?: { from: number; to: number } };

/** Where a node sits: how many backquotes are open, and whether it is data rather than code. */
type Quoting = { depth: number; data: boolean };

/** Code atoms under `nodes`: symbols the evaluator reads, not quoted data. */
function codeAtoms(text: string, nodes: Node[], outer: Quoting, out: Node[]): Node[] {
  for (const n of nodes) {
    let q = outer;
    const prefix = text.slice(n.from, n.start);
    for (let i = 0; i < prefix.length; i++) {
      if (prefix.startsWith("#'", i)) i++;
      else if (prefix[i] === "'") q = { ...q, data: true };
      else if (prefix[i] === "`") q = { depth: q.depth + 1, data: true };
      // A comma reads its form, even after a quote, as in `(list ',x).
      else if (prefix[i] === "," && q.depth > 0) q = { depth: q.depth - 1, data: q.depth > 1 };
    }
    if (n.kind === "list") {
      // #( is a vector literal: data, like a quoted list.
      codeAtoms(text, n.children, text[n.start] === "#" ? { ...q, data: true } : q, out);
    } else if (n.kind === "atom" && !q.data) out.push(n);
  }
  return out;
}

const CODE: Quoting = { depth: 0, data: false };

/** The local symbol at `pos` and its uses, or the reason it cannot be renamed. */
export function localRename(text: string, pos: number): LocalRename {
  const nodes = parse(text);
  const path = pathAt(nodes, pos);
  const at = path[path.length - 1];
  const symbol = symbolName(text, at);
  if (!at || at.kind !== "atom" || !symbol) return { ok: false, reason: "Put the cursor on a symbol to rename it." };
  const found = bindingOf(text, path);
  // A symbol no form here binds may be a global one, which renames across the project.
  if (!found) return { ok: false, reason: `${symbol} is not a local variable or local function here.`, global: { from: at.start, to: at.to } };
  if (found.fixed === "key") return { ok: false, reason: `${symbol} is a &key parameter. Its name is also the keyword callers pass, so renaming it would change how they call.` };
  if (found.fixed === "slot") return { ok: false, reason: `${symbol} is a slot name in WITH-SLOTS. Renaming it would read a different slot.` };
  const { owner, binder } = found;
  // Lisp keeps functions and variables apart, and gd does not, so a name used both ways is left alone.
  if (bindersIn(text, path[0]).some((b) => b.fn !== found.fn && symbolName(text, b.node) === symbol)) {
    return { ok: false, reason: `${symbol} names both a local function and a variable in this form, so ZParen cannot tell its uses apart.` };
  }
  const uses = codeAtoms(text, [owner], CODE, []).filter((n) => {
    if (symbolName(text, n) !== symbol) return false;
    return bindingOf(text, pathAt(nodes, n.start))?.binder === binder;
  });
  return { ok: true, name: symbol, uses, owner };
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eEdDfFsSlL][+-]?\d+)?$|^[+-]?\d+\/\d+$/;

/** Why `name` cannot be a new local name, or null when it can. */
export function badName(name: string): string | null {
  if (!name) return "Type a name.";
  if (/[\s()'"`,;|\\#:]/.test(name)) return "A name cannot hold spaces or any of ( ) ' \" ` , ; | \\ # :";
  if (NUMBER.test(name) || name === ".") return `${name} reads as a number, not a symbol.`;
  if (name.startsWith("&")) return "Names starting with & are lambda list keywords.";
  return null;
}

/** The edits that rename the local symbol at `pos` to `newName`, or why they cannot be made. */
export function renameLocal(
  text: string,
  pos: number,
  newName: string,
): { ok: true; edits: Edit[]; owner: { from: number; to: number } } | { ok: false; reason: string } {
  const target = localRename(text, pos);
  if (!target.ok) return target;
  const bad = badName(newName);
  if (bad) return { ok: false, reason: bad };
  const lower = newName.toLowerCase();
  const owner = { from: target.owner.from, to: target.owner.to };
  if (lower === target.name) return { ok: true, edits: [], owner };
  // A use of the new name inside the form would be captured by the renamed binding, or capture its uses.
  const taken = codeAtoms(text, [target.owner], CODE, []).some((n) => symbolName(text, n) === lower);
  if (taken) return { ok: false, reason: `${newName} is already used in this form. Renaming to it could change which binding a symbol means.` };
  return { ok: true, edits: target.uses.map((n) => ({ from: n.start, to: n.to, insert: newName })), owner };
}
