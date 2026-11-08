---
title: Cells and formulas
level: advanced
project: Spreadsheet
reading: On Lisp, chapter 4; ANSI Common Lisp, section 3.8
---
From here on, the lessons build programs. Each project runs over a few
lessons, and each exercise adds a working part to it. The first project is a
small **spreadsheet**: cells such as `:a1` hold numbers or formulas, and the
sheet works out every cell's value.

A formula is a Lisp list, so you need no parser. `(+ :a1 (* 2 :b1))` adds
`:a1` to twice `:b1`, and `(sum :a1 :a3)` adds every cell from `:a1` to `:a3`.
Your code reads formulas as data, the same way Lisp reads code.

### The provided code

Each project lesson starts with code written for you, at the top of its file.
Open **Provided code** below to read it. Here it gives you the sheet, a way to
read and set a cell's formula, and three helpers for cell names:

```lisp
(let ((sheet (sheet-from :a1 2 :a2 '(+ :a1 1))))
  (list (cell-formula sheet :a2)
        (cell-column :b12)
        (cell-row :b12)
        (cell-at #\c 7)))
```

```given
(defstruct (sheet (:constructor make-sheet ()))
  "A spreadsheet: each cell's formula, by cell name, such as :A1."
  (formulas (make-hash-table) :read-only t))

(defun cell-formula (sheet cell)
  "The formula in CELL, or NIL when the cell is empty."
  (values (gethash cell (sheet-formulas sheet))))

(defun (setf cell-formula) (formula sheet cell)
  (setf (gethash cell (sheet-formulas sheet)) formula))

(defun sheet-from (&rest cells-and-formulas)
  "A new sheet with each cell set to the formula after it:
(sheet-from :a1 1 :a2 '(+ :a1 1))."
  (let ((sheet (make-sheet)))
    (loop for (cell formula) on cells-and-formulas by #'cddr
          do (setf (cell-formula sheet cell) formula))
    sheet))

(defun cell-column (cell)
  "The letter of CELL's column, as a character: #\\A for :A1."
  (char (symbol-name cell) 0))

(defun cell-row (cell)
  "The row of CELL, as a number: 12 for :B12."
  (parse-integer (symbol-name cell) :start 1))

(defun cell-at (column row)
  "The cell at COLUMN, a character, and ROW, a number: :C7 for #\\c and 7."
  (intern (format nil "~a~d" (char-upcase column) row) :keyword))

(define-condition bad-formula (error)
  ((formula :initarg :formula :reader bad-formula-formula))
  (:report (lambda (c stream)
             (format stream "~s is not a formula this sheet knows."
                     (bad-formula-formula c)))))
```

### Small utilities

*On Lisp* chapter 4 makes a case for small, general functions, written once
and used everywhere. A spreadsheet needs a few: the cells in a range, the
cells a formula reads, and the value of a formula. Each one is short, and
each later exercise uses the one before it.

### Walking a tree

A formula is a tree. To visit every part of it, write a function that handles
one node and calls itself on the parts. `labels` defines such a function
inside another, so it can use the outer function's variables:

```lisp
(defun count-numbers (tree)
  (let ((n 0))
    (labels ((walk (x)
               (cond ((numberp x) (incf n))
                     ((consp x) (mapc #'walk x)))))
      (walk tree))
    n))
```

`(count-numbers '(+ 1 (* 2 3) :a1))` returns 3.

### Calling an operator you hold

When the first element of a formula is `+` or `max`, the symbol names a
function. `apply` calls it with a list of arguments:

```lisp
(apply '+ (list 1 2 3))
```

## Exercise: Cells in a range

Define `(range-cells from to)`. It returns every cell in the rectangle from
`from`, its top-left corner, to `to`, its bottom-right corner. List them
column by column, and top to bottom in each column. `(range-cells :a1 :b2)`
returns `(:a1 :a2 :b1 :b2)`.

```stub
(defun range-cells (from to)
  (not-written-yet 'range-cells))
```

