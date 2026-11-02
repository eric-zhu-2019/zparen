---
title: Recursion over lists
level: beginner
reading: ANSI Common Lisp, sections 2.7–2.8 and 3.1–3.2
---
Lists are the heart of Lisp. This lesson shows how they are built, and how a
function can walk one by calling itself.

### Building lists

`cons` puts an element on the front of a list. `list` builds a whole list at
once. Both make new lists and leave their arguments alone.

```lisp
(list (cons 'a '(b c)) (cons 'a nil) (list 'a 'b 'c))
```

### Taking lists apart

`first` returns the first element, and `rest` returns everything after it.
Their older names, `car` and `cdr`, mean the same thing and you will see
them often.

```lisp
(list (first '(a b c)) (rest '(a b c)) (car '(a b c)) (cdr '(a b c)))
```

`(rest '(c))` is `nil`, the empty list. `null` asks whether a list is empty:

```lisp
(list (null '()) (null '(a)) (rest '(c)))
```

### The shape of a list

A list is either empty, or a first element followed by the rest of the list.
A function over a list can follow that same shape: say what happens for the
empty list, then handle the first element and call itself on the rest.

```lisp
(defun sum-list (numbers)
  (if (null numbers)
      0
      (+ (first numbers) (sum-list (rest numbers)))))
```

Run it, then try `(sum-list '(1 2 3))`. Each call works on a shorter list, so
the calls must reach the empty list and stop. That first case, the one that
does not call itself, is called the **base case**.

### Returning part of a list

A function can return a list it was given, or a tail of it, without copying.
`(rest '(a b c))` is the same cells as the original list, starting one
element later.

## Exercise: Count the elements

Define `(our-length list)`, which returns how many elements `list` has. Use
recursion, not `length`.

```stub
(defun our-length (list)
  (not-written-yet 'our-length))
```

```hint
The empty list has length 0. Any other list is one longer than its rest.
```

```solution
(defun our-length (list)
  (if (null list)
      0
      (+ 1 (our-length (rest list)))))
```

```check
(is (eql 0 (our-length '())))
(is (eql 1 (our-length '(a))))
(is (eql 3 (our-length '(a b c))))
(is (eql 2 (our-length '((a b) (c d)))))
```

## Exercise: Find a member

Define `(our-member x list)`. When `x` is in `list`, return the part of
`list` that starts with `x`; otherwise return `nil`. Compare elements with
`eql`.

```stub
(defun our-member (x list)
  (not-written-yet 'our-member))
```

```hint
When the first element is `eql` to `x`, the list you are looking at already
starts with `x`, so return it. Otherwise look in the rest.
```

```solution
(defun our-member (x list)
  (cond ((null list) nil)
        ((eql x (first list)) list)
        (t (our-member x (rest list)))))
```

```check
(is (equal '(b c) (our-member 'b '(a b c))))
(is (equal '(a b c) (our-member 'a '(a b c))))
(is (equal '(3) (our-member 3 '(1 2 3))))
(is-false (our-member 'z '(a b c)))
(is-false (our-member 'a '()))
```

## Exercise: Count the matches

Define `(count-matches x list)`, which returns how many elements of `list`
are `eql` to `x`.

```stub
(defun count-matches (x list)
  (not-written-yet 'count-matches))
```

```hint
Like `our-length`, but only add 1 when the first element is `eql` to `x`.
Either way, keep counting in the rest.
```

```solution
(defun count-matches (x list)
  (cond ((null list) 0)
        ((eql x (first list)) (+ 1 (count-matches x (rest list))))
        (t (count-matches x (rest list)))))
```

```check
(is (eql 0 (count-matches 'a '())))
(is (eql 3 (count-matches 'a '(a b a c a))))
(is (eql 0 (count-matches 'z '(a b c))))
(is (eql 2 (count-matches 1 '(1 2 1))))
```
