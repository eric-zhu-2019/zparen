import { describe, expect, it } from "vitest";
import { renameLocal } from "./rename";

/** `src` with the symbol at `|` renamed to `to`, or the reason it was refused. */
function rename(src: string, to: string): string {
  const pos = src.indexOf("|");
  const text = src.replace("|", "");
  const r = renameLocal(text, pos, to);
  if (!r.ok) return `refused: ${r.reason}`;
  let out = text;
  for (const e of [...r.edits].reverse()) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

describe("renaming a local", () => {
  it("renames a parameter and its uses, from the binding or from a use", () => {
    expect(rename("(defun f (|x y) (+ x y (* x 2)))", "n")).toBe("(defun f (n y) (+ n y (* n 2)))");
    expect(rename("(defun f (x y) (+ |x y))", "n")).toBe("(defun f (n y) (+ n y))");
  });

  it("leaves a shadowing binding and its uses alone", () => {
    expect(rename("(let ((|x 1)) (list x (let ((x 2)) x) x))", "a")).toBe("(let ((a 1)) (list a (let ((x 2)) x) a))");
    expect(rename("(let ((x 1)) (list x (let ((|x 2)) x) x))", "a")).toBe("(let ((x 1)) (list x (let ((a 2)) a) x))");
  });

  it("renames a use in an initial value as the outer variable, as LET reads it", () => {
    expect(rename("(defun f (|x) (let ((x (1+ x))) x))", "n")).toBe("(defun f (n) (let ((x (1+ n))) x))");
  });

  it("leaves quoted symbols, keywords, strings and other variables with the name in other forms", () => {
    expect(rename("(defun f (|x) (list 'x :x \"x\" x))", "n")).toBe("(defun f (n) (list 'x :x \"x\" n))");
    expect(rename("(defun f (|x) x) (defun g (x) x)", "n")).toBe("(defun f (n) n) (defun g (x) x)");
  });

  it("renames inside a backquote only where a comma makes it code", () => {
    expect(rename("(defmacro m (|x) `(list x ,x ',x))", "n")).toBe("(defmacro m (n) `(list x ,n ',n))");
  });

  it("renames a local function and its calls", () => {
    expect(rename("(labels ((|walk (n) (walk n))) (walk 1) #'walk)", "visit")).toBe("(labels ((visit (n) (visit n))) (visit 1) #'visit)");
  });

  it("renames LOOP, DOLIST and DESTRUCTURING-BIND variables", () => {
    expect(rename("(loop for |k in ks collect k)", "key")).toBe("(loop for key in ks collect key)");
    expect(rename("(dolist (|i is) (print i))", "item")).toBe("(dolist (item is) (print item))");
    expect(rename("(destructuring-bind (a |b) l (list a b))", "c")).toBe("(destructuring-bind (a c) l (list a c))");
  });

  it("refuses a name that would capture or be captured", () => {
    expect(rename("(defun f (|x y) (+ x y))", "y")).toMatch(/^refused: y is already used/);
    expect(rename("(defun f (|x) (+ x *limit*))", "*limit*")).toMatch(/^refused: \*limit\* is already used/);
  });

  it("refuses a &key parameter and a WITH-SLOTS slot, whose names mean something outside", () => {
    expect(rename("(defun f (&key |size) size)", "n")).toMatch(/^refused: size is a &key parameter/);
    expect(rename("(defun f (&key ((:size |size))) size)", "n")).toBe("(defun f (&key ((:size n))) n)");
    expect(rename("(with-slots (|width) box width)", "w")).toMatch(/^refused: width is a slot name/);
  });

  it("refuses a name used for both a local function and a variable", () => {
    expect(rename("(flet ((f () 1)) (let ((|f 2)) (+ f (f))))", "g")).toMatch(/^refused: f names both/);
  });

  it("refuses globals, free symbols and bad new names", () => {
    expect(rename("(defun f (x) (|print x))", "p")).toMatch(/^refused: print is not a local/);
    expect(rename("(defun f (|x) x)", "a b")).toMatch(/^refused: A name cannot hold/);
    expect(rename("(defun f (|x) x)", "12")).toMatch(/^refused: 12 reads as a number/);
    expect(rename("(defun f (|x) x)", "&rest")).toMatch(/^refused: Names starting with &/);
  });

  it("makes no edits when the name is the same", () => {
    expect(rename("(defun f (|x) x)", "X")).toBe("(defun f (x) x)");
  });
});
