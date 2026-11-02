---
title: Variables and iteration
level: beginner
reading: ANSI Common Lisp, sections 2.9–2.13
---
Recursion is one way to repeat work. This lesson shows the other: naming
values, changing them, and looping.

### Local variables

`let` gives names to values for the length of its body. The names disappear
when `let` ends.

```lisp
(let ((x 3)
      (y 4))
  (+ (* x x) (* y y)))
```

In a `let`, every value is computed before any name exists. When one value
needs an earlier one, use `let*`, which binds them in order:

```lisp
(let* ((width 3)
       (area (* width width)))
  area)
```

### Global variables

`defparameter` makes a global variable. By custom, global names have stars
around them, so you can tell them apart from local ones.

```lisp
(defparameter *greeting* "Hello")
```

`defvar` is similar, but it leaves the value alone if the variable already
exists, which is what you want for state you don't want reset when a file is
loaded again.

### Changing a value

`setf` gives a new value to a variable, or to any place that holds a value.

```lisp
(let ((count 0))
  (setf count (+ count 1))
  (setf count (+ count 1))
  count)
```

`(incf count)` is a shorter way to add 1.

### Loops

`dolist` runs its body once for each element of a list. `dotimes` counts from
0 up to one less than a number.

```lisp
(let ((total 0))
  (dolist (n '(1 2 3 4))
    (incf total n))
  total)
```

```lisp
(let ((squares '()))
  (dotimes (i 5)
    (push (* i i) squares))
  (reverse squares))
```

`do` is the general loop. It lists each variable with its start value and how
it changes, then a test that ends the loop and the value to return:

```lisp
(do ((i 1 (+ i 1))
     (product 1 (* product i)))
    ((> i 5) product))
```

### A taste of loop

`loop` is a small language of its own for iteration. You will meet more of it
later; for now, here are two common shapes:

```lisp
(list (loop for i from 1 to 5 collect (* 10 i))
      (loop for x in '(3 1 4 1 5) sum x))
```

## Exercise: Sum to n

Define `(sum-to n)`, which returns 1 + 2 + … + n, using a loop rather than a
formula. For `n` of 0 it returns 0.

```stub
(defun sum-to (n)
  (not-written-yet 'sum-to))
```

```hint
Keep a running total in a `let`, and add each number from 1 to `n` to it with
`dotimes`, `do` or `loop`. Remember that `dotimes` starts at 0.
```

```solution
(defun sum-to (n)
  (let ((total 0))
    (dotimes (i n)
      (incf total (+ i 1)))
    total))
```

```check
(is (eql 0 (sum-to 0)))
(is (eql 1 (sum-to 1)))
(is (eql 15 (sum-to 5)))
(is (eql 5050 (sum-to 100)))
```

## Exercise: Count down

Define `(count-down n)`, which returns the list `(n … 3 2 1)`. For `n` of 0 it
returns the empty list.

```stub
(defun count-down (n)
  (not-written-yet 'count-down))
```

```hint
`push` adds to the front of a list. If you push 1, then 2, then 3, the list
reads `(3 2 1)`.
```

```solution
(defun count-down (n)
  (let ((result '()))
    (dotimes (i n)
      (push (+ i 1) result))
    result))
```

```check
(is (equal '(3 2 1) (count-down 3)))
(is (equal '(1) (count-down 1)))
(is (equal '() (count-down 0)))
(is (eql 10 (length (count-down 10))))
```

## Exercise: The longest string

Define `(longest-string strings)`, which returns the longest string in the
list `strings`. When two are equally long, return the first of them. For an
empty list, return `nil`.

```stub
(defun longest-string (strings)
  (not-written-yet 'longest-string))
```

```hint
Walk the list with `dolist`, keeping the best string so far in a variable that
starts as `nil`. Replace it only when a string is strictly longer.
```

```solution
(defun longest-string (strings)
  (let ((best nil))
    (dolist (s strings)
      (when (or (null best) (> (length s) (length best)))
        (setf best s)))
    best))
```

```check
(is (equal "banana" (longest-string '("fig" "banana" "kiwi"))))
(is (equal "ab" (longest-string '("ab" "cd" "e"))))
(is (equal "solo" (longest-string '("solo"))))
(is-false (longest-string '()))
```
