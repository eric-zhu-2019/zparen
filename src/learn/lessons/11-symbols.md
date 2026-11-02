---
title: Symbols and packages
level: intermediate
reading: ANSI Common Lisp, chapter 8
---
You have used symbols as names since lesson 1. A symbol is also an object
you can hold, compare and ask questions about.

### Symbols are objects

Every symbol has a name, which is a string. The reader turns lowercase into
uppercase, so `'apple` has the name `"APPLE"`:

```lisp
(list (symbol-name 'apple) (symbolp 'apple) (eq 'apple 'APPLE))
```

Bars keep a name exactly as written, spaces and lowercase included:

```lisp
(symbol-name '|Hello there|)
```

### Making and finding symbols

`intern` returns the symbol with a given name, and makes it first if it does
not exist. `find-symbol` only looks, and returns `nil` when there is no such
symbol:

```lisp
(list (intern "BANANA") (find-symbol "NO-SUCH-NAME-HERE"))
```

### Keywords

A symbol written with a leading colon is a **keyword**. Keywords live in the
package `KEYWORD`, they evaluate to themselves, and they are often used as
fixed labels:

```lisp
(list :red (eq :red ':red) (keywordp :red) (intern "BLUE" "KEYWORD"))
```

### Property lists

Each symbol can carry a small table of properties. `get` reads one, and
`setf` of `get` stores one:

```lisp
(progn
  (setf (get 'demo-sun 'color) 'yellow)
  (get 'demo-sun 'color))
```

### Gensyms

`gensym` makes a new symbol that belongs to no package. No code can type its
name, so it can never clash with another symbol. Lesson 13 uses this to write
safe macros:

```lisp
(let ((g (gensym)))
  (list g (symbol-package g)))
```

### Packages

A **package** is a table of names to symbols. Your lesson files start with
`in-package`, so the symbols they mention belong to the course's package.
`defpackage` makes a package, and `:export` lists the symbols other packages
may use without `::`:

```lisp
(defpackage #:demo-shapes
  (:use #:cl)
  (:export #:area))
```

After that, `(find-package "DEMO-SHAPES")` returns the package. The REPL's
prompt shows the current package, and the package box in ZParen's title bar
switches it.

## Exercise: Name length

Define `(symbol-length sym)`. It returns the number of characters in the
symbol's name. `(symbol-length 'abc)` and `(symbol-length :abc)` both return 3.

```stub
(defun symbol-length (sym)
  (not-written-yet 'symbol-length))
```

```hint
`symbol-name` gives the name as a string, and `length` counts its characters.
```

```solution
(defun symbol-length (sym)
  (length (symbol-name sym)))
```

```check
(is (equal 3 (symbol-length 'abc)))
(is (equal 3 (symbol-length :abc)))
(is (equal 11 (symbol-length '|hello world|)))
(is (equal 0 (symbol-length '||)))
```

## Exercise: Make a keyword

Define `(make-keyword-from string)`. It returns the keyword whose name is the
string in uppercase. `(make-keyword-from "color")` returns `:color`.

```stub
(defun make-keyword-from (string)
  (not-written-yet 'make-keyword-from))
```

```hint
`string-upcase` gives the uppercase name, and `intern` with `"KEYWORD"` as
its second argument finds or makes the keyword. `intern` returns two values;
only the first matters here.
```

```solution
(defun make-keyword-from (string)
  (values (intern (string-upcase string) "KEYWORD")))
```

```check
(is (eq :color (make-keyword-from "color")))
(is (eq :red (make-keyword-from "Red")))
(is (eq :two-words (make-keyword-from "two-words")))
(is-true (keywordp (make-keyword-from "anything")))
```

## Exercise: Fresh symbols

Define `(gensym-list n)`. It returns a list of `n` new symbols, each made by
`gensym`. No two may be the same, and none may belong to a package.

```stub
(defun gensym-list (n)
  (not-written-yet 'gensym-list))
```

```hint
`loop repeat n collect (gensym)` builds the list.
```

```solution
(defun gensym-list (n)
  (loop repeat n collect (gensym)))
```

```check
(is (equal 3 (length (gensym-list 3))))
(is (equal nil (gensym-list 0)))
(is-true (every (lambda (s) (and (symbolp s) (null (symbol-package s)))) (gensym-list 4)))
(is (equal 5 (length (remove-duplicates (gensym-list 5)))))
```
