// Where a symbol is bound locally: by a lambda list, LET, FLET and LABELS,
// DESTRUCTURING-BIND, DO, DOLIST, LOOP and the like. This is what Vim's gd
// means, and code being written is often not loaded, so it is read from text.

import { forms, type Node, parse, pathAt } from "./tree";

const name = (text: string, n: Node | undefined) => (n && n.kind === "atom" ? text.slice(n.start, n.to).toLowerCase() : null);

const head = (text: string, list: Node) => name(text, forms(list.children)[0])?.replace(/^(cl|common-lisp):/, "") ?? null;

/** The variables a lambda list binds, with their nodes: required, &optional, &key, &rest, &aux and destructured parts.
 * Plain &key variables, whose names are also the keywords callers pass, go into `keys` too. */
function lambdaListVars(text: string, list: Node | undefined, specialized = false, keys: Node[] = []): Node[] {
  if (!list || list.kind !== "list") return list && list.kind === "atom" ? [list] : [];
  const out: Node[] = [];
  let section = "required";
  for (const p of forms(list.children)) {
    const atom = name(text, p);
    if (atom?.startsWith("&")) {
      section = atom;
      continue;
    }
    if (p.kind === "atom") {
      out.push(p);
      if (section === "&key") keys.push(p);
    } else if (p.kind === "list") {
      const [first, , third] = forms(p.children);
      if (section === "required" && !specialized) out.push(...lambdaListVars(text, p, false, keys));
      else if (section === "&key" && first?.kind === "list") out.push(...forms(first.children).slice(1, 2));
      else if (first) {
        out.push(first);
        if (section === "&key") keys.push(first);
      }
      // (name default supplied-p) binds the supplied-p variable too.
      if ((section === "&optional" || section === "&key") && third?.kind === "atom") out.push(third);
    }
  }
  return out;
}

/** The lambda list of a defining or LAMBDA form, after its name and any method qualifiers. */
function definitionLambdaList(kind: string, parts: Node[]): { list?: Node; specialized: boolean } {
  if (kind === "lambda") return { list: parts[1], specialized: false };
  if (kind === "defmethod") {
    const list = parts.slice(2).find((p) => p.kind === "list");
    return { list, specialized: true };
  }
  return { list: parts[2], specialized: false };
}

/**
 * A symbol a form binds, and where in the form the binding is visible.
 * `fixed` marks a name that also means something outside the binding: a plain
 * &key variable is the keyword callers pass, and a WITH-SLOTS symbol is a slot.
 * `fn` marks a local function or macro name, which Lisp keeps apart from variables.
 */
type Binder = { node: Node; visible: (pos: number) => boolean; fixed?: "key" | "slot"; fn?: boolean };

const after = (n: Node | undefined) => (pos: number) => n !== undefined && pos > n.to;
const within = (n: Node, pos: number) => n.start < pos && pos < n.to;

