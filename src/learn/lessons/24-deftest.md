---
title: Tests, suites and macros that write macros
level: master
project: Test framework
reading: On Lisp, chapters 11 and 16; ANSI Common Lisp, section 14.6
---
The framework can check one form. Now it gets named tests, a runner that
goes on when a test breaks, and a way to add new kinds of check. These are the
parts FiveAM's own `test` and `run!` have.

```given
(defvar *test-names* '()
  "The names of the tests DEFTEST has defined, newest first.")
```

### A definition macro

`defun`, `defclass` and `deftest` are all macros that define something and
record it. The expansion is a `progn` of the steps. Forms in a top-level
`progn` are top-level forms too, so a `defun` in it is compiled as if you had
written it yourself.

### Restarts across layers

Lesson 14 split *what went wrong* from *what to do about it*. A test framework
needs both, in different places. The test knows how to give up on itself and
carry on: it offers a restart. The runner knows the policy: when running every
test, skip the broken one and go on. When you run one test in the REPL and it
breaks, the restart waits in ZParen's debugger, where you can read the error
first and then choose **Skip the rest of test …**.

A restart can take arguments. `(invoke-restart 'skip-test c)` passes the
condition to it.

### Macros that write macros

*On Lisp* chapter 16 writes macros whose expansion is another `defmacro`. The
expansion then holds a backquote inside a backquote. Two idioms do most of
the work:

- `,',x` puts the value of `x`, from the outer macro, into the inner
  expansion as a constant.
- `,,@xs` puts a comma before each of the symbols in `xs`, so the inner macro
  inserts the forms it got for them.

