---
title: Compile the queries
level: master
project: Query engine
reading: On Lisp, section 19.4 and chapter 13
---
`with-answer` walks the query each time it runs, and passes bindings around
as lists. But the query is in the source code, so a macro knows it when the
code is **compiled**. In this lesson a macro turns the query into plain Lisp:
nested loops over the facts, with the query's variables as real variables.
The result is code, which SBCL then compiles like any other.

### Work at compile time

*On Lisp* chapter 13 shows macros that do work when the code is compiled, so
that it costs nothing when the code runs. A macro is a Lisp function that
runs then, so it can do anything Lisp can:

```lisp
(defmacro demo-seconds (&key (hours 0) (minutes 0))
  (+ (* hours 3600) (* minutes 60)))

(demo-seconds :hours 2 :minutes 5)
```

The call is the number 7500 in the compiled code. Press ⇧⌘M on it to see.

### Code that writes the loops

The compiler is a set of functions that return code. Each takes the code to
run for every answer, `body`, and wraps it:

- A pattern becomes a `dolist` over `*facts*` that runs `body` for each fact
  it matches, with its new variables bound.
- `(and q1 q2)` compiles `q2` around `body`, then `q1` around the result. The
  variables of `q1` are bound inside the code for `q2`.
- `(or q1 q2)` runs `body` under each, one after the other.
- `(not q)` runs `body` when the code for `q` finds nothing.
- `(lisp form)`, new here, runs `body` when `form`, plain Lisp, is true. Since
  the variables are real variables, `(lisp (> ?year 2000))` just works. The
  interpreter cannot do that.

The compiler must know which variables already have a value, the **bound**
ones. In `(and (book ?title ?who _) (author ?who ?name))`, the second pattern
must match facts whose author is the `?who` found by the first.

## Exercise: Compile a pattern

Define `(compile-pattern pattern bound body)`. It returns code that runs
`body` once for each fact in `*facts*` that `pattern` matches. The variables
in `bound` are already Lisp variables with values, and must match their
values. The pattern's other variables are bound around `body` to what they
matched. Use `match` in the code.

```stub
(defun compile-pattern (pattern bound body)
  (not-written-yet 'compile-pattern))
```

```hint
Split `(pattern-vars pattern)` into the bound ones and the new ones. The code
is a `dolist` over `*facts*` that calls `match` with the bindings
`(list (cons '?who ?who) ...)` for the bound ones, and on a match binds the
new ones with `let`, as `if-match` does. Use gensyms for the fact and the
match's values.
```

```solution
(defun compile-pattern (pattern bound body)
  (let ((known (remove-if-not (lambda (v) (member v bound)) (pattern-vars pattern)))
        (new (remove-if (lambda (v) (member v bound)) (pattern-vars pattern))))
    (let ((fact (gensym "FACT"))
          (binds (gensym "BINDS"))
          (ok (gensym "OK")))
      `(dolist (,fact *facts*)
         (multiple-value-bind (,binds ,ok)
             (match ',pattern ,fact (list ,@(mapcar (lambda (v) `(cons ',v ,v)) known)))
           (declare (ignorable ,binds))
           (when ,ok
             (let ,(mapcar (lambda (v) `(,v (cdr (assoc ',v ,binds)))) new)
               ,body)))))))
```

```check
(is (equal '("On Lisp" "ANSI Common Lisp")
           (eval `(let ((out '()))
                    ,(compile-pattern '(book ?title graham _) '() '(push ?title out))
                    (nreverse out)))))
(is (equal '("Paradigms of AI Programming")
           (eval `(let ((?who 'norvig) (out '()))
                    ,(compile-pattern '(book ?title ?who _) '(?who) '(push ?title out))
                    out))))
(is (equal '(1993 1995)
           (eval `(let ((out '()))
                    ,(compile-pattern '(book _ graham ?year) '() '(push ?year out))
                    (nreverse out)))))
```

## Exercise: Compile a query

Define `(compile-query query body &optional bound)`. It returns code that runs
`body` once for each answer to `query`, given the variables `bound`, for a
pattern, `and`, `or`, `not` and `(lisp form)`.

```stub
(defun compile-query (query body &optional bound)
  (not-written-yet 'compile-query))
```

```hint
Use `case` on `(first query)`. For `and` with clauses, compile the rest, `(cons
'and (cddr query))`, around `body`, with `bound` plus the first clause's
variables, unless it is a `not` or `lisp`. Then compile the first clause
around that. For `not`, put the code for `q` in a `block` whose body is
`(return-from block t)`, and run `body` when the block returns `nil`.
```

```solution
(defun compile-query (query body &optional bound)
  (case (first query)
    (and (if (rest query)
             (let ((clause (second query)))
               (compile-query clause
                              (compile-query (cons 'and (cddr query)) body
                                             (union bound (if (member (first clause) '(not lisp))
                                                              '()
                                                              (pattern-vars clause))))
                              bound))
             body))
    (or `(progn ,@(mapcar (lambda (q) (compile-query q body bound)) (rest query))))
    (not (let ((found (gensym "FOUND")))
           `(unless (block ,found
                      ,(compile-query (second query) `(return-from ,found t) bound)
                      nil)
              ,body)))
    (lisp `(when ,(second query) ,body))
    (t (compile-pattern query bound body))))
```

```check
(flet ((run (query vars)
         (eval `(let ((out '()))
                  ,(compile-query query `(push (list ,@vars) out))
                  (nreverse out)))))
  (is (equal '(("On Lisp") ("Practical Common Lisp"))
             (run '(and (book ?title _ _) (topic ?title macros)) '(?title))))
  (is (equal '(("ANSI Common Lisp"))
             (run '(and (book ?title graham _) (not (topic ?title macros))) '(?title))))
  (is (equal '(("Paradigms of AI Programming") ("Common Lisp Recipes"))
             (run '(or (topic ?title ai) (topic ?title libraries)) '(?title))))
  (is (equal '(("Practical Common Lisp" 2005) ("Common Lisp Recipes" 2016))
             (run '(and (book ?title _ ?year) (lisp (> ?year 2000))) '(?title ?year))))
  (is (equal '(("Paul Graham"))
             (run '(and (book "On Lisp" ?who _) (author ?who ?name)) '(?name)))))
```

## Exercise: The compiled macro

Define the macro `(with-answer* query &body body)`. It returns what
`with-answer` returns, but expands into the compiled query, with no call to
`interpret-query`. It also accepts `(lisp form)` clauses.

```stub
(defmacro with-answer* (query &body body)
  (not-written-yet 'with-answer*))
```

```hint
Bind a gensym to `'()`, compile the query around `(push (progn ,@body)
results)`, and return the list reversed.
```

```solution
(defmacro with-answer* (query &body body)
  (let ((results (gensym "RESULTS")))
    `(let ((,results '()))
       ,(compile-query query `(push (progn ,@body) ,results))
       (nreverse ,results))))
```

```check
(is (equal (with-answer (and (book ?title _ _) (topic ?title macros)) ?title)
           (with-answer* (and (book ?title _ _) (topic ?title macros)) ?title)))
(is (equal '("Practical Common Lisp" "Common Lisp Recipes")
           (with-answer* (and (book ?title _ ?year) (lisp (> ?year 2000))) ?title)))
(is (equal '() (with-answer* (book ?title knuth _) ?title)))
(is-false (labels ((has (x) (or (eq x 'interpret-query)
                               (and (consp x) (or (has (car x)) (has (cdr x)))))))
            (has (macroexpand-1 '(with-answer* (book ?title _ _) ?title)))))
```
