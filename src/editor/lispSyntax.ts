// The one reader for Lisp colors: src/lisp/tree.ts read into a syntax tree. The
// editor, the REPL, the assistant's code blocks, the Learn panel and the
// Markdown preview all color code from this tree, so they agree on strings,
// comments, |symbols|, #|nested|# comments and paren depth.

import { defineLanguageFacet, languageDataProp } from "@codemirror/language";
import { NodeProp, NodeSet, NodeType, Tree, type TreeFragment } from "@lezer/common";
import { highlightTree, styleTags, Tag, tagHighlighter, tags as t } from "@lezer/highlight";
import { forms, type Node, parse } from "../lisp/tree";

/**
 * A part of a text and how to read it. Code is what people type: heads of
 * forms and defined names get their colors. Data is what Lisp printed: the
 * same tokens, but a list is a value, not a call. A prompt is not Lisp.
 * Text outside every region is shown plain, such as a program's output.
 */
export type Region = { from: number; to: number; mode: "code" | "data" | "prompt"; tree?: Tree };

const DEPTHS = 6;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const OPEN = range(DEPTHS).map((i) => `Open${i}`);
const CLOSE = range(DEPTHS).map((i) => `Close${i}`);
const NAMES = ["Document", "Code", "Data", "List", ...OPEN, ...CLOSE, "Comment", "BlockComment", "String", "Char", "Number", "Keyword", "Meta", "Symbol", "Special", "Definition", "Prompt"] as const;
type Name = (typeof NAMES)[number];
const id = (name: Name) => NAMES.indexOf(name);

export const lispData = defineLanguageFacet({
  commentTokens: { line: ";;", block: { open: "#|", close: "|#" } },
  closeBrackets: { brackets: ["(", "[", "{", '"'] },
});

/** Paren colors by depth, as tags so that static code gets them from the same highlighter. */
const parenTags = range(DEPTHS).map(() => Tag.define(t.bracket));
const promptTag = Tag.define();

/** A run of top-level forms in an editor's tree, kept while its text stays. It has no name, so it is invisible. */
const CHUNK = NAMES.length;

const nodeSet = new NodeSet([
  ...NAMES.map((name, i) =>
    NodeType.define({
      id: i,
      name,
      top: name === "Document",
      props: [
        ...(name === "Document" ? [[languageDataProp, lispData] as [NodeProp<unknown>, unknown]] : []),
        // Any close paren matches any open one: each depth has its own node type for its color.
        ...(name.startsWith("Open") ? [[NodeProp.closedBy, CLOSE] as [NodeProp<unknown>, unknown]] : []),
        ...(name.startsWith("Close") ? [[NodeProp.openedBy, OPEN] as [NodeProp<unknown>, unknown]] : []),
      ],
    }),
  ),
  NodeType.define({ id: CHUNK }),
]).extend(
  styleTags({
    Comment: t.lineComment,
    BlockComment: t.blockComment,
    String: t.string,
    Char: t.character,
    Number: t.number,
    Keyword: t.atom,
    Meta: t.meta,
    Symbol: t.variableName,
    Special: t.keyword,
    Definition: t.definition(t.variableName),
    Prompt: promptTag,
    ...Object.fromEntries(range(DEPTHS).map((i) => [`${OPEN[i]} ${CLOSE[i]}`, parenTags[i]])),
  }),
);

/** CSS classes for the tags, shared by every place that shows Lisp. */
export const lispHighlighter = tagHighlighter([
  { tag: t.comment, class: "tok-comment" },
  { tag: t.string, class: "tok-string" },
  { tag: t.number, class: "tok-number" },
  { tag: t.atom, class: "tok-atom" },
  { tag: t.meta, class: "tok-meta" },
  { tag: t.keyword, class: "tok-special" },
  { tag: t.definition(t.variableName), class: "tok-def" },
  { tag: t.variableName, class: "tok-symbol" },
  { tag: promptTag, class: "tok-prompt" },
  ...parenTags.map((tag, i) => ({ tag, class: `cm-paren-${i}` })),
]);

