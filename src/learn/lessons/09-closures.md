---
title: Lambda lists and closures
level: intermediate
reading: ANSI Common Lisp, chapter 6
---
A function's parameter list is called its **lambda list**. So far yours have
named one variable per argument. Lambda lists can do more: some arguments can
be left out, some can be named at the call, and some can be gathered into a
list.

### Optional arguments

Parameters after `&optional` may be left out. Each one can have a default,
and a third name that tells you whether the caller supplied it:

```lisp
(defun greet-person (name &optional (greeting "Hello" greeting-p))
  (list (format nil "~a, ~a!" greeting name) greeting-p))
```

Run it, then try `(greet-person "Ada")` and `(greet-person "Ada" "Hi")`.

### Keyword arguments

Parameters after `&key` are passed by name, in any order. A keyword argument
the caller leaves out gets its default, or `nil`:

```lisp
(defun box-size (&key (width 1) (height 1))
  (* width height))
```

After you run it, `(box-size :height 4)` returns 4, and `(box-size :height 2
:width 3)` returns 6.

### Rest arguments

`&rest` gathers every remaining argument into one list:

```lisp
(defun count-args (&rest things)
  (length things))
```

### Closures

A function made inside a `let` keeps the variables it uses, even after the
`let` has returned. That function is a **closure**. Each call to the outer
function makes a new set of variables:

```lisp
(let ((total 0))
  (defun add-to-total (n)
    (incf total n)))
```

Call `(add-to-total 5)` twice: the second call returns 10, because `total`
lives on inside the function.

A function can also return a closure. Every call returns a new function with
its own copy of the variables:

```lisp
(defun make-multiplier (factor)
  (lambda (x) (* x factor)))
```

`(funcall (make-multiplier 3) 7)` returns 21.

### Local functions

`flet` defines functions that exist only inside its body. `labels` does the
same, but its functions can call themselves and each other, so use it for a
recursive helper:

```lisp
(labels ((countdown (n)
           (if (zerop n)
               '(liftoff)
               (cons n (countdown (- n 1))))))
  (countdown 3))
```

## Exercise: A counter

Define `(make-counter-from start &key (step 1))`. It returns a function. Each
call to that function returns the next number, starting with `start` and
going up by `step`. Two counters must not share their count.

```stub
(defun make-counter-from (start &key (step 1))
  (not-written-yet 'make-counter-from))
```

```hint
Make a variable with `let` that holds the next number, and return a `lambda`
that saves its value, adds `step` to it, and returns the saved value.
```

```solution
(defun make-counter-from (start &key (step 1))
  (let ((next start))
    (lambda ()
      (prog1 next
        (incf next step)))))
```

```check
(is (equal '(5 6 7) (let ((c (make-counter-from 5))) (list (funcall c) (funcall c) (funcall c)))))
(is (equal '(0 10 20) (let ((c (make-counter-from 0 :step 10))) (list (funcall c) (funcall c) (funcall c)))))
(is (equal '(1 2 1) (let ((a (make-counter-from 1)) (b (make-counter-from 1))) (list (funcall a) (funcall a) (funcall b)))))
```

## Exercise: Plurals

Define `(pluralize word count &optional plural)`. It returns a string with
the count and the word, such as `"1 cat"` or `"3 cats"`. When the count is
not 1, it uses `plural` if the caller gave one, and otherwise adds an `s` to
`word`.

```stub
(defun pluralize (word count &optional plural)
  (not-written-yet 'pluralize))
```

```hint
`(format nil "~d ~a" count name)` makes the string. Choose the name first:
`word` when `count` is 1, else `plural`, else `word` with `"s"` added by
`concatenate`.
```

```solution
(defun pluralize (word count &optional plural)
  (format nil "~d ~a" count
          (cond ((= count 1) word)
                (plural plural)
                (t (concatenate 'string word "s")))))
```

```check
(is (equal "1 cat" (pluralize "cat" 1)))
(is (equal "3 cats" (pluralize "cat" 3)))
(is (equal "0 cats" (pluralize "cat" 0)))
(is (equal "2 geese" (pluralize "goose" 2 "geese")))
(is (equal "1 goose" (pluralize "goose" 1 "geese")))
```

## Exercise: Compose two functions

Define `(compose-two f g)`. It returns a function of one argument that calls
`g` on the argument, then calls `f` on that result.

```stub
(defun compose-two (f g)
  (not-written-yet 'compose-two))
```

```hint
Return a `lambda` of one parameter, `x`. Its body is
`(funcall f (funcall g x))`.
```

```solution
(defun compose-two (f g)
  (lambda (x)
    (funcall f (funcall g x))))
```

```check
(is (equal 4 (funcall (compose-two #'1+ #'abs) -3)))
(is (equal '(a) (funcall (compose-two #'list #'car) '(a b))))
(is (equal '(-2 -3) (mapcar (compose-two #'- #'1+) '(1 2))))
```
