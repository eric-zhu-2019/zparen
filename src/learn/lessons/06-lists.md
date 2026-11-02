---
title: Lists in depth
level: beginner
reading: ANSI Common Lisp, chapter 3
---
So far you have used lists without looking inside them. This lesson opens
them up: what a list is made of, when two lists are "the same", and the
other shapes you can build from the same parts.

### Conses

A list is a chain of **conses**. A cons is a pair of two slots: `car` holds an
element, and `cdr` points at the rest of the chain. The last cons points at
`nil`. So `(a b c)` is three conses linked one after another.

When the `cdr` of a cons is not a list, Lisp prints the pair with a dot. This
is a **dotted pair**:

```lisp
(list (cons 'a 'b) (cons 'a '(b)) (car (cons 1 2)) (cdr (cons 1 2)))
```

### Three kinds of sameness

`eq` asks whether two things are the very same object. `eql` is `eq` that
also treats equal numbers and characters as the same. `equal` asks whether
two things print the same, looking inside lists and strings.

```lisp
(let ((x (list 1 2)))
  (list (eq x x) (eq x (list 1 2)) (equal x (list 1 2)) (eql 3 3)))
```

### Sharing

Lists can share conses. `append` copies every list but the last, so the
result's tail is the last list itself:

```lisp
(let* ((tail (list 'c 'd))
       (whole (append (list 'a 'b) tail)))
  (list whole (eq (cddr whole) tail)))
```

### Useful list functions

```lisp
(list (reverse '(1 2 3)) (nth 1 '(a b c)) (last '(a b c)) (append '(1) '(2) '(3 4)))
```

`push` adds an element to the front of a list stored in a variable, and `pop`
takes the first one off and returns it:

```lisp
(let ((stack '()))
  (push 'a stack)
  (push 'b stack)
  (list (pop stack) stack))
```

### Association lists

A list of dotted pairs can work as a small table, called an **alist**. `assoc`
finds the first pair whose key matches:

```lisp
(let ((colors '((apple . red) (banana . yellow))))
  (list (assoc 'banana colors) (cdr (assoc 'apple colors)) (assoc 'cherry colors)))
```

### Trees

The `car` of a cons can be a list too. Read that way, a list of lists is a
**tree**, and a function over a tree recurses on both the `car` and the
`cdr`:

```lisp
(defun count-leaves (tree)
  (cond ((null tree) 0)
        ((atom tree) 1)
        (t (+ (count-leaves (car tree)) (count-leaves (cdr tree))))))
```

`(count-leaves '((a b) (c (d))))` returns 4.

## Exercise: Runs of repeats

Define `(run-lengths list)`, which describes runs of repeated elements as
dotted pairs of the element and how many times it repeats. `(a a b c c c)`
becomes `((a . 2) (b . 1) (c . 3))`. Compare elements with `eql`.

```stub
(defun run-lengths (list)
  (not-written-yet 'run-lengths))
```

```hint
Walk the list keeping a result that is built backwards. If the element equals
the key of the newest pair, increase that pair's count with `incf` on its
`cdr`; otherwise push a new pair `(cons x 1)`. Reverse the result at the end.
```

```solution
(defun run-lengths (list)
  (let ((runs '()))
    (dolist (x list)
      (if (and runs (eql x (car (first runs))))
          (incf (cdr (first runs)))
          (push (cons x 1) runs)))
    (reverse runs)))
```

```check
(is (equal '((a . 2) (b . 1) (c . 3)) (run-lengths '(a a b c c c))))
(is (equal '((1 . 1) (2 . 1) (1 . 1)) (run-lengths '(1 2 1))))
(is (equal '((x . 4)) (run-lengths '(x x x x))))
(is (equal '() (run-lengths '())))
```

## Exercise: Flatten a tree

Define `(flatten-tree tree)`, which returns a flat list of every atom in the
tree, from left to right, leaving out the `nil`s that end lists.
`((a b) (c (d)) e)` becomes `(a b c d e)`.

```stub
(defun flatten-tree (tree)
  (not-written-yet 'flatten-tree))
```

```hint
Three cases: an empty tree gives `()`, an atom gives a list of just itself,
and a cons gives the flattened `car` appended to the flattened `cdr`.
```

```solution
(defun flatten-tree (tree)
  (cond ((null tree) '())
        ((atom tree) (list tree))
        (t (append (flatten-tree (car tree)) (flatten-tree (cdr tree))))))
```

```check
(is (equal '(a b c d e) (flatten-tree '((a b) (c (d)) e))))
(is (equal '(1 2 3) (flatten-tree '(1 2 3))))
(is (equal '(x) (flatten-tree '(((x))))))
(is (equal '() (flatten-tree '())))
```

## Exercise: Tally

Define `(tally list)`, which counts how often each element appears and returns
an alist of `(element . count)` pairs, in the order each element first
appears. `(a b a c a)` becomes `((a . 3) (b . 1) (c . 1))`.

```stub
(defun tally (list)
  (not-written-yet 'tally))
```

```hint
Keep an alist. For each element, `assoc` finds its pair if there is one; then
`incf` its `cdr`, or push a new pair. Since `push` adds to the front, reverse
the alist at the end.
```

```solution
(defun tally (list)
  (let ((counts '()))
    (dolist (x list)
      (let ((pair (assoc x counts)))
        (if pair
            (incf (cdr pair))
            (push (cons x 1) counts))))
    (reverse counts)))
```

```check
(is (equal '((a . 3) (b . 1) (c . 1)) (tally '(a b a c a))))
(is (equal '((1 . 2) (2 . 1)) (tally '(1 2 1))))
(is (equal '() (tally '())))
```