// Heads that read as special. The first two lists are the ones CodeMirror's
// Common Lisp mode used, with let* fixed; the rest are Coalton's.
const SPECIAL_FORM = /^(block|let\*?|return-from|catch|load-time-value|setq|eval-when|locally|symbol-macrolet|flet|macrolet|tagbody|function|multiple-value-call|the|go|multiple-value-prog1|throw|if|progn|unwind-protect|labels|progv|quote)$/;
const ASSUME_BODY = /^with|^def|^do|^prog|case$|^cond$|bind$|when$|unless$/;
export const COALTON_FORMS = /^(coalton-toplevel|coalton|declare|match|fn|lisp|rec|for\*?|break|continue|return|derive|repr|monomorphize|specialize|inline|noinline|handle|protect|resumable|resume-to)$/;
const COALTON_PACKAGE_CLAUSES = /^(import|export|import-from|shadow)$/;
/** Heads whose next form is the name they define. */
const DEFINER = /^(def[a-z]*|define(-[a-z0-9-]+)?)$/;

const NUMBER = /^(?:[+-]?(?:\d+\/\d+|\d+\.?|(?:\d+\.\d*|\.\d+|\d+)(?:[esfdl][+-]?\d+)?)|#(?:[box]|\d+r)[+-]?[\da-z]+(?:\/[\da-z]+)?|#\*[01]*)$/i;
/** Reader syntax that tells Lisp how to read what follows: #:x, #P"…", #S(…), #1=, #1#, #. */
const META = /^(?:#:.*|#\d*[a-z]|#\.|#\d+[=#])$/i;

type Kind = "Number" | "Keyword" | "Meta" | "Symbol";

function atomKind(name: string): Kind {
  if (NUMBER.test(name)) return "Number";
  if (name.startsWith(":") || /^(nil|t)$/i.test(name)) return "Keyword";
  if (META.test(name)) return "Meta";
  return "Symbol";
}

/** A symbol's name in lower case without its package, as the head rules compare it. */
const bare = (name: string) => name.replace(/^[^:|]*::?(?=[^:])/, "").toLowerCase();

type Context = {
  text: string;
  code: boolean;
  /** Atoms that print as #<…>, which Lisp cannot read back. */
  opaque: Set<Node>;
  out: number[];
};

/** The list whose children are being read: its depth, the head and depth of the list around it, and whether it is a defined name such as (setf foo). */
type Parent = { depth: number; parentHead: string | null; parentDepth: number; names: boolean };

function emit(cx: Context, name: Name, from: number, to: number, start: number) {
  cx.out.push(id(name), from, to, cx.out.length + 4 - start);
}

function emitNodes(cx: Context, nodes: Node[], parent: Parent | null, strays: number[]) {
  const code = forms(nodes);
  const head = parent && code[0]?.kind === "atom" ? code[0] : null;
  const headName = head ? bare(cx.text.slice(head.start, head.to)) : null;
  const named = cx.code && headName !== null && DEFINER.test(headName) ? code[1] : undefined;
  // In a name list such as (setf foo), the first symbol is the name, and setf's second.
  const nameAtoms = parent?.names
    ? code.filter((n, i) => n.kind === "atom" && (i === 0 || (i === 1 && headName === "setf")))
    : [];
  let s = 0;
  for (const n of nodes) {
    while (s < strays.length && strays[s] < n.start) (emit(cx, CLOSE[0] as Name, strays[s], strays[s] + 1, cx.out.length), s++);
    const start = cx.out.length;
    switch (n.kind) {
      case "comment":
        emit(cx, "Comment", n.start, n.to, start);
        break;
      case "blockComment":
        emit(cx, "BlockComment", n.start, n.to, start);
        break;
      case "string":
        emit(cx, "String", n.start, n.to, start);
        break;
      case "char":
        emit(cx, "Char", n.start, n.to, start);
        break;
      case "atom": {
        if (cx.opaque.has(n)) {
          emit(cx, "Meta", n.start, n.to, start);
          break;
        }
        let kind: Name = atomKind(cx.text.slice(n.start, n.to));
        if (cx.code && kind === "Symbol") {
          if (n === named || nameAtoms.includes(n)) kind = "Definition";
          else if (n === head && parent && special(headName!, parent)) kind = "Special";
        }
        emit(cx, kind, n.start, n.to, start);
        break;
      }
      case "list": {
        const depth = parent ? parent.depth + 1 : 0;
        const openLength = cx.text[n.start] === "#" ? 2 : 1;
        emit(cx, OPEN[depth % DEPTHS] as Name, n.start, n.start + openLength, cx.out.length);
        emitNodes(cx, n.children, { depth, parentHead: headName, parentDepth: parent?.depth ?? -1, names: n === named }, []);
        if (n.closed) emit(cx, CLOSE[depth % DEPTHS] as Name, n.to - 1, n.to, cx.out.length);
        emit(cx, "List", n.start, n.to, start);
        break;
      }
    }
  }
  while (s < strays.length) (emit(cx, CLOSE[0] as Name, strays[s], strays[s] + 1, cx.out.length), s++);
}

/** Whether `name`, the head of `list`, reads as special. */
function special(name: string, list: Parent): boolean {
  if (COALTON_FORMS.test(name)) return true;
  // A .coal file's (package …) form and its clauses, at the top level only.
  if (name === "package" && list.depth === 0) return true;
  if (COALTON_PACKAGE_CLAUSES.test(name) && list.parentHead === "package" && list.parentDepth === 0) return true;
  return SPECIAL_FORM.test(name) || ASSUME_BODY.test(name);
}

/** The spans of #<…> in printed text, outside strings and |symbols|. */
function unreadables(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "#" && text[i + 1] === "\\") i += 2;
    else if (c === '"' || c === "|") {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
    } else if (c === "#" && text[i + 1] === "<") {
      if (depth++ === 0) start = i;
      i++;
    } else if (c === ">" && depth > 0 && --depth === 0) spans.push([start, i + 1]);
  }
  return spans;
}