```hint
Loop over the character codes of the columns, from `(char-code (cell-column
from))` to `(char-code (cell-column to))`. For each, loop over the rows, and
make each cell with `cell-at` and `code-char`. `loop ... append` joins the
columns.
```

```solution
(defun range-cells (from to)
  (loop for code from (char-code (cell-column from)) to (char-code (cell-column to))
        append (loop for row from (cell-row from) to (cell-row to)
                     collect (cell-at (code-char code) row))))
```

```check
(is (equal '(:a1 :a2 :a3) (range-cells :a1 :a3)))
(is (equal '(:a1 :a2 :b1 :b2) (range-cells :a1 :b2)))
(is (equal '(:c4) (range-cells :c4 :c4)))
(is (equal '(:b9 :b10 :b11) (range-cells :b9 :b11)))
```

## Exercise: The cells a formula reads

Define `(formula-refs formula)`. It returns the cells `formula` reads, each
once, in the order they first appear. A `(sum from to)` reads every cell in
its range. A number reads nothing.

```stub
(defun formula-refs (formula)
  (not-written-yet 'formula-refs))
```

```hint
Walk the formula with a local function from `labels`. Push a keyword with
`pushnew`. For a list that starts with `sum`, walk `(range-cells (second f)
(third f))`. For any other list, walk its arguments, `(rest f)`. Return the
list reversed, since `pushnew` adds to the front.
```

```solution
(defun formula-refs (formula)
  (let ((refs '()))
    (labels ((walk (f)
               (cond ((keywordp f) (pushnew f refs))
                     ((and (consp f) (eq (first f) 'sum))
                      (mapc #'walk (range-cells (second f) (third f))))
                     ((consp f) (mapc #'walk (rest f))))))
      (walk formula))
    (nreverse refs)))
```

```check
(is (equal '() (formula-refs 42)))
(is (equal '(:a1) (formula-refs :a1)))
(is (equal '(:a1 :b1) (formula-refs '(+ :a1 (* 2 :b1) :a1))))
(is (equal '(:c1 :a1 :a2 :a3) (formula-refs '(- :c1 (sum :a1 :a3)))))
```

## Exercise: The value of a formula

Define `(eval-formula formula sheet)`. It returns the formula's value:

- A number is its own value.
- A cell's value is the value of its formula. An empty cell is 0.
- `(sum from to)` adds the values of the cells in its range.
- A list that starts with `+`, `-`, `*`, `/`, `max` or `min` applies that
  operator to the values of its arguments.
- Anything else signals `bad-formula`, with the formula in its slot.

```stub
(defun eval-formula (formula sheet)
  (not-written-yet 'eval-formula))
```

```hint
Use `cond`, one clause for each case. An empty cell's formula is `nil`, so
check for `nil` first. For an operator, test it with `member`, then `apply`
it to `(mapcar (lambda (f) (eval-formula f sheet)) (rest formula))`.
```

```solution
(defun eval-formula (formula sheet)
  (flet ((value (f) (eval-formula f sheet)))
    (cond ((null formula) 0)
          ((numberp formula) formula)
          ((keywordp formula) (value (cell-formula sheet formula)))
          ((and (consp formula) (eq (first formula) 'sum))
           (reduce #'+ (mapcar #'value (range-cells (second formula) (third formula)))))
          ((and (consp formula) (member (first formula) '(+ - * / max min)))
           (apply (first formula) (mapcar #'value (rest formula))))
          (t (error 'bad-formula :formula formula)))))
```

```check
(let ((s (sheet-from :a1 2 :a2 3 :a3 '(* :a1 :a2) :b1 '(sum :a1 :a3))))
  (is (equal 2 (eval-formula :a1 s)))
  (is (equal 6 (eval-formula :a3 s)))
  (is (equal 11 (eval-formula :b1 s)))
  (is (equal 0 (eval-formula :c9 s)))
  (is (equal 7 (eval-formula '(max 1 7 :a1) s)))
  (is (equal 1/2 (eval-formula '(/ 1 :a1) s)))
  (signals bad-formula (eval-formula '(launch :a1) s)))
```
