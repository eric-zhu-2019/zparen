---
title: Numbers
level: intermediate
reading: ANSI Common Lisp, chapter 9
---
Lisp has several kinds of number, and it keeps track of which kind you have.
The main rule is that exact numbers stay exact until you ask for a float.

### Integers have no size limit

An integer can be as large as memory allows. Big integers are called
**bignums**, and you use them like any other number:

```lisp
(list (expt 2 100) (* 123456789 987654321))
```

### Ratios

Dividing integers gives an exact **ratio** when the result is not whole.
Lisp always reduces it:

```lisp
(list (/ 6 4) (/ 6 3) (+ 1/3 1/6) (numerator 3/4) (denominator 3/4))
```

### Floats

A number with a decimal point is a **float**. Floats are approximate, so
an exact answer can become a little wrong:

```lisp
(list 0.1 (- 1.1 1.0) (float 1/3) (= 1/2 0.5))
```

Use `=` to compare numbers of different kinds. `eql` also checks the kind,
so `(eql 1 1.0)` is false.

### Division with two results

`floor`, `ceiling`, `truncate` and `round` turn a division into an integer.
Each returns two values: the integer, and what is left over:

```lisp
(list (multiple-value-list (floor 17 5))
      (multiple-value-list (floor -17 5))
      (multiple-value-list (truncate -17 5))
      (multiple-value-list (round 7 2)))
```

`floor` goes down and `truncate` goes toward zero, so they differ for
negative numbers. `round` goes to the nearest integer, and to the even one on
a tie. `mod` and `rem` return only the second value of `floor` and
`truncate`.

### More tools

```lisp
(list (gcd 12 18) (lcm 4 6) (sqrt 16) (sqrt -4) (parse-integer "42") (evenp 10) (integerp 2.0))
```

`(sqrt -4)` returns a **complex** number, written `#C(0.0 2.0)`.

## Exercise: Digit sum

Define `(digit-sum n)`. It returns the sum of the decimal digits of the
integer `n`, which is 0 or more. `(digit-sum 1234)` returns 10. It must work
for bignums too.

```stub
(defun digit-sum (n)
  (not-written-yet 'digit-sum))
```

```hint
`(floor n 10)` returns the number without its last digit, and the last digit.
Add the last digit to the digit sum of the rest, and stop at 0.
```

```solution
(defun digit-sum (n)
  (if (zerop n)
      0
      (multiple-value-bind (rest digit) (floor n 10)
        (+ digit (digit-sum rest)))))
```

```check
(is (equal 0 (digit-sum 0)))
(is (equal 10 (digit-sum 1234)))
(is (equal 1 (digit-sum 1000)))
(is (equal 115 (digit-sum (expt 2 100))))
```

## Exercise: An exact mean

Define `(mean-of numbers)`. It returns the average of a list of numbers that
is not empty. With integers the answer stays exact, so `(mean-of '(1 2))`
returns `3/2`.

```stub
(defun mean-of (numbers)
  (not-written-yet 'mean-of))
```

```hint
Divide the sum by the length. `(reduce #'+ numbers)` gives the sum.
```

```solution
(defun mean-of (numbers)
  (/ (reduce #'+ numbers) (length numbers)))
```

```check
(is (equal 3/2 (mean-of '(1 2))))
(is (equal 2 (mean-of '(1 2 3))))
(is (equal 7 (mean-of '(7))))
(is (= 1 (mean-of '(0.5 1.5))))
```

## Exercise: Hours and minutes

Define `(hours-and-minutes minutes)`. It returns two values: the whole hours
in `minutes`, and the minutes left over. `(hours-and-minutes 135)` returns 2
and 15.

```stub
(defun hours-and-minutes (minutes)
  (not-written-yet 'hours-and-minutes))
```

```hint
`floor` already returns exactly these two values.
```

```solution
(defun hours-and-minutes (minutes)
  (floor minutes 60))
```

```check
(is (equal '(2 15) (multiple-value-list (hours-and-minutes 135))))
(is (equal '(0 59) (multiple-value-list (hours-and-minutes 59))))
(is (equal '(2 0) (multiple-value-list (hours-and-minutes 120))))
(is (equal '(0 0) (multiple-value-list (hours-and-minutes 0))))
```
