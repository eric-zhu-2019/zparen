---
title: Control flow and multiple values
level: beginner
reading: ANSI Common Lisp, chapter 5
---
This lesson collects the ways Lisp lets you shape the flow of a program:
grouping forms, leaving early, choosing among many cases, and returning more
than one value.

### Grouping forms

`progn` evaluates its forms in order and returns the value of the last.
Bodies of `defun`, `let` and `when` already work this way, so you mostly see
`progn` where one form is expected, such as a branch of `if`.

```lisp
(if t
    (progn (print 'first) 'second)
    'never)
```

### Leaving early

`block` names a region of code, and `return-from` leaves it at once with a
value. Every `defun` puts its body in a block named after the function, so
you can return early from any function:

```lisp
(defun first-big (numbers)
  (dolist (n numbers)
    (when (> n 100)
      (return-from first-big n)))
  'none)
```

Loops such as `dolist` and `dotimes` have a block named `nil`, and
`(return value)` leaves it.

```lisp
(dotimes (i 10)
  (when (> (* i i) 20)
    (return i)))
```

### Choosing among cases

`case` compares one value against constant keys with `eql`. A key can be a
list of several keys, and `otherwise` catches the rest.

```lisp
(defun vowel-or-not (letter)
  (case letter
    ((a e i o u) 'vowel)
    (y 'sometimes)
    (otherwise 'consonant)))
```

`typecase` chooses by the type of a value:

```lisp
(mapcar (lambda (x) (typecase x (number 'number) (string 'string) (t 'other)))
        '(1 "two" three))
```

### More than one value

A function can return several values with `values`. Most callers just use the
first, but `multiple-value-bind` names them all:

```lisp
(multiple-value-bind (quotient remainder) (floor 17 5)
  (list quotient remainder))
```

`floor` was already returning two values; the REPL shows both.

### Cleaning up

`unwind-protect` runs a cleanup form however its body is left: normally,
by `return-from`, or by an error. You will meet it whenever a file or other
resource must be closed.

```lisp
(block demo
  (unwind-protect
       (return-from demo 'left-early)
    (print 'cleaned-up)))
```

`catch` and `throw` are a dynamic version of `block` and `return-from`: a
`throw` can leave a `catch` from inside functions it calls. They are rarely
needed, but good to recognize.

## Exercise: Smallest and largest

Define `(min-and-max numbers)`, which returns two values: the smallest number
in the non-empty list, and the largest.

```stub
(defun min-and-max (numbers)
  (not-written-yet 'min-and-max))
```

```hint
Start both the smallest and the largest at the first number, then walk the
rest with `dolist`. Return them with `(values small large)`.
```

```solution
(defun min-and-max (numbers)
  (let ((small (first numbers))
        (large (first numbers)))
    (dolist (n (rest numbers))
      (when (< n small) (setf small n))
      (when (> n large) (setf large n)))
    (values small large)))
```

```check
(is (equal '(1 9) (multiple-value-list (min-and-max '(3 1 9 4)))))
(is (equal '(7 7) (multiple-value-list (min-and-max '(7)))))
(is (equal '(-5 0) (multiple-value-list (min-and-max '(0 -5 -2)))))
```

## Exercise: The first negative

Define `(first-negative numbers)`, which returns the first negative number in
the list, or the symbol `none` when there isn't one. Stop as soon as you find
it.

```stub
(defun first-negative (numbers)
  (not-written-yet 'first-negative))
```

```hint
Walk the list with `dolist`. When a number is negative, leave the function
with `return-from first-negative`. If the loop finishes, return `'none`.
```

```solution
(defun first-negative (numbers)
  (dolist (n numbers)
    (when (minusp n)
      (return-from first-negative n)))
  'none)
```

```check
(is (eql -2 (first-negative '(4 -2 -7))))
(is (eql -1 (first-negative '(-1))))
(is (eq 'none (first-negative '(1 2 3))))
(is (eq 'none (first-negative '())))
```

## Exercise: Weekday or weekend

Define `(day-kind day)`, which takes a keyword for a day of the week, such as
`:mon` or `:sat`, and returns `:weekend` for `:sat` and `:sun`, `:weekday`
for `:mon` through `:fri`, and `:unknown` for anything else.

```stub
(defun day-kind (day)
  (not-written-yet 'day-kind))
```

```hint
`case` with a list of keys per clause: `((:sat :sun) :weekend)`. Finish with
an `otherwise` clause.
```

```solution
(defun day-kind (day)
  (case day
    ((:sat :sun) :weekend)
    ((:mon :tue :wed :thu :fri) :weekday)
    (otherwise :unknown)))
```

```check
(is (eq :weekend (day-kind :sat)))
(is (eq :weekend (day-kind :sun)))
(is (eq :weekday (day-kind :wed)))
(is (eq :unknown (day-kind :holiday)))
```
