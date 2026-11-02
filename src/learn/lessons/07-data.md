---
title: Arrays, strings, hash tables and structures
level: beginner
reading: ANSI Common Lisp, chapter 4
---
Lists are flexible, but finding the 1000th element of one means walking past
999 others. Lisp has other data structures for other jobs. This lesson
introduces four of them.

### Arrays

`make-array` makes an array of a given size, and `aref` reads or, with
`setf`, writes an element by its index, starting at 0. Reading any element
takes the same short time.

```lisp
(let ((a (make-array 3 :initial-element 0)))
  (setf (aref a 1) 'middle)
  a)
```

`#(1 2 3)` is how Lisp writes a one-dimensional array, called a **vector**.

### Strings are sequences

A string is a vector of characters. A character is written `#\a`. Many
functions work on any **sequence**: lists, vectors and strings alike.

```lisp
(list (length "hello") (char "hello" 1) (reverse "hello") (subseq "hello world" 6))
```

```lisp
(list (position #\o "hello") (search "lo" "hello") (string-upcase "shout") (string= "abc" "abc"))
```

Compare strings with `string=` or `equal`, not `eql`: two strings with the
same letters are usually different objects.

### Hash tables

A hash table maps keys to values and finds a key quickly, however many there
are. `gethash` reads a value; `setf` of `gethash` stores one. For string keys,
make the table with `:test 'equal`.

```lisp
(let ((ages (make-hash-table :test 'equal)))
  (setf (gethash "ada" ages) 36)
  (setf (gethash "alan" ages) 41)
  (list (gethash "ada" ages) (gethash "grace" ages) (hash-table-count ages)))
```

`gethash` returns `nil` for a missing key. `(gethash key table 0)` returns 0
instead, which makes counting easy. `maphash` calls a function on each key
and value, in no particular order.

### Structures

`defstruct` defines a new kind of record with named slots. It also defines a
function to make one and a function to read each slot:

```lisp
(defstruct book title pages)
```

After running that, `(make-book :title "SICP" :pages 657)` makes a book,
`(book-pages b)` reads a slot, and `(setf (book-pages b) 700)` changes it.

## Exercise: Count the vowels

Define `(vowel-count string)`, which returns how many of its characters are
vowels: a, e, i, o or u, in lower or upper case.

```stub
(defun vowel-count (string)
  (not-written-yet 'vowel-count))
```

```hint
`count-if` counts the elements of a sequence a predicate accepts. A
character is a vowel when `(find (char-downcase c) "aeiou")` is true.
```

```solution
(defun vowel-count (string)
  (count-if (lambda (c) (find (char-downcase c) "aeiou")) string))
```

```check
(is (eql 2 (vowel-count "hello")))
(is (eql 5 (vowel-count "AEIOU")))
(is (eql 0 (vowel-count "rhythm")))
(is (eql 0 (vowel-count "")))
```

## Exercise: Word frequencies

Define `(word-frequencies words)`, which takes a list of strings and returns a
hash table that maps each word to how many times it appears.

```stub
(defun word-frequencies (words)
  (not-written-yet 'word-frequencies))
```

```hint
Make the table with `:test 'equal`, since the keys are strings. For each word,
`(incf (gethash word table 0))` adds one, starting from 0 the first time.
Return the table at the end.
```

```solution
(defun word-frequencies (words)
  (let ((table (make-hash-table :test 'equal)))
    (dolist (w words)
      (incf (gethash w table 0)))
    table))
```

```check
(is (eql 2 (gethash "the" (word-frequencies '("the" "cat" "the")))))
(is (eql 1 (gethash "cat" (word-frequencies '("the" "cat" "the")))))
(is (eql 2 (hash-table-count (word-frequencies '("a" "b" "a")))))
(is (eql 0 (hash-table-count (word-frequencies '()))))
```

## Exercise: Distance between points

The stub defines a `point` structure with `x` and `y` slots. Define
`(point-distance p q)`, which returns the straight-line distance between two
points. `sqrt` returns a square root.

```stub
(defstruct point x y)

(defun point-distance (p q)
  (not-written-yet 'point-distance))
```

```hint
Take the difference of the `x` slots and of the `y` slots, square each, add
them, and take the square root of the sum.
```

```solution
(defstruct point x y)

(defun point-distance (p q)
  (let ((dx (- (point-x q) (point-x p)))
        (dy (- (point-y q) (point-y p))))
    (sqrt (+ (* dx dx) (* dy dy)))))
```

```check
(is (= 5 (point-distance (make-point :x 0 :y 0) (make-point :x 3 :y 4))))
(is (= 0 (point-distance (make-point :x 2 :y 2) (make-point :x 2 :y 2))))
(is (= 10 (point-distance (make-point :x -3 :y 0) (make-point :x 3 :y 8))))
```
