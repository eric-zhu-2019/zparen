---
title: CLOS
level: intermediate
reading: ANSI Common Lisp, chapter 11
---
CLOS, the Common Lisp Object System, gives you classes and methods. Its
methods do not belong to classes. They belong to **generic functions**, and
Lisp picks a method by looking at the classes of the arguments.

### Classes

`defclass` names a class, its parent classes, and its **slots**. Each slot
can have an `:initarg` to set it, an `:initform` as its default, and an
`:accessor` to read and write it:

```lisp
(defclass demo-pet ()
  ((name :initarg :name :accessor demo-pet-name)
   (age :initarg :age :initform 0 :accessor demo-pet-age)))
```

`make-instance` makes an object of the class:

```lisp
(let ((p (make-instance 'demo-pet :name "Tom")))
  (list (demo-pet-name p) (demo-pet-age p)))
```

The accessor works with `setf` too: `(setf (demo-pet-age p) 3)`.

### Generic functions and methods

`defgeneric` declares a generic function. `defmethod` adds a method for
arguments of given classes:

```lisp
(defgeneric demo-sound (thing))
(defmethod demo-sound ((n number)) :beep)
(defmethod demo-sound ((s string)) :hum)
```

`(demo-sound 1)` returns `:beep`, and `(demo-sound "a")` returns `:hum`.

### Inheritance

A class lists its parent classes. An object of the child class is also an
object of each parent, so the parent's methods apply to it. A method for the
child is more specific, and Lisp runs it first. `call-next-method` calls the
next, less specific method:

```lisp
(defclass demo-cat (demo-pet) ())
(defgeneric demo-describe (pet))
(defmethod demo-describe ((p demo-pet)) (list :pet (demo-pet-name p)))
(defmethod demo-describe ((c demo-cat)) (cons :cat (call-next-method)))
```

After you run the first example of this lesson too,
`(demo-describe (make-instance 'demo-cat :name "Kit"))` returns
`(:cat :pet "Kit")`.

### Before and after methods

A `:before` method runs before the main method, and an `:after` method runs
after it. They are useful for checks and logs, and their values are ignored.

### Printing objects

Define a method on the standard generic function `print-object` to choose
how the REPL prints your objects. `print-unreadable-object` writes the
`#<...>` form for you:

```lisp
(defmethod print-object ((p demo-pet) stream)
  (print-unreadable-object (p stream :type t)
    (princ (demo-pet-name p) stream)))
```

## Exercise: Areas

The classes `circle-shape` and `rect-shape` and the generic function
`shape-area` are defined for you. Write the two methods, so that
`shape-area` returns the area of each kind of shape.

```stub
(defclass circle-shape ()
  ((radius :initarg :radius :reader circle-radius)))

(defclass rect-shape ()
  ((width :initarg :width :reader rect-width)
   (height :initarg :height :reader rect-height)))

(defgeneric shape-area (shape))

(defmethod shape-area ((s circle-shape))
  (not-written-yet 'shape-area))

(defmethod shape-area ((s rect-shape))
  (not-written-yet 'shape-area))
```

```hint
A circle's area is `pi` times the radius squared. A rectangle's is the width
times the height. Read the slots with the readers.
```

```solution
(defclass circle-shape ()
  ((radius :initarg :radius :reader circle-radius)))

(defclass rect-shape ()
  ((width :initarg :width :reader rect-width)
   (height :initarg :height :reader rect-height)))

(defgeneric shape-area (shape))

(defmethod shape-area ((s circle-shape))
  (* pi (circle-radius s) (circle-radius s)))

(defmethod shape-area ((s rect-shape))
  (* (rect-width s) (rect-height s)))
```

```check
(is (equal 6 (shape-area (make-instance 'rect-shape :width 2 :height 3))))
(is (equal 0 (shape-area (make-instance 'rect-shape :width 0 :height 5))))
(is-true (< (abs (- pi (shape-area (make-instance 'circle-shape :radius 1)))) 1d-9))
(is-true (< (abs (- (* 4 pi) (shape-area (make-instance 'circle-shape :radius 2)))) 1d-9))
```

## Exercise: The next method

The classes `animal-kind` and `dog-kind` are defined for you, and a dog is an
animal. Write the two methods of `animal-greeting`. For an animal it returns
`"I am NAME."`. For a dog it returns the animal's greeting followed by
`" Woof!"`, by calling the next method.

```stub
(defclass animal-kind ()
  ((name :initarg :name :reader animal-name)))

(defclass dog-kind (animal-kind) ())

(defgeneric animal-greeting (animal))

(defmethod animal-greeting ((a animal-kind))
  (not-written-yet 'animal-greeting))

(defmethod animal-greeting ((d dog-kind))
  (not-written-yet 'animal-greeting))
```

```hint
The animal method is one `format` call. The dog method joins
`(call-next-method)` and `" Woof!"` with `concatenate`.
```

```solution
(defclass animal-kind ()
  ((name :initarg :name :reader animal-name)))

(defclass dog-kind (animal-kind) ())

(defgeneric animal-greeting (animal))

(defmethod animal-greeting ((a animal-kind))
  (format nil "I am ~a." (animal-name a)))

(defmethod animal-greeting ((d dog-kind))
  (concatenate 'string (call-next-method) " Woof!"))
```

```check
(is (equal "I am Tom." (animal-greeting (make-instance 'animal-kind :name "Tom"))))
(is (equal "I am Rex. Woof!" (animal-greeting (make-instance 'dog-kind :name "Rex"))))
(is (equal "I am . Woof!" (animal-greeting (make-instance 'dog-kind :name ""))))
```

## Exercise: A check before

The class `bank-account` and the method that withdraws money are defined for
you. Write a `:before` method on `account-withdraw` that signals an error when
the amount is more than the balance, so the withdrawal never happens.

```stub
(defgeneric account-withdraw (account amount))

(defclass bank-account ()
  ((balance :initarg :balance :initform 0 :accessor account-balance)))

(defmethod account-withdraw ((a bank-account) amount)
  (decf (account-balance a) amount))

(defmethod account-withdraw :before ((a bank-account) amount)
  (not-written-yet 'account-withdraw))
```

```hint
Compare `amount` with `(account-balance a)`, and call `error` with a message
when it is too large. Do not change the balance in the `:before` method.
```

```solution
(defgeneric account-withdraw (account amount))

(defclass bank-account ()
  ((balance :initarg :balance :initform 0 :accessor account-balance)))

(defmethod account-withdraw ((a bank-account) amount)
  (decf (account-balance a) amount))

(defmethod account-withdraw :before ((a bank-account) amount)
  (when (> amount (account-balance a))
    (error "Cannot withdraw ~a from a balance of ~a." amount (account-balance a))))
```

```check
(is (equal 70 (let ((a (make-instance 'bank-account :balance 100))) (account-withdraw a 30) (account-balance a))))
(is (equal 0 (let ((a (make-instance 'bank-account :balance 100))) (account-withdraw a 100) (account-balance a))))
(signals error (account-withdraw (make-instance 'bank-account :balance 10) 50))
(is (equal 10 (let ((a (make-instance 'bank-account :balance 10))) (ignore-errors (account-withdraw a 50)) (account-balance a))))
```
