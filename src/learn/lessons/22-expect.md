---
title: A test that shows its code
level: master
project: Test framework
reading: On Lisp, chapters 7 and 8
---
FiveAM has checked every exercise you wrote. In this project you build a
small test framework of your own, and see why it has to be made of macros.

A test runs a form and says whether it held. When it fails, a good test says
*which form* failed: `(= (+ 1 2) 4)`, not just "false". A function cannot do
that, since it gets the value of its argument, never the code. A macro gets
the code.

```given
(defvar *results* '()
  "The results recorded so far, newest first. Each result is a list:
(:pass form) or (:fail form ...).")

(defun record-result (result)
  "Adds RESULT to *RESULTS*, and returns it."
  (push result *results*)
  result)
```

### Macros, again

Lesson 13 wrote first macros. A macro is a function that runs when your code
is compiled. It gets the forms of its call and returns the code that runs
instead. Backquote builds that code, and `',form` puts a form in it quoted, as
data:

```lisp
(defmacro show (form)
  `(list ',form :is ,form))

(show (* 6 7))
```

Put the cursor on `(show (* 6 7))` in a file and press ⇧⌘M to see the code it
turns into.

### When to write a macro

*On Lisp* chapter 8 gives the rule: write a function when you can, and a
macro only when a function cannot do the job. A macro is needed to

- see the code, not its value, as `show` does;
- decide when, or whether, to run a form;
- bind a variable around the code it is given.

A macro cannot be passed to `mapcar` or `funcall`, and a change to it needs
the code that uses it compiled again. So the parts of a framework that only
work on data, such as counting results, stay functions.

## Exercise: Expect

Define the macro `(expect form)`. It runs `form`, and records and returns
`(:pass form)` when the value is true, or `(:fail form)` when it is false,
with `form` as code. It runs `form` once. Record with `record-result`.

```stub
(defmacro expect (form)
  (not-written-yet 'expect))
```

```hint
The expansion is `(record-result (if FORM (list :pass 'FORM) (list :fail
'FORM)))`. Build it with backquote, `,form` and `',form`.
```

```solution
(defmacro expect (form)
  `(record-result (if ,form
                      (list :pass ',form)
                      (list :fail ',form))))
```

```check
(let ((*results* '()))
  (is (equal '(:pass (= (+ 1 2) 3)) (expect (= (+ 1 2) 3))))
  (is (equal '(:fail (evenp 7)) (expect (evenp 7))))
  (is (equal '((:fail (evenp 7)) (:pass (= (+ 1 2) 3))) *results*)))
(let ((*results* '())
      (n 0))
  (expect (plusp (incf n)))
  (is (equal 1 n)))
```

## Exercise: A summary

Define `(results-summary results)`. It returns a line such as
`"1 passed, 2 failed: (EVENP 7), (= 1 2)"`: the number of results that passed
and that failed, then each failed result's form, printed with `~s`, in the
order of the list. With no failures, it stops after the numbers:
`"2 passed, 0 failed"`. This one needs no macro.

```stub
(defun results-summary (results)
  (not-written-yet 'results-summary))
```

```hint
`count` with `:key #'first` counts the results. `(mapcar #'second ...)` of
the failed ones gives their forms. In `format`, `~@[ ... ~]` prints its
directives only when the next argument is not `nil`, and `~{~s~^, ~}` prints
a list with commas.
```

```solution
(defun results-summary (results)
  (let ((failed (remove :pass results :key #'first)))
    (format nil "~d passed, ~d failed~@[: ~{~s~^, ~}~]"
            (count :pass results :key #'first)
            (length failed)
            (mapcar #'second failed))))
```

```check
(let ((*print-case* :upcase))
  (is (equal "0 passed, 0 failed" (results-summary '())))
  (is (equal "2 passed, 0 failed" (results-summary '((:pass (= 1 1)) (:pass (evenp 2))))))
  (is (equal "1 passed, 2 failed: (EVENP 7), (= 1 2)"
             (results-summary '((:fail (evenp 7)) (:pass (oddp 1)) (:fail (= 1 2)))))))
```

## Exercise: Collect the results

Define the macro `(with-results &body body)`. It runs `body` with
`*results*` bound to a new empty list, and returns the results the body
recorded, oldest first. The results recorded outside are left as they were.

```stub
(defmacro with-results (&body body)
  (not-written-yet 'with-results))
```

```hint
Expand into a `let` that binds `*results*` to `'()`, runs `,@body`, and
returns `(reverse *results*)`. Since `*results*` is special, `expect` inside
the body records into the new binding.
```

```solution
(defmacro with-results (&body body)
  `(let ((*results* '()))
     ,@body
     (reverse *results*)))
```

```check
(is (equal '((:pass (= 1 1)) (:fail (= 1 2)))
           (with-results (expect (= 1 1)) (expect (= 1 2)))))
(is (equal '() (with-results)))
(let ((*results* '((:pass outer))))
  (with-results (expect (= 1 2)))
  (is (equal '((:pass outer)) *results*)))
```