/** Root-level close parens with no open one, which tree.ts drops. */
function strayCloses(text: string, nodes: Node[]): number[] {
  const out: number[] = [];
  const covered = nodes.map((n) => [Math.min(n.from, n.start), n.to]).sort((a, b) => a[0] - b[0]);
  let pos = 0;
  const scan = (to: number) => {
    for (let i = pos; i < to; i++) {
      // A #+(…) or #-(…) feature expression tree.ts dropped with its form.
      if (text[i] === "#" && (text[i + 1] === "+" || text[i + 1] === "-") && text[i + 2] === "(") {
        let depth = 0;
        let j = i + 2;
        do {
          if (text[j] === "(") depth++;
          else if (text[j] === ")") depth--;
          j++;
        } while (j < to && depth > 0);
        i = j - 1;
      } else if (text[i] === ")") out.push(i);
    }
  };
  for (const [from, to] of covered) {
    scan(Math.min(from, text.length));
    pos = Math.max(pos, to);
  }
  scan(text.length);
  return out;
}

function shift(nodes: Node[], by: number) {
  for (const n of nodes) {
    n.from += by;
    n.start += by;
    n.to += by;
    shift(n.children, by);
  }
}

/** Adds the region's tokens, without its wrapper node, to `out`. */
function regionContent(text: string, region: Region, out: number[]) {
  const code = region.mode === "code";
  let slice = text.slice(region.from, region.to);
  const spans = code ? [] : unreadables(slice);
  // Printed objects are read as blanks, then put back as one token each, inside the list they sit in.
  for (const [a, b] of spans) slice = slice.slice(0, a) + " ".repeat(b - a) + slice.slice(b);
  const nodes = parse(slice);
  const strays = strayCloses(slice, nodes);
  const opaque = new Set<Node>();
  for (const [a, b] of spans) {
    const node: Node = { kind: "atom", from: a, start: a, to: b, children: [], closed: true };
    opaque.add(node);
    let level = nodes;
    for (;;) {
      const list = level.find((n) => n.kind === "list" && n.start < a && b <= n.to);
      if (!list) break;
      level = list.children;
    }
    const at = level.findIndex((n) => n.start > a);
    level.splice(at < 0 ? level.length : at, 0, node);
  }
  shift(nodes, region.from);
  emitNodes({ text, code, opaque, out }, nodes, null, strays.map((s) => s + region.from));
}

