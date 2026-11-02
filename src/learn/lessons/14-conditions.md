---
title: Conditions and restarts
level: intermediate
reading: ANSI Common Lisp, chapter 14, especially 14.6
---
When something goes wrong, Lisp **signals a condition**. Code further up the
call stack can **handle** it. Lisp also lets the code that failed offer
**restarts**: ways to carry on. Handling and restarting are separate, so the
code that knows *what* went wrong and the code that knows *what to do* can
live in different places.

### Errors and the debugger

`error` signals an error condition. With no handler, Lisp stops in the
debugger. Run this one on purpose:

```lisp
(error "The value ~a is too big." 42)
```

ZParen shows the debugger beside the REPL, with the condition, the stack, and
a list of restarts. Pick **ABORT** to return to the REPL. After you fix the
code of a function on the stack, **Restart Frame** runs that frame again
without starting over.

### Handling a condition

`handler-case` runs a form. If the form signals a condition of a type you
name, Lisp leaves the form and runs your clause instead:

```lisp
(handler-case (/ 10 0)
  (division-by-zero () :infinity))
```

`ignore-errors` is a short form that returns `nil` on any error.

### Your own conditions

`define-condition` makes a condition type, with slots like a structure:

```lisp
(define-condition demo-too-cold (error)
  ((degrees :initarg :degrees :reader demo-degrees)))
```

Signal it with `(error 'demo-too-cold :degrees -40)`.

### Restarts

`restart-case` runs a form and offers restarts while it runs. A handler made
with `handler-bind` does not leave the failing code first, so it can choose a
restart with `invoke-restart`:

```lisp
(handler-bind ((error (lambda (c)
                        (declare (ignore c))
                        (invoke-restart 'use-default))))
  (restart-case (error "No setting found.")
    (use-default () :default-value)))
```

When no handler chooses, the restarts show in the debugger, and you can pick
one there.

### Cleaning up

`unwind-protect` runs its cleanup forms however its first form ends, normally
or by an error:

```lisp
(let ((log '()))
  (ignore-errors
    (unwind-protect (error "Oops.")
      (push :cleaned-up log)))
  log)
```

## Exercise: Safe division

Define `(safe-divide a b)`. It returns `a` divided by `b`, or the keyword
`:undefined` when `b` is zero.

```stub
(defun safe-divide (a b)
  (not-written-yet 'safe-divide))
```

```hint
Wrap the division in `handler-case`, with a clause for `division-by-zero`.
```

```solution
(defun safe-divide (a b)
  (handler-case (/ a b)
    (division-by-zero () :undefined)))
```

```check
(is (equal 5 (safe-divide 10 2)))
(is (equal 7/2 (safe-divide 7 2)))
(is (eq :undefined (safe-divide 1 0)))
(is (eq :undefined (safe-divide 0 0)))
```

## Exercise: Your own error

The condition `negative-amount` is defined for you. Define
`(checked-amount amount)`. It returns `amount` when it is 0 or more. When it
is negative, it signals `negative-amount`, with the amount in the slot.

```stub
(define-condition negative-amount (error)
  ((amount :initarg :amount :reader negative-amount-value))
  (:report (lambda (c stream)
             (format stream "~a is a negative amount." (negative-amount-value c)))))

(defun checked-amount (amount)
  (not-written-yet 'checked-amount))
```

```hint
`(error 'negative-amount :amount amount)` signals it. Return `amount`
otherwise.
```

```solution
(define-condition negative-amount (error)
  ((amount :initarg :amount :reader negative-amount-value))
  (:report (lambda (c stream)
             (format stream "~a is a negative amount." (negative-amount-value c)))))

(defun checked-amount (amount)
  (if (minusp amount)
      (error 'negative-amount :amount amount)
      amount))
```

```check
(is (equal 5 (checked-amount 5)))
(is (equal 0 (checked-amount 0)))
(signals negative-amount (checked-amount -3))
(is (equal -3 (handler-case (checked-amount -3) (negative-amount (c) (negative-amount-value c)))))
```

## Exercise: Choose a restart

`read-number` is defined for you. It reads an integer from a string, and
offers the restart `use-zero` when it cannot. Define `(sum-parsed strings)`.
It returns the sum of the numbers in a list of strings, counting each string
that is not a number as 0. Do not change `read-number`.

```stub
(defun sum-parsed (strings)
  (not-written-yet 'sum-parsed))

(defun read-number (string)
  "Reads an integer from STRING, offering the restart USE-ZERO when it cannot."
  (restart-case (parse-integer string)
    (use-zero () 0)))
```

```hint
Call `read-number` on each string inside `handler-bind`. The handler, for
`parse-error`, calls `(invoke-restart 'use-zero)`.
```

```solution
(defun sum-parsed (strings)
  (handler-bind ((parse-error (lambda (c)
                                (declare (ignore c))
                                (invoke-restart 'use-zero))))
    (reduce #'+ (mapcar #'read-number strings))))

(defun read-number (string)
  "Reads an integer from STRING, offering the restart USE-ZERO when it cannot."
  (restart-case (parse-integer string)
    (use-zero () 0)))
```

```check
(is (equal 6 (sum-parsed '("1" "2" "3"))))
(is (equal 4 (sum-parsed '("1" "x" "3"))))
(is (equal 0 (sum-parsed '())))
(is (equal 0 (sum-parsed '("oops"))))
```