/** The symbols `list` binds, by kind of form. */
function binders(text: string, list: Node): Binder[] {
  const kind = head(text, list);
  if (!kind) return [];
  const parts = forms(list.children);
  const each = (nodes: Node[], visible: (n: Node) => (pos: number) => boolean) => nodes.map((node) => ({ node, visible: visible(node) }));
  switch (kind) {
    case "defun":
    case "defmacro":
    case "defmethod":
    case "defgeneric":
    case "lambda":
    case "define-compiler-macro": {
      const { list: ll, specialized } = definitionLambdaList(kind, parts);
      const keys: Node[] = [];
      // A parameter is visible in the body and in the default forms after it.
      return each(lambdaListVars(text, ll, specialized, keys), after).map((b) => (keys.includes(b.node) ? { ...b, fixed: "key" as const } : b));
    }
    case "let":
    case "symbol-macrolet":
    case "prog":
    case "let*":
    case "prog*": {
      const bindings = parts[1];
      if (!bindings || bindings.kind !== "list") return [];
      const sequential = kind.endsWith("*");
      return forms(bindings.children).flatMap((b) => {
        const node = b.kind === "atom" ? b : b.kind === "list" ? forms(b.children)[0] : undefined;
        // LET's initial values are read before any of its variables exist; LET*'s see the earlier ones.
        return node ? [{ node, visible: after(sequential ? b : bindings) }] : [];
      });
    }
    case "flet":
    case "labels":
    case "macrolet": {
      const defs = parts[1];
      if (!defs || defs.kind !== "list") return [];
      const local = forms(defs.children).filter((d) => d.kind === "list");
      return local.flatMap((d) => {
        const [fname, params] = forms(d.children);
        // Each local function's parameters are visible in its own body only.
        const own = lambdaListVars(text, params).map((node) => ({ node, visible: (pos: number) => within(d, pos) && pos > node.to }));
        // LABELS functions can call each other; FLET and MACROLET ones are visible in the body.
        const named = fname?.kind === "atom" ? [{ node: fname, fn: true, visible: kind === "labels" ? (pos: number) => pos > defs.start : after(defs) }] : [];
        return [...own, ...named];
      });
    }
    case "destructuring-bind":
    case "multiple-value-bind":
      return parts[1] ? each(lambdaListVars(text, parts[1]), () => after(parts[2] ?? parts[1])) : [];
    case "dolist":
    case "dotimes":
    case "do-symbols":
    case "do-external-symbols": {
      const spec = parts[1];
      if (!spec || spec.kind !== "list") return [];
      const [variable, source] = forms(spec.children);
      // The list or count is read before the variable exists; the result form sees it.
      return variable?.kind === "atom" ? [{ node: variable, visible: after(source ?? variable) }] : [];
    }
    case "with-slots":
    case "with-accessors": {
      const spec = parts[1];
      if (!spec || spec.kind !== "list") return [];
      const visible = after(parts[2] ?? spec);
      return forms(spec.children).flatMap((s): Binder[] => {
        if (s.kind === "atom") return kind === "with-slots" ? [{ node: s, visible, fixed: "slot" }] : [];
        const first = forms(s.children)[0];
        return first?.kind === "atom" ? [{ node: first, visible }] : [];
      });
    }
    case "do":
    case "do*": {
      const vars = parts[1];
      if (vars?.kind !== "list") return [];
      const specs = forms(vars.children);
      // Step forms see every variable; DO's initial values see none, DO*'s the earlier ones.
      const inStep = (pos: number) => specs.some((v) => v.kind === "list" && forms(v.children)[2] && pos >= forms(v.children)[2].from && pos <= v.to);
      return specs.flatMap((v) => {
        const node = v.kind === "list" ? forms(v.children)[0] : v;
        if (node?.kind !== "atom") return [];
        const seen = after(kind === "do*" ? v : vars);
        return [{ node, visible: (pos: number) => seen(pos) || inStep(pos) }];
      });
    }
    case "loop": {
      // LOOP's FOR, AS and WITH name a variable, or a destructuring list of them.
      const out: Binder[] = [];
      for (let i = 1; i < parts.length - 1; i++) {
        if (/^:?(for|as|with)$/.test(name(text, parts[i]) ?? "")) out.push(...each(lambdaListVars(text, parts[i + 1]), after));
      }
      return out;
    }
    default: {
      // WITH-OPEN-FILE and other WITH- macros conventionally bind their first argument's first symbol.
      if (!kind.startsWith("with-") || parts[1]?.kind !== "list") return [];
      const first = forms(parts[1].children)[0];
      return first?.kind === "atom" ? [{ node: first, visible: after(parts[1]) }] : [];
    }
  }
}

type Resolved = { binder: Binder; owner: Node };

/** The binding of the symbol `at`, with the form that makes it, or null when `at` is free. */
function resolve(text: string, path: Node[]): Resolved | null {
  const at = path[path.length - 1];
  const symbol = name(text, at);
  if (!at || !symbol || /^[:&]/.test(symbol)) return null;
  for (const list of path.slice(0, -1).reverse()) {
    if (list.kind !== "list") continue;
    const found = binders(text, list);
    const self = found.find((b) => b.node === at);
    if (self) return { binder: self, owner: list };
    const hit = found.find((b) => name(text, b.node) === symbol && b.visible(at.start));
    if (hit) return { binder: hit, owner: list };
  }
  return null;
}

/** A whole symbol: its text, lowercased and without package, as the reader would usually see it. */
export const symbolName = name;

/** The local binding of the symbol at the end of `path`, the form that makes it, and what kind it is. */
export function bindingOf(text: string, path: Node[]): { binder: Node; owner: Node; fixed?: "key" | "slot"; fn: boolean } | null {
  const r = resolve(text, path);
  return r && { binder: r.binder.node, owner: r.owner, fixed: r.binder.fixed, fn: r.binder.fn ?? false };
}

/** Every local function and variable binder inside `node`, for checks that span a form. */
export function bindersIn(text: string, node: Node): { node: Node; fn: boolean }[] {
  if (node.kind !== "list") return [];
  return [...binders(text, node).map((b) => ({ node: b.node, fn: b.fn ?? false })), ...node.children.flatMap((c) => bindersIn(text, c))];
}

/**
 * Where the symbol at `pos` is bound locally, as the start of the binding
 * symbol, or null when no enclosing form binds it. The innermost binding wins.
 */
export function localBinding(text: string, pos: number): number | null {
  return resolve(text, pathAt(parse(text), pos))?.binder.node.start ?? null;
}
