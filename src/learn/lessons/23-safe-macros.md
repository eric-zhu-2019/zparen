---
title: Safe macros
level: master
project: Test framework
reading: On Lisp, chapters 9 and 10
---
A failed `expect` says which form failed, but not what it returned. In this
lesson the framework learns to compare a value with the one you expected, and
to expect an error. Both macros must bind variables of their own, and that is
where macros go wrong in two classic ways.

### Running a form twice

A macro that puts `,form` in its expansion twice runs the form twice:

```lisp
(defmacro demo-square (x)
  `(* ,x ,x))

(let ((n 3))
  (demo-square (incf n)))
```

That returns 20, not 16, because `(incf n)` ran twice. Bind the value once in
the expansion, and use the variable after that.

### Capturing a variable

A variable a macro binds in its expansion can hide the caller's variable of
the same name. This macro keeps a value in `total` while it runs the
caller's body:

```lisp
(defmacro demo-with-total (form &body body)
  `(let ((total ,form))
     (list total (progn ,@body))))

(let ((total 5))
  (demo-with-total 10 (* total 2)))
```

The caller meant its own `total`, 5, and expected `(10 10)`. It gets
`(10 20)`: inside the expansion, `total` is the macro's. The cure is a name
no caller can use: `gensym` makes a new symbol each time, in no package.

```lisp
(let ((name (gensym "TOTAL")))
  (list name (symbol-package name)))
```

*On Lisp* chapter 9 is all about capture, and chapter 10 lists the other
traps, such as evaluating in the wrong order.

## Exercise: Expect a value

Define the macro `(expect-equal expected form)`. It runs `expected`, then
`form`, each once. When the two values are `equal`, it records and returns
`(:pass form)`. Otherwise it records and returns
`(:fail form :expected value :got value)`. It works whatever names the
caller's variables have.

```stub
(defmacro expect-equal (expected form)
  (not-written-yet 'expect-equal))
```

```hint
Make two names with `gensym` when the macro runs. Expand into a `let` that
binds the first to `,expected` and the second to `,form`, then a
`record-result` of an `if` on `(equal ...)` of the two variables.
```

```solution
(defmacro expect-equal (expected form)
  (let ((want (gensym "EXPECTED"))
        (got (gensym "GOT")))
    `(let* ((,want ,expected)
            (,got ,form))
       (record-result (if (equal ,want ,got)
                          (list :pass ',form)
                          (list :fail ',form :expected ,want :got ,got))))))
```

```check
(let ((*results* '()))
  (is (equal '(:pass (+ 1 2)) (expect-equal 3 (+ 1 2))))
  (is (equal '(:fail (* 2 2) :expected 5 :got 4) (expect-equal 5 (* 2 2))))
  (let ((n 0) (order '()))
    (expect-equal (progn (push :expected order) 1) (progn (push :form order) (incf n)))
    (is (equal 1 n))
    (is (equal '(:form :expected) order)))
  (let ((got 1) (want 2) (expected 3) (value 4) (result 5))
    (is (eq :pass (first (expect-equal 2 (+ got 1)))))
    (is (eq :pass (first (expect-equal 3 (+ want 1)))))
    (is (eq :pass (first (expect-equal 4 (+ expected 1)))))
    (is (eq :pass (first (expect-equal 5 (+ value 1)))))
    (is (eq :pass (first (expect-equal 6 (+ result 1)))))
    (is (eq :pass (first (expect-equal (+ got 0) 1))))
    (is (eq :pass (first (expect-equal (+ want 0) 2))))
    (is (eq :pass (first (expect-equal (+ value 0) 4))))))
```

## Exercise: With gensyms

Writing `(gensym)` for each name gets tedious. Define the macro
`(with-gensyms names &body body)`, a classic from *On Lisp*. It runs `body`
with each symbol in `names` bound to a new gensym, named after the symbol.

```lisp
(defmacro demo-swap (a b)
  (with-gensyms (temp)
    `(let ((,temp ,a))
       (setf ,a ,b ,b ,temp))))
```

```stub
(defmacro with-gensyms (names &body body)
  (not-written-yet 'with-gensyms))
```

```hint
Expand into a `let` with one binding for each name:
`(,n (gensym ,(symbol-name n)))`, built with `mapcar`. Then splice in the
body.
```

```solution
(defmacro with-gensyms (names &body body)
  `(let ,(mapcar (lambda (n) `(,n (gensym ,(symbol-name n)))) names)
     ,@body))
```

```check
(is (equal '(t nil nil) (with-gensyms (a b) (list (symbolp a) (eq a b) (symbol-package a)))))
(is (equal 3 (with-gensyms () 3)))
(is (string= "START" (with-gensyms (start) (subseq (symbol-name start) 0 5))))
(is (not (eq (with-gensyms (x) x) (with-gensyms (x) x))))
```

## Exercise: Expect an error

Define the macro `(expect-error type form)`. `type` is a condition type, not
run. When running `form` signals a condition of that type, it records and
returns `(:pass form)`. When `form` returns a value instead, it records and
returns `(:fail form :got value)`. A condition of another type is not
caught. Use `with-gensyms`.

```stub
(defmacro expect-error (type form)
  (not-written-yet 'expect-error))
```

```hint
Expand into `record-result` of a `handler-case`. Its form binds a gensym to
`,form` and returns the `:fail` list. Its one clause, `(,type () ...)`,
returns the `:pass` list.
```

```solution
(defmacro expect-error (type form)
  (with-gensyms (value)
    `(record-result
      (handler-case (let ((,value ,form))
                      (list :fail ',form :got ,value))
        (,type ()
          (list :pass ',form))))))
```

```check
(let ((*results* '()))
  (is (equal '(:pass (/ 1 0)) (expect-error division-by-zero (/ 1 0))))
  (is (equal '(:fail (+ 1 1) :got 2) (expect-error error (+ 1 1))))
  (is (equal '(:pass (error "Boom.")) (expect-error error (error "Boom."))))
  (signals parse-error (expect-error division-by-zero (parse-integer "x")))
  (is (equal 3 (length *results*))))
(let ((*results* '())
      (value 7))
  (is (equal '(:fail (+ value 1) :got 8) (expect-error error (+ value 1)))))
```