/** Where a chunk may start: before a root node at a line's start, with no other node's prefix running past it. */
function cuts(text: string, nodes: Node[]): number[] {
  const out: number[] = [];
  let earliest = Infinity;
  for (let k = nodes.length - 1; k >= 0; k--) {
    earliest = Math.min(earliest, nodes[k].from);
    if (earliest === nodes[k].from && text[earliest - 1] === "\n") out.push(earliest);
  }
  return out.reverse();
}

const CHUNK_SIZE = 2048;

/** Chunks of the text from `from` to `to`, read now, which must start and end at clean cuts. */
function readChunks(text: string, from: number, to: number): { from: number; to: number; tree: Tree }[] {
  const slice = text.slice(from, to);
  const nodes = parse(slice);
  const strays = strayCloses(slice, nodes).map((x) => x + from);
  shift(nodes, from);
  const bounds = [from];
  for (const c of cuts(text, nodes)) if (c - bounds[bounds.length - 1] >= CHUNK_SIZE && to - c >= CHUNK_SIZE / 2) bounds.push(c);
  bounds.push(to);
  const chunks = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const [a, b] = [bounds[i], bounds[i + 1]];
    const out: number[] = [];
    emitNodes(
      { text, code: true, opaque: new Set(), out },
      nodes.filter((n) => n.start >= a && n.start < b),
      null,
      strays.filter((x) => x >= a && x < b),
    );
    for (let j = 0; j < out.length; j += 4) (out[j + 1] -= a), (out[j + 2] -= a);
    chunks.push({ from: a, to: b, tree: Tree.build({ buffer: out, nodeSet, topID: CHUNK, length: b - a }) });
  }
  return chunks;
}

/**
 * Whether reading text from `from` to `to` ends where Lisp would be at the
 * top level again: after a newline, with every form, string and comment
 * closed, and no quote or #+ waiting for a form.
 */
function endsClean(text: string, from: number, to: number): boolean {
  if (to < text.length && text[to - 1] !== "\n") return false;
  const slice = text.slice(from, to);
  const nodes = parse(slice);
  let end = 0;
  for (const n of nodes) {
    if (n.to >= slice.length && to < text.length) return false;
    end = Math.max(end, n.to);
  }
  return slice.slice(end).replace(/[\s)]/g, "") === "";
}

/**
 * The editor's tree. Unchanged chunks of the last tree are kept; the text
 * from a change to the next chunk that still starts at the top level is read
 * again. Typing in a long file reads a few thousand characters, not the file.
 */
export function buildDocument(text: string, fragments: readonly TreeFragment[] = []): Tree {
  const kept: { from: number; to: number; tree: Tree }[] = [];
  for (const f of fragments) {
    const old = f.tree;
    for (let i = 0; i < old.children.length; i++) {
      const child = old.children[i];
      if (!(child instanceof Tree) || child.type.id !== CHUNK) continue;
      const at = old.positions[i] - f.offset;
      if (at >= f.from && at + child.length <= f.to) kept.push({ from: at, to: at + child.length, tree: child });
    }
  }
  kept.sort((a, b) => a.from - b.from);
  const chunks: { from: number; to: number; tree: Tree }[] = [];
  let pos = 0;
  for (const k of kept) {
    if (k.from < pos) continue;
    // Keeping a chunk after a change needs the text before it to end at the top level.
    // When it does not, as after typing an open paren or quote, the rest reads differently.
    if (k.from > pos && !endsClean(text, pos, k.from)) break;
    if (k.from > pos) chunks.push(...readChunks(text, pos, k.from));
    chunks.push(k);
    pos = k.to;
  }
  if (pos < text.length || chunks.length === 0) chunks.push(...readChunks(text, pos, text.length));
  const out: number[] = [];
  chunks.forEach((c, i) => out.push(i, c.from, c.to, -1));
  return Tree.build({ buffer: out, nodeSet, topID: id("Document"), length: text.length, reused: chunks.map((c) => c.tree) });
}

