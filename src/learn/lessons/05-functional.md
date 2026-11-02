---
title: Functions as data
level: beginner
reading: ANSI Common Lisp, sections 2.14–2.15, and 6.1–6.2
---
In Lisp a function is a value, like a number or a list. You can pass it to
another function, keep it in a variable, and return it. This lesson shows
the tools for that.

### Naming a function as a value

`#'` (read "function quote") gives you the function a name stands for, rather
than calling it. `funcall` then calls a function value with arguments:

```lisp
(list #'+ (funcall #'+ 1 2 3))
```

`apply` is like `funcall`, but its last argument is a list of the remaining
arguments. It is useful when the arguments are already in a list:

```lisp
(list (apply #'+ '(1 2 3)) (apply #'max 4 '(9 2)))
```

### Functions without names

`lambda` makes a function on the spot, with no name. It is written like a
`defun` without the name:

```lisp
(funcall (lambda (x) (* x x)) 7)
```

### Mapping over a list

`mapcar` calls a function on each element of a list and collects the results
in a new list. With two lists, it walks them side by side.

```lisp
(list (mapcar #'1+ '(1 2 3))
      (mapcar (lambda (x) (* x 10)) '(1 2 3))
      (mapcar #'+ '(1 2 3) '(10 20 30)))
```

### Keeping and removing

`remove-if` returns a new list without the elements a predicate accepts.
`remove-if-not` keeps only those elements.

```lisp
(list (remove-if #'evenp '(1 2 3 4 5)) (remove-if-not #'evenp '(1 2 3 4 5)))
```

### Folding a list into one value

`reduce` combines the elements of a list two at a time, from the left. With
`:initial-value` it also works on an empty list.

```lisp
(list (reduce #'+ '(1 2 3 4)) (reduce #'max '(3 9 2)) (reduce #'+ '() :initial-value 0))
```

### Functions that make functions

Because a `lambda` can use the variables around it, a function can build and
return a new one:

```lisp
(defun make-adder (n)
  (lambda (x) (+ x n)))
```

`(funcall (make-adder 5) 10)` returns 15. Lesson 9 goes much further with
this idea.

## Exercise: Apply twice

Define `(apply-twice f x)`, which calls the function `f` on `x`, then calls
`f` again on that result. `(apply-twice #'1+ 5)` returns 7.

```stub
(defun apply-twice (f x)
  (not-written-yet 'apply-twice))
```

```hint
`f` holds a function value, so call it with `funcall`. Call it once, and pass
what you get to a second `funcall`.
```

```solution
(defun apply-twice (f x)
  (funcall f (funcall f x)))
```

```check
(is (eql 7 (apply-twice #'1+ 5)))
(is (eql 81 (apply-twice (lambda (n) (* n n)) 3)))
(is (equal '(a a b) (apply-twice (lambda (l) (cons 'a l)) '(b))))
```

## Exercise: Squares of a list

Define `(squares-of numbers)`, which returns a list of the square of each
number, in the same order. Use `mapcar` and a `lambda`.

```stub
(defun squares-of (numbers)
  (not-written-yet 'squares-of))
```

```hint
`mapcar` needs a function of one argument. Write it with `lambda`: it takes a
number and multiplies it by itself.
```

```solution
(defun squares-of (numbers)
  (mapcar (lambda (n) (* n n)) numbers))
```

```check
(is (equal '(1 4 9) (squares-of '(1 2 3))))
(is (equal '(0 25) (squares-of '(0 -5))))
(is (equal '() (squares-of '())))
```

## Exercise: Product of the odd numbers

Define `(odd-product numbers)`, which multiplies together the odd numbers in
the list and returns the product. When there are none, it returns 1.

```stub
(defun odd-product (numbers)
  (not-written-yet 'odd-product))
```

```hint
Two steps: keep only the odd numbers with `remove-if-not`, then combine them
with `reduce` and `*`. Give `reduce` an initial value of 1 for the empty case.
```

```solution
(defun odd-product (numbers)
  (reduce #'* (remove-if-not #'oddp numbers) :initial-value 1))
```

```check
(is (eql 15 (odd-product '(1 2 3 4 5))))
(is (eql 1 (odd-product '(2 4 6))))
(is (eql 1 (odd-product '())))
(is (eql -21 (odd-product '(-3 7 8))))
```
