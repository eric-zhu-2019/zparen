// The tokens in a file that could name a global symbol. Lisp then reads each
// one as the reader would, so only the ones that are that symbol get renamed.

import { packageAt } from "./forms";
import { forms, type Node, parse } from "./tree";

/**
 * One token that could be the symbol. `from` and `to` cover the name, after
 * any package prefix or #:, which is the part a rename replaces. A token in a
 * DEFPACKAGE clause is a designator: a name looked up in `pkg`. Any other
 * token is read as code in `pkg`, the file's package at that point.
 */
export type Candidate = { from: number; to: number; token: string; pkg: string; designator: boolean };

const DEFINE_PACKAGE = /^((uiop|uiop\/package|common-lisp|cl):)?(defpackage|define-package)$/;
/** DEFPACKAGE clauses whose names are symbols of the package being defined. */
const OWN_SYMBOLS = new Set([":export", ":shadow", ":intern", ":reexport", "#:export", "#:shadow", "#:intern"]);
/** Clauses that name a package first, then symbols from it. */
const FROM_PACKAGE = new Set([":import-from", ":shadowing-import-from", "#:import-from", "#:shadowing-import-from"]);

const atomText = (text: string, n: Node | undefined) => (n?.kind === "atom" ? text.slice(n.start, n.to) : null);

/** A package name as written in a DEFPACKAGE: #:foo, :foo, foo or "FOO", in Lisp's case. */
function packageName(text: string, n: Node | undefined): string | null {
  if (!n) return null;
  const raw = text.slice(n.start, n.to);
  if (n.kind === "string") return raw.slice(1, -1);
  return n.kind === "atom" ? raw.replace(/^#?:/, "").toUpperCase() : null;
}

/** The file's package at `pos`, or the one Lisp reads a file without IN-PACKAGE in. */
function contextPackage(text: string, pos: number, path: string): string {
  return packageAt(text, pos) ?? (path.endsWith(".asd") ? "ASDF-USER" : "COMMON-LISP-USER");
}

/** Where the name part of `token` starts, after a package prefix, :, or #:; null when it has escapes. */
function nameStart(token: string): number | null {
  if (/[|\\]/.test(token)) return null;
  return token.lastIndexOf(":") + 1;
}

/** Every token in `text` whose name, ignoring case, is `name`. */
export function candidates(text: string, path: string, name: string): Candidate[] {
  const want = name.toLowerCase();
  const out: Candidate[] = [];
  const add = (n: Node, pkg: string, designator: boolean) => {
    const token = text.slice(n.start, n.to);
    const at = nameStart(token);
    if (at === null || token.slice(at).toLowerCase() !== want) return;
    out.push({ from: n.start + at, to: n.to, token, pkg, designator });
  };
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.kind === "atom") {
        const token = text.slice(n.start, n.to);
        // A keyword or uninterned symbol outside DEFPACKAGE is a different symbol.
        if (!token.startsWith(":") && !token.startsWith("#:")) add(n, contextPackage(text, n.start, path), false);
        continue;
      }
      if (n.kind !== "list") continue;
      const [head, second] = forms(n.children);
      const op = atomText(text, head)?.toLowerCase() ?? "";
      if (DEFINE_PACKAGE.test(op)) {
        const defined = packageName(text, second);
        for (const clause of forms(n.children).slice(2)) {
          if (clause.kind !== "list") continue;
          const [kind, ...rest] = forms(clause.children);
          const k = atomText(text, kind)?.toLowerCase() ?? "";
          if (OWN_SYMBOLS.has(k) && defined) for (const d of rest) if (d.kind === "atom") add(d, defined, true);
          if (FROM_PACKAGE.has(k)) {
            const source = packageName(text, rest[0]);
            if (source) for (const d of rest.slice(1)) if (d.kind === "atom") add(d, source, true);
          }
        }
        continue;
      }
      // IN-PACKAGE names a package, not a symbol.
      if (/^((common-lisp|cl):)?in-package$/.test(op)) continue;
      walk(n.children);
    }
  };
  walk(parse(text));
  return out;
}

/** `text` with each edit made, edits in any order and not overlapping. */
export function applyEdits(text: string, edits: { from: number; to: number; insert: string }[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}
