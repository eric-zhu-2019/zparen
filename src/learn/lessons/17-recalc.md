---
title: Recalculate in order
level: advanced
project: Spreadsheet
reading: ANSI Common Lisp, chapter 12
---
When a cell changes, the cells that read it must be worked out again, and so
must the cells that read *those*. They must also be worked out in the right
order: a cell after every cell it reads. In this lesson the spreadsheet learns
which cells to recalculate, and in what order. On the way you build a queue,
the classic example of changing list structure in place.

### Shared structure

`cons` makes a new cell, and a list is a chain of them. Two lists can share
their tails:

```lisp
(let* ((tail (list 3 4))
       (a (cons 1 tail))
       (b (cons 2 tail)))
  (setf (first tail) 30)
  (list a b))
```

Both lists show 30, because both hold the same conses. `eq` tells whether two
values are the very same object. `equal` tells whether they print the same.

### Destructive functions

Most list functions make new conses and leave their arguments alone: `append`,
`remove`, `reverse`. Their destructive twins, `nconc`, `delete` and
`nreverse`, reuse the conses they are given. `sort` is destructive too. They
are faster and make less garbage, but only use them on a list that no other
code holds. Never use them on a quoted constant such as `'(3 1 2)`: that
list is part of your program.

```lisp
(let ((fresh (list 3 1 2)))
  (sort fresh #'<))
```

### A queue

Adding to the end of a list with `append` copies the whole list each time, so
adding n items takes time in proportion to n². A queue keeps a pointer to its
last cons as well as to its first, so it can add an item in one step. This
queue is a single cons: its `car` is the list of items, and its `cdr` is the
last cons of that list. The provided code makes one and takes items off it.
You write the part that adds.

```given
(defun make-queue ()
  "An empty queue: a cons whose car is its list of items and whose cdr is the
last cons of that list."
  (cons nil nil))

(defun queue-items (queue)
  "The items of QUEUE, first to last. Do not change this list."
  (car queue))

(defun queue-empty-p (queue)
  (null (car queue)))

(defun dequeue (queue)
  "Removes the first item of QUEUE and returns it."
  (let ((item (pop (car queue))))
    (when (null (car queue))
      (setf (cdr queue) nil))
    item))

(defun cell< (a b)
  "True when cell A comes before cell B: by column, then by row."
  (or (char< (cell-column a) (cell-column b))
      (and (char= (cell-column a) (cell-column b))
           (< (cell-row a) (cell-row b)))))

(defun sheet-cells (sheet)
  "A fresh list of the cells of SHEET that hold a formula, in CELL< order."
  (sort (loop for cell being the hash-keys of (sheet-formulas sheet)
              collect cell)
        #'cell<))

(define-condition circular-reference (error)
  ((cell :initarg :cell :reader circular-reference-cell))
  (:report (lambda (c stream)
             (format stream "~s depends on itself, through the cells it reads."
                     (circular-reference-cell c)))))
```

### Recalculation order

Take a sheet where `:b1` reads `:a1` and `:c1`, and `:c1` reads `:a1`. When
`:a1` changes, both must change, and `:c1` must come first. Finding the order
takes two steps:

1. Find every cell that depends on the changed one, directly or through other
   cells. A queue does this well: take a cell off the queue, and put on it
   each cell that reads it and has not been seen.
2. Order them. Place a cell when none of the cells it reads still waits to be
   placed. If some wait but none can be placed, the cells read each other in
   a circle.

A circle is an error the user made in the sheet, so signal a condition. In
ZParen, the debugger then says which cell depends on itself.

## Exercise: Add to a queue

Define `(enqueue item queue)`. It adds `item` at the end of `queue`, in one
step whatever the queue's length, and returns the queue. Keep the queue's
`cdr` pointing at its last cons.

```stub
(defun enqueue (item queue)
  (not-written-yet 'enqueue))
```

```hint
Make the new cons with `(list item)`. When the queue is empty, it is both the
first and the last cons. Otherwise, set the `cdr` of the last cons, `(cdr
queue)`, to the new cons, then make the new cons the last.
```

```solution
(defun enqueue (item queue)
  (let ((new (list item)))
    (if (queue-empty-p queue)
        (setf (car queue) new
              (cdr queue) new)
        (setf (cdr (cdr queue)) new
              (cdr queue) new))
    queue))
```

