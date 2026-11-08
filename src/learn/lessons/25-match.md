---
title: Pattern matching
level: master
project: Query engine
reading: On Lisp, chapter 18
---
The last project is a small **query engine**, after *On Lisp* chapter 19. A
database of facts, such as `(book "On Lisp" graham 1993)`, answers questions
such as "which books did Graham write?". The questions are patterns:
`(book ?title graham ?year)`. This lesson builds the part everything else
rests on: matching a pattern against a fact.

```given
(defparameter *facts*
  '((book "On Lisp" graham 1993)
    (book "ANSI Common Lisp" graham 1995)
    (book "Paradigms of AI Programming" norvig 1992)
    (book "Practical Common Lisp" seibel 2005)
    (book "Common Lisp Recipes" weitz 2016)
    (author graham "Paul Graham")
    (author norvig "Peter Norvig")
    (author seibel "Peter Seibel")
    (author weitz "Edmund Weitz")
    (topic "On Lisp" macros)
    (topic "Paradigms of AI Programming" ai)
    (topic "Practical Common Lisp" macros)
    (topic "Common Lisp Recipes" libraries))
  "The facts the query engine searches, one list each.")

(defun var-p (x)
  "True when X is a pattern variable: a symbol whose name starts with ?, such as ?TITLE."
  (and (symbolp x)
       (> (length (symbol-name x)) 1)
       (char= #\? (char (symbol-name x) 0))))
```

### Patterns

A pattern is a list like a fact, where some elements are **variables**:
symbols that start with `?`. A variable matches anything, and the match
records what it matched in a list of **bindings**, an association list such
as `((?year . 1993) (?title . "On Lisp"))`. A variable that appears twice
must match the same thing both times. The symbol `_` matches anything and
records nothing.

### Destructuring

Common Lisp already takes lists apart by their shape. `destructuring-bind`
binds variables to the parts of a list, and fails when the list has another
shape:

```lisp
(destructuring-bind (kind title (&rest authors)) '(book "PAIP" (norvig))
  (list kind title authors))
```

A pattern matcher does the same, but it decides at run time, and it answers
"no" instead of signalling an error. *On Lisp* chapter 18 builds both.

### Two values

`match` returns two values: the bindings and whether it matched. A match with
no variables gives `nil` bindings, so the second value is the only way to
tell it from a failure:

```lisp
(multiple-value-bind (binds ok) (values '() t)
  (list binds ok))
```

## Exercise: Match a pattern

Define `(match pattern data &optional binds)`. It returns two values, the
bindings and `t`, when `pattern` matches `data` given the bindings `binds`
already made, and `nil` when it does not:

- `_` matches anything.
- A variable matches anything when it has no binding yet, and adds one. With
  a binding, it matches only data `equal` to its value.
- Two conses match when their `car`s match, and then their `cdr`s, with the
  bindings from the `car`s.
- Anything else matches data `equal` to it.

```stub
(defun match (pattern data &optional binds)
  (not-written-yet 'match))
```

```hint
Use `cond` in the order above. For a variable, `assoc` finds its binding;
`(cons (cons pattern data) binds)` adds one. For conses, catch both values of
the `car`s' match with `multiple-value-bind`, and only then match the `cdr`s.
```

```solution
(defun match (pattern data &optional binds)
  (cond ((eq pattern '_) (values binds t))
        ((var-p pattern)
         (let ((binding (assoc pattern binds)))
           (cond ((null binding) (values (cons (cons pattern data) binds) t))
                 ((equal (cdr binding) data) (values binds t))
                 (t nil))))
        ((and (consp pattern) (consp data))
         (multiple-value-bind (b ok) (match (car pattern) (car data) binds)
           (if ok (match (cdr pattern) (cdr data) b) nil)))
        ((equal pattern data) (values binds t))
        (t nil)))
```

```check
(multiple-value-bind (binds ok) (match '(?x b ?y) '(a b c))
  (is (eq t ok))
  (is (eq 'a (cdr (assoc '?x binds))))
  (is (eq 'c (cdr (assoc '?y binds)))))
(is (equal '(nil t) (multiple-value-list (match '(a b) '(a b)))))
(is (null (nth-value 1 (match '(?x b ?x) '(a b c)))))
(is (eq t (nth-value 1 (match '(?x b ?x) '(a b a)))))
(is (eq t (nth-value 1 (match '(_ _ ?x) '(1 2 3)))))
(is (null (nth-value 1 (match '(a ?x) '(a)))))
(is (null (nth-value 1 (match '(?x) '(2) '((?x . 1))))))
(is (equal "On Lisp" (cdr (assoc '?title (match '(book ?title graham _) (first *facts*))))))
```

## Exercise: The variables of a pattern

Define `(pattern-vars pattern)`. It returns the variables in `pattern`, at any
depth, each once, in the order they first appear.

```stub
(defun pattern-vars (pattern)
  (not-written-yet 'pattern-vars))
```

```hint
Walk the tree with a local function from `labels`: `pushnew` each variable, walk the `car` and `cdr` of each cons, and reverse
the list at the end.
```

```solution
(defun pattern-vars (pattern)
  (let ((vars '()))
    (labels ((walk (p)
               (cond ((var-p p) (pushnew p vars))
                     ((consp p) (walk (car p)) (walk (cdr p))))))
      (walk pattern))
    (nreverse vars)))
```

```check
(is (equal '(?x ?y) (pattern-vars '(?x (b ?y) . ?x))))
(is (equal '() (pattern-vars '(a _ b))))
(is (equal '(?z) (pattern-vars '?z)))
(is (equal '(?title ?year) (pattern-vars '(and (book ?title _ ?year) (not (topic ?title ai))))))
```

## Exercise: Match into variables

Define the macro `(if-match pattern data then &optional else)`. `pattern` is
not evaluated, and `data` is evaluated once. When the pattern matches, it
runs `then` with each of the pattern's variables bound, as a Lisp variable,
to what it matched. Otherwise it runs `else`.

```lisp
(if-match (book ?title ?who _) (first *facts*)
  (format nil "~a wrote ~a" ?who ?title)
  "no match")
```

```stub
(defmacro if-match (pattern data then &optional else)
  (not-written-yet 'if-match))
```

```hint
Expand into a `multiple-value-bind` of `(match ',pattern ,data)`. Name its two
values with `(gensym)`, made when the macro runs, so they cannot hide the
caller's own variables. On a match, a `let` binds each
of `(pattern-vars pattern)`, found when the macro runs, to `(cdr (assoc 'v
binds))`. Declare the variables `ignorable`, since `then` may not use them all.
```

```solution
(defmacro if-match (pattern data then &optional else)
  (let ((vars (pattern-vars pattern)))
    (let ((binds (gensym "BINDS"))
          (ok (gensym "OK")))
      `(multiple-value-bind (,binds ,ok) (match ',pattern ,data)
         (if ,ok
             (let ,(mapcar (lambda (v) `(,v (cdr (assoc ',v ,binds)))) vars)
               (declare (ignorable ,@vars))
               ,then)
             ,else)))))
```

```check
(is (equal '(a c) (if-match (?x b ?y) '(a b c) (list ?x ?y) :no)))
(is (eq :no (if-match (?x b ?x) '(a b c) (list ?x) :no)))
(is (eq nil (if-match (?x) '(1 2) ?x)))
(let ((n 0))
  (is (equal 1 (if-match (?x) (progn (incf n) '(1)) ?x)))
  (is (equal 1 n)))
(let ((binds :mine) (ok :yours))
  (is (equal '(:mine :yours) (if-match (_ ?y) '(1 2) (list binds ok)))))
```