```lisp
(defmacro demo-define-printer (name prefix)
  `(defmacro ,name (form)
     `(format nil "~a ~s" ,',prefix ,form)))

(demo-define-printer demo-shout "Value:")

(demo-shout (+ 1 2))
```

## Exercise: Define a test

Define the macro `(deftest name &body body)`. It defines a function `name`
of no arguments, which runs `body` and returns the results the body recorded,
oldest first. It adds `name` to `*test-names*` once, however often the test
is defined. While the body runs, it offers the restart `skip-test`, with the
report "Skip the rest of test name.". The restart takes an optional
condition. It records `(:fail name :error message)`, with the condition's
message as a string, or `nil` with no condition, and the test returns its
results.

```stub
(defmacro deftest (name &body body)
  (not-written-yet 'deftest))
```

```hint
Expand into a `progn` of a `pushnew` and a `defun`. In the function, bind
`*results*` to `'()`, as `with-results` does, and wrap the body in
`restart-case`. Its clause is `(skip-test (&optional condition) :report ...
(record-result (list :fail ',name :error (and condition (princ-to-string
condition)))))`.
```

```solution
(defmacro deftest (name &body body)
  `(progn
     (pushnew ',name *test-names*)
     (defun ,name ()
       (let ((*results* '()))
         (restart-case (progn ,@body)
           (skip-test (&optional condition)
             :report ,(format nil "Skip the rest of test ~(~a~)." name)
             (record-result (list :fail ',name :error (and condition (princ-to-string condition))))))
         (reverse *results*)))))
```

```check
(let ((*test-names* '()))
  (deftest demo-sums
    (expect (= 2 (+ 1 1)))
    (expect-equal 5 (+ 2 2)))
  (is (equal '(demo-sums) *test-names*))
  (is (equal '((:pass (= 2 (+ 1 1))) (:fail (+ 2 2) :expected 5 :got 4)) (funcall 'demo-sums)))
  (deftest demo-sums (expect (= 1 1)))
  (is (equal '(demo-sums) *test-names*))
  (deftest demo-boom
    (expect (= 1 1))
    (error "Boom.")
    (expect (= 2 2)))
  (is (equal '((:pass (= 1 1)) (:fail demo-boom :error "Boom."))
             (handler-bind ((error (lambda (c) (invoke-restart 'skip-test c))))
               (funcall 'demo-boom))))
  (is (equal "Skip the rest of test demo-boom."
             (block report
               (handler-bind ((error (lambda (c)
                                       (declare (ignore c))
                                       (return-from report
                                         (princ-to-string (find-restart 'skip-test))))))
                 (funcall 'demo-boom))))))
```

## Exercise: Run the tests

Define `(run-tests &optional names)`. It runs the tests named in `names`, or
every test `deftest` defined, oldest first, when `names` is `nil`. For
each test it prints a line with the test's name in lower case and its
`results-summary`, such as `demo-good: 2 passed, 0 failed`. A test that
signals an error skips the rest of itself, with the condition, and the run
goes on. It returns two values: the number of results that passed, and the
number that failed, in every test together.

```stub
(defun run-tests (&optional names)
  (not-written-yet 'run-tests))
```

```hint
Wrap each `(funcall name)` in `handler-bind` with a handler for `error` that
calls `(invoke-restart 'skip-test c)`. Print with `(format t "~&~(~a~): ~a~%"
...)`. Add up the counts as you go, and end with `(values passed failed)`. Loop
over `(or names (reverse *test-names*))`.
```

```solution
(defun run-tests (&optional names)
  (let ((passed 0)
        (failed 0))
    (dolist (name (or names (reverse *test-names*)) (values passed failed))
      (let ((results (handler-bind ((error (lambda (c) (invoke-restart 'skip-test c))))
                       (funcall name))))
        (format t "~&~(~a~): ~a~%" name (results-summary results))
        (incf passed (count :pass results :key #'first))
        (incf failed (count :fail results :key #'first))))))
```

```check
(let ((*test-names* '()))
  (deftest demo-good (expect (= 1 1)) (expect (evenp 2)))
  (deftest demo-bad (expect (= 1 2)) (error "Boom.") (expect (= 3 3)))
  (let* (counts
         (output (with-output-to-string (*standard-output*)
                   (setf counts (multiple-value-list (run-tests))))))
    (is (equal '(2 2) counts))
    (is (search "demo-good: 2 passed, 0 failed" output))
    (is (search "demo-bad: 0 passed, 2 failed" output))
    (is (< (search "demo-good" output) (search "demo-bad" output))))
  (is (equal '(2 0) (multiple-value-list
                     (let ((*standard-output* (make-broadcast-stream)))
                       (run-tests '(demo-good)))))))
```

## Exercise: New kinds of check

Define the macro `(define-expectation name params &body body)`. It defines a
macro `name` that takes one form for each parameter. That macro runs each
form once, binds the values to `params`, and runs `body`. When the body's
value is true, it records and returns `(:pass call)`, and otherwise
`(:fail call)`, where `call` is the whole macro call as code.

```lisp
(define-expectation expect-between (x low high)
  (<= low x high))

(with-results (expect-between (* 3 3) 1 10))
```

```stub
(defmacro define-expectation (name params &body body)
  (not-written-yet 'define-expectation))
```

```hint
The expansion is `(defmacro ,name (&whole call ,@params) ...)`. Its body is
a second backquote: a `record-result` of an `if` whose test calls
`(lambda ,',params ,@',body)` on `,,@params`. `&whole call` gives the whole
call, for `',call`.
```

```solution
(defmacro define-expectation (name params &body body)
  `(defmacro ,name (&whole call ,@params)
     `(record-result
       (if ((lambda ,',params ,@',body) ,,@params)
           (list :pass ',call)
           (list :fail ',call)))))
```

```check
(let ((*results* '()))
  (eval '(define-expectation expect-positive (x) (plusp x)))
  (is (equal '(:pass (expect-positive (- 5 3))) (eval '(expect-positive (- 5 3)))))
  (is (equal '(:fail (expect-positive (- 3 5))) (eval '(expect-positive (- 3 5)))))
  (eval '(define-expectation expect-in-range (x low high) (<= low x high)))
  (is (eq :pass (first (eval '(expect-in-range 5 1 10)))))
  (is (eq :fail (first (eval '(expect-in-range 15 1 10)))))
  (eval '(defparameter *demo-count* 0))
  (eval '(expect-positive (incf *demo-count*)))
  (is (equal 1 (symbol-value '*demo-count*)))
  (is (equal 5 (length *results*))))
```
