// Lisp code as HTML in the editor's colors, for code the Learn panel shows but
// does not edit: comments, strings, keywords, numbers, definitions and parens.

const SPECIAL = new Set([
  "defun", "defmacro", "defvar", "defparameter", "defstruct", "defclass", "defmethod", "defgeneric", "if", "cond", "case",
  "typecase", "let", "let*", "flet", "labels", "lambda", "when", "unless", "and", "or", "progn", "block", "return-from",
  "return", "loop", "do", "dolist", "dotimes", "setf", "quote", "function", "in-package", "multiple-value-bind",
  "unwind-protect", "catch", "throw", "handler-case",
]);

const DEFINERS = new Set(["defun", "defmacro", "defvar", "defparameter", "defstruct", "defclass", "defmethod", "defgeneric"]);

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function highlightLisp(src: string): string {
  let out = "";
  let depth = 0;
  let defining = false;
  let i = 0;
  const span = (cls: string, text: string) => `<span class="tok-${cls}">${escapeHtml(text)}</span>`;
  while (i < src.length) {
    const c = src[i];
    if (c === ";") {
      const end = src.indexOf("\n", i);
      const j = end < 0 ? src.length : end;
      out += span("comment", src.slice(i, j));
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += span("string", src.slice(i, j + 1));
      i = j + 1;
    } else if (c === "(" || c === ")") {
      if (c === ")") depth = Math.max(0, depth - 1);
      out += `<span class="tok-paren-${depth % 4}">${c}</span>`;
      if (c === "(") depth++;
      i++;
    } else if (/\s/.test(c)) {
      out += c;
      i++;
    } else {
      let j = i;
      while (j < src.length && !/[\s()";]/.test(src[j])) j++;
      const tok = src.slice(i, j);
      const lower = tok.toLowerCase();
      if (defining && !tok.startsWith("'")) {
        out += span("def", tok);
        defining = false;
      } else if (/^[-+]?\d+([./]\d+)?$/.test(tok)) out += span("number", tok);
      else if (tok.startsWith(":") || tok.startsWith("#:")) out += span("keyword", tok);
      else if (SPECIAL.has(lower)) {
        out += span("special", tok);
        defining = DEFINERS.has(lower);
      } else out += escapeHtml(tok);
      i = j;
    }
  }
  return out;
}
