---
title: Compile formulas
level: advanced
project: Spreadsheet
reading: On Lisp, chapters 2, 3 and 5
---
`eval-formula` walks a formula's tree every time it runs. It also works out a
cell again each time another cell reads it. In a sheet where each cell reads
the cell above it twice, the 30th cell takes about half a billion steps. In this
lesson you turn each formula into a function **once**, and remember each
cell's value, so the sheet takes one step per cell.

### Functions are values

`lambda` makes a function, and a function can be kept in a variable, passed
to another function, and returned from one:

```lisp
(let ((add-ten (lambda (x) (+ x 10))))
  (funcall add-ten 5))
```

A function made inside another keeps the variables it uses, even after the
outer function returns. That is a **closure**:

```lisp
(defun adder (n)
  (lambda (x) (+ x n)))

(funcall (adder 3) 4)
```

### Returning functions

*On Lisp* chapter 5 builds programs from functions that return functions.
`complement` is one from Common Lisp:

```lisp
(remove-if (complement #'evenp) '(1 2 3 4 5 6))
```

To **compile** a formula is to do the walk now and return a function that only
does the arithmetic later. `(+ :a1 2)` becomes a closure that holds the
functions for `:a1` and for `2`, and adds their results. The closure takes
one argument, `lookup`: a function that gives a cell's value. A compiled
formula then works for any sheet.

A formula the sheet does not know is reported when you compile it, not each
time it runs.

### Remembering results

A function that always gives the same result for the same arguments can keep
its results in a hash table. The second call with those arguments is one
lookup. *On Lisp* calls this **memoizing**. Note that `gethash` returns a
second value, which tells a stored `nil` from a missing key.

To memoize a recursive function, the recursion must go through the memoized
version. Keep that version in a variable that the function's body calls:

```lisp
(let ((fib nil))
  (setf fib (lambda (n)
              (if (< n 2) n (+ (funcall fib (- n 1)) (funcall fib (- n 2))))))
  (funcall fib 20))
```

With `memoize` from exercise 2, `(setf fib (memoize (lambda (n) ...)))` makes
the same code run in linear time.

## Exercise: Compile a formula

Define `(compile-formula formula)`. It returns a function of one argument,
`lookup`, that returns the formula's value, calling `lookup` for each cell's
value. It handles the same formulas as `eval-formula`, `nil` included, and
signals `bad-formula` for any other formula when it compiles, not later.

```stub
(defun compile-formula (formula)
  (not-written-yet 'compile-formula))
```

```hint
Use `cond` as in `eval-formula`, but return a `lambda` from each clause. For
an operator, compile the arguments first with `mapcar`, outside the lambda.
Inside it, `(apply op (mapcar (lambda (f) (funcall f lookup)) args))`.
`constantly` makes a function that returns a fixed value.
```

```solution
(defun compile-formula (formula)
  (cond ((null formula) (constantly 0))
        ((numberp formula) (constantly formula))
        ((keywordp formula) (lambda (lookup) (funcall lookup formula)))
        ((and (consp formula) (eq (first formula) 'sum))
         (let ((cells (range-cells (second formula) (third formula))))
           (lambda (lookup) (reduce #'+ cells :key lookup))))
        ((and (consp formula) (member (first formula) '(+ - * / max min)))
         (let ((op (symbol-function (first formula)))
               (args (mapcar #'compile-formula (rest formula))))
           (lambda (lookup)
             (apply op (mapcar (lambda (f) (funcall f lookup)) args)))))
        (t (error 'bad-formula :formula formula))))
```

```check
(let ((lookup (lambda (cell) (ecase cell (:a1 1) (:a2 5) (:b1 10)))))
  (is (equal 7 (funcall (compile-formula 7) lookup)))
  (is (equal 0 (funcall (compile-formula nil) lookup)))
  (is (equal 5 (funcall (compile-formula :a2) lookup)))
  (is (equal 11 (funcall (compile-formula '(+ :a1 (* 2 :a2))) lookup)))
  (is (equal 6 (funcall (compile-formula '(sum :a1 :a2)) lookup)))
  (is (equal 10 (funcall (compile-formula '(max :a1 :b1)) lookup))))
(signals bad-formula (compile-formula '(launch :a1)))
(signals bad-formula (compile-formula '(+ 1 (launch :a1))))
```

## Exercise: Memoize

Define `(memoize fn)`. It returns a function that takes the same arguments as
`fn` and returns what `fn` returns. Calls with arguments `equal` to an
earlier call's return the earlier result without calling `fn`, a `nil`
result included.

```stub
(defun memoize (fn)
  (not-written-yet 'memoize))
```

```hint
Make a hash table with `:test 'equal` outside the `lambda`. The lambda takes
`&rest args` and uses the list of arguments as the key. Use both values of
`gethash` to tell a stored `nil` from no entry.
```

```solution
(defun memoize (fn)
  (let ((cache (make-hash-table :test 'equal)))
    (lambda (&rest args)
      (multiple-value-bind (value found) (gethash args cache)
        (if found
            value
            (setf (gethash args cache) (apply fn args)))))))
```

```check
(let* ((calls 0)
       (fast (memoize (lambda (x y) (incf calls) (+ x y)))))
  (is (equal 3 (funcall fast 1 2)))
  (is (equal 3 (funcall fast 1 2)))
  (is (equal 1 calls))
  (is (equal 5 (funcall fast 2 3)))
  (is (equal 2 calls)))
(let* ((calls 0)
       (odd (memoize (lambda (x) (incf calls) (evenp x)))))
  (is (equal nil (funcall odd 3)))
  (is (equal nil (funcall odd 3)))
  (is (equal 1 calls)))
```

## Exercise: A sheet's values

Define `(sheet-evaluator sheet)`. It returns a function that takes a cell and
returns its value. It compiles each cell's formula once at most, and works
out each cell's value once at most, however many cells read it.

```stub
(defun sheet-evaluator (sheet)
  (not-written-yet 'sheet-evaluator))
```

```hint
Make a variable `value`. Set it to a memoized function of one cell that
compiles the cell's formula and calls the result with `value` itself as the
lookup. Return `value`.
```

```solution
(defun sheet-evaluator (sheet)
  (let ((value nil))
    (setf value (memoize (lambda (cell)
                           (funcall (compile-formula (cell-formula sheet cell)) value))))
    value))
```

```check
(let ((value (sheet-evaluator (sheet-from :a1 2 :a2 3 :a3 '(* :a1 :a2) :b1 '(sum :a1 :a3)))))
  (is (equal 11 (funcall value :b1)))
  (is (equal 6 (funcall value :a3)))
  (is (equal 0 (funcall value :z9))))
(let ((s (sheet-from :a1 1)))
  (loop for row from 2 to 200
        for above = (cell-at #\a (1- row))
        do (setf (cell-formula s (cell-at #\a row)) (list '+ above above)))
  (is (equal (expt 2 199) (funcall (sheet-evaluator s) :a200))))
```
