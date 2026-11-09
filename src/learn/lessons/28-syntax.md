---
title: Anaphora, places and new syntax
level: master
project: Query engine
reading: On Lisp, chapters 12, 14 and 17
---
The engine works. This last lesson adds three tools from *On Lisp* that make
it, and any program, shorter to use: a macro that names a value for you, a
macro that updates any place, and new syntax for queries.

### Anaphoric macros

Code often tests a value and then uses it:

```lisp
(let ((found (position 'c '(a b c))))
  (if found (+ found 1) :none))
```

An **anaphoric** macro binds the value to a fixed name, `it`, so the code can
say `(aif (position 'c '(a b c)) (+ it 1) :none)`. Most macros use `gensym` so
that they cannot capture the caller's names. Here capture is the point: the macro captures `it` on purpose, and its users know
the name. *On Lisp* chapter 14 is about such macros.

### Places

`setf`, `incf` and `push` work on any **place**: a variable, `(aref v i)`,
`(gethash key table)`, an accessor. A macro of your own that updates a place
must evaluate the parts of the place once, or `(aref v (incf i))` moves `i`
twice. `get-setf-expansion` gives the pieces to do it right: temporary
variables for the parts, their forms, a variable for the new value, the code
that stores it, and the code that reads the place.

```lisp
(get-setf-expansion '(aref v (incf i)))
```

`define-modify-macro` covers the simple cases, and *On Lisp* chapter 12 the
rest. A macro that takes the place needs `&environment`, so that it expands
places correctly inside `macrolet` and `symbol-macrolet`.

### Read macros

The reader turns text into Lisp data, and **read macros** extend it. `'x`
reads as `(quote x)`, and `#'f` as `(function f)`. You can add your own to a
**readtable**. Change a copy, never the standard one, and bind `*readtable*`
to it where you want the new syntax:

```lisp
(let ((*readtable* (copy-readtable nil)))
  (set-macro-character #\! (lambda (stream char)
                             (declare (ignore char))
                             (list 'not (read stream t nil t))))
  (read-from-string "!done"))
```

To use your syntax in files, libraries such as `named-readtables` name a
readtable, and a file chooses it with `(in-readtable ...)`.

## Exercise: Anaphoric if

Define the macro `(aif test then &optional else)`. It runs `test` once, binds
its value to `it`, and runs `then` when the value is true, `else` otherwise.

```stub
(defmacro aif (test then &optional else)
  (not-written-yet 'aif))
```

```hint
The expansion is `(let ((it ,test)) (if it ,then ,else))`. The symbol `it`
here is the one in the query engine's package, so a caller's `it` in that
package is the same symbol.
```

```solution
(defmacro aif (test then &optional else)
  `(let ((it ,test))
     (if it ,then ,else)))
```

```check
(is (equal 3 (aif (position 'c '(a b c)) (+ it 1) :none)))
(is (eq :none (aif (position 'z '(a b c)) (+ it 1) :none)))
(let ((n 0))
  (aif (incf n) it)
  (is (equal 1 n)))
(is (equal "Paul Graham"
           (aif (lookup '(author graham ?name))
                (cdr (assoc '?name (first it))))))
```

## Exercise: Update any place

Define the macro `(updatef place fn &rest args)`. It sets `place` to the
result of calling `fn` on the place's value and `args`, and returns the new
value. It evaluates the parts of `place`, `fn` and each of `args` once.
`(updatef (gethash key table 0) #'+ 2)` adds 2 to the entry.

```stub
(defmacro updatef (place fn &rest args)
  (not-written-yet 'updatef))
```

```hint
Add `&environment env` to the lambda list. Take the five values of
`(get-setf-expansion place env)`. Expand into a `let*` that binds each
temporary variable to its form, then a gensym to `,fn`, then the store
variable to `(funcall fn-var ,getter ,@args)`, and ends with the setter.
```

```solution
(defmacro updatef (place fn &rest args &environment env)
  (multiple-value-bind (vars forms stores setter getter) (get-setf-expansion place env)
    (let ((f (gensym "FN")))
      `(let* (,@(mapcar #'list vars forms)
              (,f ,fn)
              (,(first stores) (funcall ,f ,getter ,@args)))
         ,setter))))
```

```check
(let ((x 5))
  (is (equal 15 (updatef x #'* 3)))
  (is (equal 15 x)))
(let ((v (vector 1 2 3)) (i -1))
  (is (equal 11 (updatef (aref v (incf i)) #'+ 10)))
  (is (equalp #(11 2 3) v))
  (is (equal 0 i)))
(let ((books (make-hash-table)))
  (dolist (fact *facts*)
    (when (eq (first fact) 'book)
      (updatef (gethash (third fact) books 0) #'1+)))
  (is (equal 2 (gethash 'graham books)))
  (is (equal 1 (gethash 'weitz books))))
```

## Exercise: Syntax for queries

Define `(query-syntax readtable)`. It adds the read macro `#?` to
`readtable`, so that `#?query` reads as `(interpret-query 'query)`, and
returns the readtable.

```lisp
(let ((*readtable* (query-syntax (copy-readtable nil))))
  (eval (read-from-string "#?(book ?title graham _)")))
```

```stub
(defun query-syntax (readtable)
  (not-written-yet 'query-syntax))
```

```hint
`#` is a dispatching macro character, so use `set-dispatch-macro-character`
with `#\#`, `#\?`, a function of `(stream char arg)`, and the readtable. The
function reads the query with `(read stream t nil t)` and returns
`` `(interpret-query ',query) ``.
```

```solution
(defun query-syntax (readtable)
  (set-dispatch-macro-character #\# #\?
                                (lambda (stream char arg)
                                  (declare (ignore char arg))
                                  `(interpret-query ',(read stream t nil t)))
                                readtable)
  readtable)
```

```check
(let ((before (get-dispatch-macro-character #\# #\? *readtable*)))
  (let ((*package* (symbol-package 'query-syntax))
        (*readtable* (query-syntax (copy-readtable nil))))
    (is (equal '(interpret-query '(book ?title graham _))
               (read-from-string "#?(book ?title graham _)")))
    (is (equal 2 (length (eval (read-from-string "#?(book ?title graham _)"))))))
  (is (eq before (get-dispatch-macro-character #\# #\? *readtable*))))
```
