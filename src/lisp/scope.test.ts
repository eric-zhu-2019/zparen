import { describe, expect, it } from "vitest";
import { localBinding } from "./scope";

/** The binding found for the symbol at the `|` in `src`, shown as the text from there. */
function bindingOf(src: string) {
  const pos = src.indexOf("|");
  const text = src.replace("|", "");
  const at = localBinding(text, pos);
  return at === null ? null : text.slice(at, at + 12);
}

describe("local bindings for gd", () => {
  it("finds a function's parameters", () => {
    expect(bindingOf("(defun f (alpha &optional (beta 2) &key gamma) (list alpha beta |gamma))")).toBe("gamma) (list");
    expect(bindingOf("(defun f (alpha) (+ |alpha 1))")).toBe("alpha) (+ al");
  });

  it("finds LET and LET* variables, the innermost first", () => {
    expect(bindingOf("(let ((x 1)) (let ((x 2)) (print |x)))")).toBe("x 2)) (print");
    expect(bindingOf("(let* ((a 1) (b a)) (+ a |b))")).toBe("b a)) (+ a b");
  });

  it("finds FLET and LABELS functions, and the parameters of the one the cursor is in", () => {
    expect(bindingOf("(labels ((walk (node) (walk |node))) (walk 1))")).toBe("node) (walk ");
    expect(bindingOf("(flet ((twice (n) (* 2 n))) (|twice 4))")).toBe("twice (n) (*");
  });

  it("finds DOLIST, DESTRUCTURING-BIND, LOOP and method parameters", () => {
    expect(bindingOf("(dolist (item items) (print |item))")).toBe("item items) ");
    expect(bindingOf("(destructuring-bind (a (b c)) x (list a b |c))")).toBe("c)) x (list ");
    expect(bindingOf("(loop for (k v) in pairs collect |v)")).toBe("v) in pairs ");
    expect(bindingOf("(defmethod area ((s square) unit) (* (side |s) unit))")).toBe("s square) un");
  });

  it("reads an initial value or a list form outside the variables it is about to bind", () => {
    expect(bindingOf("(let ((x 1)) (let ((x (+ |x 1))) x))")).toBe("x 1)) (let (");
    expect(bindingOf("(defun f (x) (let ((x (1+ |x))) x))")).toBe("x) (let ((x ");
    expect(bindingOf("(let* ((a 1) (a (1+ |a))) a)")).toBe("a 1) (a (1+ ");
    expect(bindingOf("(defun f (items) (dolist (items |items) items))")).toBe("items) (doli");
    expect(bindingOf("(defun f (v) (multiple-value-bind (v w) (g |v) w))")).toBe("v) (multiple");
    expect(bindingOf("(defun f (i) (do ((i (1+ |i) (1+ i))) (t)))")).toBe("i) (do ((i (");
    expect(bindingOf("(do ((i 0 (1+ |i))) (t))")).toBe("i 0 (1+ i)))");
  });

  it("keeps a local function's parameters inside that function", () => {
    expect(bindingOf("(defun f (n) (flet ((g (n) n)) (g |n)))")).toBe("n) (flet ((g");
  });

  it("finds nothing for a free symbol, a keyword or a global function", () => {
    expect(bindingOf("(defun f (x) (+ x |y))")).toBeNull();
    expect(bindingOf("(defun f (x) (list |:x x))")).toBeNull();
    expect(bindingOf("(defun f (x) (|print x))")).toBeNull();
  });
});
