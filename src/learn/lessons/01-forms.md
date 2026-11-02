---
title: Forms and evaluation
level: beginner
reading: ANSI Common Lisp, sections 2.1–2.4
---
Lisp code is made of **forms**. A number is a form, and so is a list. When
Lisp evaluates a list, the first element names an operator and the rest are
its arguments, so you write `(+ 2 3)` where other languages write `2 + 3`.

```lisp
(+ 2 3)
```

Press **Run** to send a form to the REPL. Arguments are evaluated first, from
left to right, so forms nest naturally:

```lisp
(* (+ 1 2) (- 10 4))
```

Many operators take any number of arguments. `(+)` is 0, and `(+ 1 2 3 4)` is
10. Division keeps exact answers exact: `(/ 1 3)` is the ratio `1/3`, not
0.333.

```lisp
(list (+ 1 2 3 4) (/ 1 3) (/ 6 3))
```

### Quote

Sometimes you want a list as data rather than as code. `quote`, written `'`,
stops evaluation and returns its argument as it is:

```lisp
(list '(+ 2 3) (+ 2 3))
```

The first element is the list `(+ 2 3)`; the second is the number 5.

### Defining a function

`defun` gives a name to a function. Its arguments are named in a list, and
the value of the last form in its body is what it returns:

```lisp
(defun square (x)
  (* x x))
```

After you run that, `(square 7)` returns 49. In your lesson file, put the
cursor in a `defun` and press ⌘↩ to evaluate it, the same as Run.

## Exercise: Twice

Define `(twice x)`, which returns `x` multiplied by two.

```stub
(defun twice (x)
  (not-written-yet 'twice))
```

```hint
The body is one form: multiply `x` by 2, written in prefix order.
```

```solution
(defun twice (x)
  (* 2 x))
```

```check
(is (equal 4 (twice 2)))
(is (equal 0 (twice 0)))
(is (equal -14 (twice -7)))
(is (equal 1 (twice 1/2)))
```

## Exercise: Average of three

Define `(average3 a b c)`, which returns the average of its three arguments.
With whole numbers the answer may be a ratio, such as 4/3, and that is fine.

```stub
(defun average3 (a b c)
  (not-written-yet 'average3))
```

```hint
Add the three numbers with one `+`, then divide the sum by 3.
```

```solution
(defun average3 (a b c)
  (/ (+ a b c) 3))
```

```check
(is (equal 2 (average3 1 2 3)))
(is (equal 4/3 (average3 1 1 2)))
(is (equal 0 (average3 -5 0 5)))
```

## Exercise: Code as data

Define `(sum-form a b)`, which returns the **list** `(+ a b)` with the values
of `a` and `b` in it, without adding them. `(sum-form 1 2)` returns the list
`(+ 1 2)`, and `(eval (sum-form 1 2))` then returns 3.

```stub
(defun sum-form (a b)
  (not-written-yet 'sum-form))
```

```hint
`list` makes a list of its arguments' values. The first element must be the
symbol `+` itself, so quote it: `'+`.
```

```solution
(defun sum-form (a b)
  (list '+ a b))
```

```check
(is (equal '(+ 1 2) (sum-form 1 2)))
(is (equal 7 (eval (sum-form 3 4))))
(is (equal '(+ x 5) (sum-form 'x 5)))
```
