---
title: First macros
level: intermediate
reading: ANSI Common Lisp, chapter 10
---
A function receives the values of its arguments. A **macro** receives the
argument forms themselves, as lists, and returns a new form. Lisp then runs
that new form in place of the macro call. Macros let you add new kinds of
expression to the language.

### Code that writes code

`defmacro` looks like `defun`, but its body builds code:

```lisp
(defmacro set-to-zero (place)
  (list 'setf place 0))
```

After you run it, `(let ((x 5)) (set-to-zero x) x)` returns 0. The macro saw
the symbol `x`, not the number 5, and wrote `(setf x 0)`.

### Macroexpansion

`macroexpand-1` shows the form a macro call turns into, without running it.
In ZParen, put the cursor on a macro call and press ⇧⌘M to see the same thing
in the editor:

```lisp
(macroexpand-1 '(when (> x 1) (print x) x))
```

### Backquote

Building code with `list` gets hard to read. A **backquote**, `` ` ``, works
like a quote, except that a comma, `,`, inserts the value of a form, and `,@`
splices a list into place:

```lisp
(let ((name 'total) (forms '((print 1) (print 2))))
  `(progn (setq ,name 0) ,@forms))
```

The same macro, written with backquote, reads like the code it makes:

```lisp
(defmacro set-to-zero-too (place)
  `(setf ,place 0))
```

### When to write a macro

Write a function when you can. Write a macro only when you need to control
when, or whether, the arguments are evaluated, or when you need a new
binding form. `when`, `unless`, `dolist` and `setf` are all macros for that
reason.

### Variable capture

A macro that makes its own variable can clash with a variable of the same
name in the caller's code. This mistake is **variable capture**. `gensym`,
from lesson 11, makes a name that no caller can use:

```lisp
(let ((g (gensym)))
  `(let ((,g 10)) (+ ,g ,g)))
```

## Exercise: Unless

Define the macro `(my-unless test &body body)`. It runs the forms in `body`
and returns the last value only when `test` is false. When `test` is true, it
returns `nil` and runs nothing.

```stub
(defmacro my-unless (test &body body)
  (not-written-yet 'my-unless))
```

```hint
Expand into an `if` whose "then" part is `nil` and whose "else" part is a
`progn` of the body: `(progn ,@body)`.
```

```solution
(defmacro my-unless (test &body body)
  `(if ,test nil (progn ,@body)))
```

```check
(is (equal 2 (eval '(my-unless nil 1 2))))
(is (equal nil (eval '(my-unless t 1 2))))
(is (equal 2 (eval '(let ((n 0)) (my-unless (> n 5) (incf n) (incf n)) n))))
(is (equal 0 (eval '(let ((n 0)) (my-unless (zerop n) (incf n)) n))))
```

## Exercise: Repeat while

Define the macro `(repeat-while test &body body)`. It runs `body` again and
again, as long as `test` is true, and checks `test` before each run.

```stub
(defmacro repeat-while (test &body body)
  (not-written-yet 'repeat-while))
```

```hint
`loop` can do the work: `(loop while ,test do (progn ,@body))`. You can also
expand into `do` with no variables.
```

```solution
(defmacro repeat-while (test &body body)
  `(loop while ,test do (progn ,@body)))
```

```check
(is (equal nil (eval '(repeat-while nil (error "The body ran.")))))
(is (equal 5 (eval '(let ((n 0)) (repeat-while (< n 5) (incf n)) n))))
(is (equal 10 (eval '(let ((n 10)) (repeat-while (< n 5) (incf n)) n))))
(is (equal '(2 1 0) (eval '(let ((acc nil) (i 0)) (repeat-while (< i 3) (push i acc) (incf i)) acc))))
```

## Exercise: Swap two places

Define the macro `(swap-values a b)`. It exchanges the values of the two
places `a` and `b`, which can be variables or forms such as `(first list)`.
It must work even when the caller's variables have the same names as yours.

```stub
(defmacro swap-values (a b)
  (not-written-yet 'swap-values))
```

```hint
Keep the old value of `a` in a variable named by `gensym`, set `a` to `b`, then
set `b` to the kept value. A plain name such as `tmp` breaks when the caller
has a variable named `tmp` too.
```

```solution
(defmacro swap-values (a b)
  (let ((old (gensym)))
    `(let ((,old ,a))
       (setf ,a ,b
             ,b ,old)
       nil)))
```

```check
(is (equal '(2 1) (eval '(let ((x 1) (y 2)) (swap-values x y) (list x y)))))
(is (equal '(2 1) (eval '(let ((tmp 1) (old 2)) (swap-values tmp old) (list tmp old)))))
(is (equal '(b a c) (eval '(let ((l (list 'a 'b 'c))) (swap-values (first l) (second l)) l))))
```
