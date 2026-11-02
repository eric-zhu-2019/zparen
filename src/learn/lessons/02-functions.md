---
title: Functions and conditionals
level: beginner
reading: ANSI Common Lisp, sections 2.5–2.6
---
A function that only computes one formula is useful, but most functions need
to choose. This lesson is about asking questions and acting on the answer.

### Truth in Lisp

Lisp has one false value, `nil`, which is also the empty list. Everything
else counts as true. The symbol `t` is the usual way to say "true" on purpose.

```lisp
(list (> 3 2) (> 2 3) (if '() 'yes 'no) (if 0 'yes 'no))
```

Notice that `0` counts as true. Only `nil` is false.

### Predicates

A **predicate** is a function that answers a yes-or-no question. Many of
their names end in `p`:

```lisp
(list (numberp 7) (numberp 'seven) (zerop 0) (evenp 10) (oddp 10) (listp '(a b)))
```

### if

`if` takes a test, a form to evaluate when the test is true, and an optional
form for when it is false. Only one of the two branches runs.

```lisp
(defun absolute (x)
  (if (< x 0)
      (- x)
      x))
```

After you run that, try `(absolute -5)` and `(absolute 5)` in the REPL.

### when and unless

When you only care about one branch, `when` and `unless` read better. Their
bodies can hold several forms, and they return `nil` when nothing runs.

```lisp
(list (when (> 5 1) 'big) (unless (> 5 1) 'small))
```

### and, or

`and` stops at the first false value; `or` stops at the first true one.
Each returns the value it stopped at, not just `t`, so `or` is handy for
defaults:

```lisp
(list (and 1 2 3) (and 1 nil 3) (or nil 'default) (or 'given 'default))
```

### cond

When there are more than two cases, `cond` tries each clause in order. Each
clause starts with a test; the first clause whose test is true runs its body.
A final test of `t` catches everything left.

```lisp
(defun grade (score)
  (cond ((>= score 90) 'a)
        ((>= score 80) 'b)
        ((>= score 70) 'c)
        (t 'try-again)))
```

## Exercise: The sign of a number

Define `(sign-of x)`, which returns `-1` when `x` is negative, `0` when it is
zero, and `1` when it is positive.

```stub
(defun sign-of (x)
  (not-written-yet 'sign-of))
```

```hint
There are three cases, so `cond` fits. `minusp`, `zerop` and `plusp` are
predicates for the three tests.
```

```solution
(defun sign-of (x)
  (cond ((minusp x) -1)
        ((zerop x) 0)
        (t 1)))
```

```check
(is (eql -1 (sign-of -12)))
(is (eql 0 (sign-of 0)))
(is (eql 1 (sign-of 7)))
(is (eql 1 (sign-of 1/2)))
```

## Exercise: Inside a range

Define `(in-range-p x low high)`, which returns true when `x` is at least
`low` and at most `high`, and `nil` otherwise. Return `t` for true.

```stub
(defun in-range-p (x low high)
  (not-written-yet 'in-range-p))
```

```hint
Two comparisons joined by `and` would work. `<=` also takes more than two
arguments: `(<= 1 2 3)` asks whether the numbers never go down.
```

```solution
(defun in-range-p (x low high)
  (<= low x high))
```

```check
(is (eql t (in-range-p 5 1 10)))
(is (eql t (in-range-p 1 1 10)))
(is (eql t (in-range-p 10 1 10)))
(is-false (in-range-p 0 1 10))
(is-false (in-range-p 11 1 10))
```

## Exercise: Small, medium or large

Define `(size-class n)`, which returns the keyword `:small` when `n` is below
10, `:medium` when it is below 100, and `:large` otherwise. A keyword is a
symbol written with a leading colon; it always evaluates to itself.

```stub
(defun size-class (n)
  (not-written-yet 'size-class))
```

```hint
Use `cond` and test the smallest range first, so each later clause only sees
numbers the earlier ones let through.
```

```solution
(defun size-class (n)
  (cond ((< n 10) :small)
        ((< n 100) :medium)
        (t :large)))
```

```check
(is (eq :small (size-class 3)))
(is (eq :medium (size-class 10)))
(is (eq :medium (size-class 99)))
(is (eq :large (size-class 100)))
```