```check
(let ((q (make-queue)))
  (enqueue 1 q)
  (enqueue 2 q)
  (is (eq q (enqueue 3 q)))
  (is (equal '(1 2 3) (queue-items q)))
  (is (eq (cdr q) (last (car q))))
  (is (equal 1 (dequeue q)))
  (enqueue 4 q)
  (is (equal '(2 3 4) (queue-items q)))
  (loop repeat 3 do (dequeue q))
  (is (queue-empty-p q))
  (enqueue 5 q)
  (is (equal '(5) (queue-items q))))
(let ((q (make-queue)))
  (dotimes (i 100000) (enqueue i q))
  (is (equal 100000 (length (queue-items q)))))
```

## Exercise: The cells that read a cell

Define `(dependents sheet cell)`. It returns the cells of `sheet` whose
formulas read `cell` directly, in `sheet-cells` order. Use `formula-refs`
from lesson 16.

```stub
(defun dependents (sheet cell)
  (not-written-yet 'dependents))
```

```hint
Keep the cells of `(sheet-cells sheet)` whose formula's refs include `cell`:
`remove-if-not` with `member`.
```

```solution
(defun dependents (sheet cell)
  (remove-if-not (lambda (c) (member cell (formula-refs (cell-formula sheet c))))
                 (sheet-cells sheet)))
```

```check
(let ((s (sheet-from :a1 1 :a2 '(+ :a1 1) :b1 '(sum :a1 :a2) :b2 '(* :b1 2) :c1 5)))
  (is (equal '(:a2 :b1) (dependents s :a1)))
  (is (equal '(:b1) (dependents s :a2)))
  (is (equal '(:b2) (dependents s :b1)))
  (is (equal '() (dependents s :c1))))
```

## Exercise: Recalculation order

Define `(recalc-order sheet cell)`. It returns every cell that depends on
`cell`, directly or through other cells, each once and `cell` itself not
included. Each cell comes after every cell in the list that it reads. When
the cells read each other in a circle, it signals `circular-reference`.

```stub
(defun recalc-order (sheet cell)
  (not-written-yet 'recalc-order))
```

```hint
Step 1: enqueue `cell`. Until the queue is empty, dequeue a cell, and for
each of its `dependents` not yet seen, record it and enqueue it. Reaching
`cell` again means a circle. Step 2: until none wait, find a waiting cell
whose `formula-refs` include no waiting cell, and move it to the result.
When there is none, signal `circular-reference`.
```

```solution
(defun recalc-order (sheet cell)
  (let ((queue (make-queue))
        (waiting '()))
    (enqueue cell queue)
    (loop until (queue-empty-p queue)
          do (dolist (d (dependents sheet (dequeue queue)))
               (when (eq d cell)
                 (error 'circular-reference :cell cell))
               (unless (member d waiting)
                 (push d waiting)
                 (enqueue d queue))))
    (setf waiting (nreverse waiting))
    (let ((order '()))
      (loop while waiting
            do (let ((ready (find-if (lambda (c)
                                       (notany (lambda (r) (member r waiting))
                                               (formula-refs (cell-formula sheet c))))
                                     waiting)))
                 (unless ready
                   (error 'circular-reference :cell (first waiting)))
                 (push ready order)
                 (setf waiting (remove ready waiting))))
      (nreverse order))))
```

```check
(let ((s (sheet-from :a1 1 :b1 '(+ :a1 :c1) :c1 '(* :a1 2) :d1 '(+ :b1 :c1) :e1 7)))
  (let ((order (recalc-order s :a1)))
    (is (equal '(:b1 :c1 :d1) (sort (copy-list order) #'cell<)))
    (is (< (position :c1 order) (position :b1 order)))
    (is (< (position :b1 order) (position :d1 order))))
  (is (equal '() (recalc-order s :e1)))
  (is (equal '(:d1) (recalc-order s :b1))))
(signals circular-reference (recalc-order (sheet-from :a1 '(+ :b1 1) :b1 '(* :a1 2)) :a1))
(signals circular-reference (recalc-order (sheet-from :a1 1 :b1 '(+ :a1 :c1) :c1 '(+ :b1 1)) :a1))
```