/** A tree of one region, positioned from 0, to reuse while the region's text stays. */
export function regionTree(text: string, mode: "code" | "data"): Tree {
  const out: number[] = [];
  regionContent(text, { from: 0, to: text.length, mode }, out);
  return Tree.build({ buffer: out, nodeSet, topID: id(mode === "code" ? "Code" : "Data"), length: text.length });
}

/** The syntax tree of `text` read by `regions`, which must be in order and not overlap. */
export function buildTree(text: string, regions: Region[] = [{ from: 0, to: text.length, mode: "code" }]): Tree {
  const out: number[] = [];
  const reused: Tree[] = [];
  let pos = 0;
  for (const region of regions) {
    // Regions out of order or past the end would make an invalid tree.
    const r = { ...region, from: Math.max(region.from, pos), to: Math.min(region.to, text.length) };
    if (r.to <= r.from) continue;
    pos = r.to;
    if (r.mode === "prompt") out.push(id("Prompt"), r.from, r.to, 4);
    else if (r.tree && r.tree.length === r.to - r.from) {
      out.push(reused.length, r.from, r.to, -1);
      reused.push(r.tree);
    } else {
      const start = out.length;
      regionContent(text, r, out);
      out.push(id(r.mode === "code" ? "Code" : "Data"), r.from, r.to, out.length + 4 - start);
    }
  }
  return Tree.build({ buffer: out, nodeSet, topID: id("Document"), length: text.length, reused });
}

const PROMPT = /^[A-Za-z][\w.+*/!%&$:-]*> /;

/** Whether a block with no language reads as Lisp: it starts with a form, a comment or a prompt. */
export function looksLikeLisp(text: string): boolean {
  const first = text.trimStart();
  return /^[(;'`]|^#[|'(\\:+-]/.test(first) || PROMPT.test(first);
}

/**
 * How to read a code block that may be a REPL session. A line that starts
 * with a prompt such as "CL-USER> " is input up to the end of the line where
 * its form ends; the lines after it, up to the next prompt, are what Lisp
 * printed. Without a prompt the whole block is code.
 */
export function sessionRegions(text: string): Region[] {
  const prompts: { from: number; to: number }[] = [];
  for (let at = 0; at <= text.length; ) {
    const end = text.indexOf("\n", at);
    const line = text.slice(at, end < 0 ? text.length : end);
    const m = PROMPT.exec(line);
    if (m) prompts.push({ from: at, to: at + m[0].length });
    if (end < 0) break;
    at = end + 1;
  }
  if (!prompts.length) return [{ from: 0, to: text.length, mode: "code" }];
  const regions: Region[] = [];
  if (prompts[0].from > 0) regions.push({ from: 0, to: prompts[0].from, mode: "code" });
  prompts.forEach((p, i) => {
    const next = i + 1 < prompts.length ? prompts[i + 1].from : text.length;
    regions.push({ from: p.from, to: p.to, mode: "prompt" });
    const input = text.slice(p.to, next);
    const form = forms(parse(input))[0];
    const complete = form && (form.kind === "list" ? form.closed : form.kind !== "string" || (form.to - form.start > 1 && input[form.to - 1] === '"'));
    let inputEnd = next;
    if (complete) {
      const lineEnd = text.indexOf("\n", p.to + form.to);
      inputEnd = lineEnd < 0 || lineEnd > next ? next : lineEnd + 1;
    } else if (!form) {
      const lineEnd = text.indexOf("\n", p.to);
      inputEnd = lineEnd < 0 || lineEnd > next ? next : lineEnd + 1;
    }
    regions.push({ from: p.to, to: inputEnd, mode: "code" });
    if (inputEnd < next) regions.push({ from: inputEnd, to: next, mode: "data" });
  });
  return regions;
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Lisp code as HTML in the editor's colors, for code that is shown, not edited. */
export function highlightLispHtml(code: string): string {
  const tree = buildTree(code, sessionRegions(code));
  let html = "";
  let pos = 0;
  highlightTree(tree, lispHighlighter, (from, to, classes) => {
    if (from > pos) html += escapeHtml(code.slice(pos, from));
    html += `<span class="${classes}">${escapeHtml(code.slice(from, to))}</span>`;
    pos = to;
  });
  return html + escapeHtml(code.slice(pos));
}
