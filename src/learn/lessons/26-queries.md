---
title: A query interpreter
level: master
project: Query engine
reading: On Lisp, sections 19.1–19.3
---
With `match`, the engine can answer a question. A **query** is a pattern, or
several joined with `and`, `or` and `not`:

```lisp
'(and (book ?title _ _)
      (topic ?title macros)
      (not (book ?title graham _)))
```

That asks for the books about macros that Graham did not write. This lesson
writes an **interpreter** for queries: a function that walks the query each
time it runs.

### Answers are lists of bindings

An answer is a list of bindings. A query has any number of answers, so it
returns a list of them. The four kinds of query combine answers:

- A pattern gives one answer for each fact it matches.
- `(and q1 q2 ...)` takes each answer of `q1`, and looks for the answers of
  the rest *with those bindings*. So `?title` found by the first pattern must
  be the same in the second.
- `(or q1 q2 ...)` gives the answers of each query, one after another.
- `(not q)` gives the bindings it was given, once, when `q` has no answer
  with them, and no answer otherwise.

`(and)` with nothing in it holds once, with the bindings it was given. That
case ends the recursion.

### A macro on top

The interpreter returns bindings, which are awkward to use. The last exercise
wraps it in a macro, so that code can use `?title` as a variable, as
`if-match` did.

## Exercise: Look up a pattern

Define `(lookup pattern &optional binds)`. It returns a list with one answer
for each fact in `*facts*`, in order, that `pattern` matches given the
bindings `binds`. Each answer is the bindings from that match.

```stub
(defun lookup (pattern &optional binds)
  (not-written-yet 'lookup))
```

```hint
Loop over `*facts*`. Catch both values of `(match pattern fact binds)`, and
collect the bindings when the second is true.
```

```solution
(defun lookup (pattern &optional binds)
  (loop for fact in *facts*
        for (answer ok) = (multiple-value-list (match pattern fact binds))
        when ok collect answer))
```

```check
(is (equal 2 (length (lookup '(book ?title graham ?year)))))
(is (equal '("On Lisp" "ANSI Common Lisp")
           (mapcar (lambda (b) (cdr (assoc '?title b))) (lookup '(book ?title graham _)))))
(is (equal '() (lookup '(book ?title knuth ?year))))
(is (equal 1 (length (lookup '(book ?title ?who _) '((?who . norvig))))))
(is (equal '(nil) (lookup '(author graham "Paul Graham"))))
```

## Exercise: Interpret a query

Define `(interpret-query query &optional binds)`. It returns the answers to
`query`, given the bindings `binds`, as the lesson describes: for a pattern,
`and`, `or` and `not`.

```stub
(defun interpret-query (query &optional binds)
  (not-written-yet 'interpret-query))
```

```hint
Use `case` on `(first query)`. For `and` with clauses, take each answer `b`
of the first clause and `append` the answers of `(cons 'and (cddr query))`
given `b`. With no clauses, return `(list binds)`. Anything that is not
`and`, `or` or `not` is a pattern for `lookup`.
```

```solution
(defun interpret-query (query &optional binds)
  (case (first query)
    (and (if (rest query)
             (loop for b in (interpret-query (second query) binds)
                   append (interpret-query (cons 'and (cddr query)) b))
             (list binds)))
    (or (loop for q in (rest query)
              append (interpret-query q binds)))
    (not (if (interpret-query (second query) binds)
             '()
             (list binds)))
    (t (lookup query binds))))
```

```check
(flet ((titles (query)
         (mapcar (lambda (b) (cdr (assoc '?title b))) (interpret-query query))))
  (is (equal '("On Lisp" "ANSI Common Lisp") (titles '(book ?title graham _))))
  (is (equal '("On Lisp" "Practical Common Lisp")
             (titles '(and (book ?title _ _) (topic ?title macros)))))
  (is (equal '("ANSI Common Lisp")
             (titles '(and (book ?title graham _) (not (topic ?title macros))))))
  (is (equal '("Paradigms of AI Programming" "Common Lisp Recipes")
             (titles '(or (topic ?title ai) (topic ?title libraries)))))
  (is (equal '() (titles '(and (book ?title knuth _))))))
(is (equal '(nil) (interpret-query '(and))))
(is (equal '("Paul Graham")
           (mapcar (lambda (b) (cdr (assoc '?name b)))
                   (interpret-query '(and (book "On Lisp" ?who _) (author ?who ?name))))))
```

## Exercise: Use the answers

Define the macro `(with-answer query &body body)`. It runs `body` once for
each answer to `query`, with each variable of the query bound as a Lisp
variable to its value in that answer, and returns the list of the body's
values. A variable with no value in an answer is `nil`.

```stub
(defmacro with-answer (query &body body)
  (not-written-yet 'with-answer))
```

```hint
Expand into a `mapcar` of a `lambda` over `(interpret-query ',query)`. The
lambda takes one answer, in a gensym, and binds each of `(pattern-vars
query)` with `let`, as `if-match` does.
```

```solution
(defmacro with-answer (query &body body)
  (let ((vars (pattern-vars query)))
    (let ((answer (gensym "ANSWER")))
      `(mapcar (lambda (,answer)
                 (let ,(mapcar (lambda (v) `(,v (cdr (assoc ',v ,answer)))) vars)
                   (declare (ignorable ,@vars))
                   ,@body))
               (interpret-query ',query)))))
```

```check
(is (equal '(("On Lisp" 1993) ("ANSI Common Lisp" 1995))
           (with-answer (book ?title graham ?year) (list ?title ?year))))
(is (equal '("Paul Graham")
           (with-answer (and (book "On Lisp" ?who _) (author ?who ?name)) ?name)))
(is (equal '() (with-answer (book ?title knuth _) ?title)))
(let ((answer :mine))
  (is (equal '(:mine) (with-answer (author norvig _) answer))))
```
