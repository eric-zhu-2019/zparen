---
title: Make it fast
level: advanced
project: Spreadsheet
reading: ANSI Common Lisp, chapter 13
---
A big sheet holds columns of thousands of numbers. This lesson makes the code
that adds and scales them fast, and finds a slow function by measuring
instead of guessing.

### Measure first

Most of a program's time goes to a small part of it. Find that part before
you change anything. `time` reports how long a form takes and how many bytes
it allocates:

```lisp
(time (loop repeat 100000 collect (random 1.0)))
```

To see *where* the time goes, put the cursor on a form in the editor and press
⌥⌘P (`,p` in Vim). ZParen runs the form under SBCL's profiler and shows the
functions that took the time in the Profile panel.

### Garbage

Allocating memory is cheap, but collecting it later is not. A loop that
allocates on each pass slows down as it grows. Two kinds of allocation hide
in ordinary code:

- A new list or array on each call, where changing an existing one would do.
  `append` in a loop copies the whole list each time.
- **Boxing**. A double-float in a general variable lives in memory of its
  own, so each sum makes a new one. SBCL can keep floats in registers when it
  knows their type.

### Declarations

`declare` tells the compiler what it can rely on. With the types known, SBCL
uses the machine's own float and array instructions:

```lisp
(defun dot (a b)
  (declare (type (simple-array double-float (*)) a b)
           (optimize speed))
  (let ((sum 0d0))
    (declare (type double-float sum))
    (dotimes (i (length a) sum)
      (incf sum (* (aref a i) (aref b i))))))
```

With `(optimize speed)`, SBCL also writes notes about what it could not make
fast. ZParen shows them in Problems, at the line they are about. A
declaration is a promise: in the default safety, SBCL checks it, and a wrong
type is an error, not a wrong answer.

`sb-ext:get-bytes-consed` counts the bytes allocated so far. This lesson's
tests use it to check that the code allocates nothing as it runs.

A **column** here is a `(simple-array double-float (*))`: a vector of
double-floats, made with
`(make-array n :element-type 'double-float :initial-element 0d0)`.

### Fix it: a slow function

The third exercise starts as working code that is too slow. Run it under the
profiler first, then change it.

## Exercise: Add up a column

Define `(column-total column)`. It returns the sum of the numbers in
`column`, a column of double-floats, as a double-float. It allocates almost
nothing, however long the column is.

```stub
(defun column-total (column)
  (not-written-yet 'column-total))
```

```hint
Declare the column's type and `(optimize speed)`. Keep the sum in a variable
declared `double-float`, start it at `0d0`, and add each element with
`incf`.
```

```solution
(defun column-total (column)
  (declare (type (simple-array double-float (*)) column)
           (optimize speed))
  (let ((total 0d0))
    (declare (type double-float total))
    (loop for x across column
          do (incf total x))
    total))
```

```check
(let ((column (make-array 200000 :element-type 'double-float :initial-element 0.5d0)))
  (is (= 100000d0 (column-total column)))
  (let ((before (sb-ext:get-bytes-consed)))
    (column-total column)
    (is (< (- (sb-ext:get-bytes-consed) before) 500000))))
(is (= 0d0 (column-total (make-array 0 :element-type 'double-float))))
```

## Exercise: Scale a column in place

Define `(scale-column column factor)`. It multiplies each number in `column`
by `factor`, a double-float, changing the column itself, and returns the
column. It allocates almost nothing.

```stub
(defun scale-column (column factor)
  (not-written-yet 'scale-column))
```

```hint
Declare both arguments' types and `(optimize speed)`. Loop over the indexes
with `dotimes`, and `setf` each `aref`.
```

```solution
(defun scale-column (column factor)
  (declare (type (simple-array double-float (*)) column)
           (type double-float factor)
           (optimize speed))
  (dotimes (i (length column) column)
    (setf (aref column i) (* factor (aref column i)))))
```

```check
(let ((column (make-array 200000 :element-type 'double-float :initial-element 2d0)))
  (is (eq column (scale-column column 1.5d0)))
  (is (= 3d0 (aref column 0) (aref column 199999)))
  (let ((before (sb-ext:get-bytes-consed)))
    (scale-column column 2d0)
    (is (< (- (sb-ext:get-bytes-consed) before) 500000)))
  (is (= 6d0 (aref column 500))))
```

## Exercise: The cells in use

`used-cells` returns the cells the sheet's formulas read, each once, in the
order the sheet's cells first read them. It gives the right answer, but on a
sheet of a few thousand cells it allocates more than a hundred megabytes.
Profile it, find out why, and make it fast. Keep what it returns the same.

```fix
(defun used-cells (sheet)
  "The cells that SHEET's formulas read, each once, in the order the cells of
SHEET first read them."
  (let ((used '()))
    (dolist (cell (sheet-cells sheet) used)
      (dolist (ref (formula-refs (cell-formula sheet cell)))
        (unless (member ref used)
          (setf used (append used (list ref))))))))
```

```hint
`append` copies `used` each time it adds one cell, and `member` reads all of
it. Keep the cells seen in a hash table, `push` each new one, and reverse the
list once at the end.
```

```solution
(defun used-cells (sheet)
  "The cells that SHEET's formulas read, each once, in the order the cells of
SHEET first read them."
  (let ((seen (make-hash-table))
        (used '()))
    (dolist (cell (sheet-cells sheet))
      (dolist (ref (formula-refs (cell-formula sheet cell)))
        (unless (gethash ref seen)
          (setf (gethash ref seen) t)
          (push ref used))))
    (nreverse used)))
```

```check
(is (equal '(:a1 :b1 :c1) (used-cells (sheet-from :a1 1 :a2 '(+ :a1 :b1) :a3 '(* :c1 :a1)))))
(let ((s (make-sheet)))
  (dotimes (i 4000)
    (setf (cell-formula s (cell-at #\a (1+ i))) (cell-at #\b (1+ i))))
  (let ((before (sb-ext:get-bytes-consed)))
    (is (equal 4000 (length (used-cells s))))
    (is (< (- (sb-ext:get-bytes-consed) before) 20000000))))
```
