---
title: CLOS in practice
level: advanced
project: Inventory
reading: ANSI Common Lisp, chapter 11
---
The inventory works. Now it grows: food that must sell soon, items that print
in a readable way, and a record of each change to the stock. Each of these is
a method added to the classes you have, without changing their code. That is
the point of CLOS: generic functions are open, and anyone can add a method.

```given
(defclass perishable-item (item)
  ((days-left :initarg :days-left :accessor days-left
              :documentation "Days left to sell the item.")))

(defun make-perishable (name price quantity days-left)
  (make-instance 'perishable-item :name name :price price
                                  :quantity quantity :days-left days-left))

(defun cents-string (cents)
  "CENTS as dollars and cents: \"$2.50\" for 250."
  (multiple-value-bind (dollars rest) (floor cents 100)
    (format nil "$~d.~2,'0d" dollars rest)))

(defvar *quantity-history* (make-hash-table :test 'eq)
  "Each item's quantities, newest first, as each change records them.")
```

### Subclasses and the next method

A `perishable-item` is an `item` with a slot more. Every method for `item`
works on it too. A method for the subclass can do its own part and then call
`call-next-method` to run the method for `item`, as in lesson 15.

### How objects print

The REPL prints an item as `#<ITEM {10052A3F43}>`, which tells you little.
`print-object` is the generic function behind every printed value. A method
for your class changes how its objects print everywhere: the REPL, the
debugger, the inspector, and trace. `print-unreadable-object` writes the
`#<` and `>` around your text, and the class name when you ask for it:

```lisp
(defclass demo-box () ((size :initarg :size :reader demo-box-size)))

(defmethod print-object ((box demo-box) stream)
  (print-unreadable-object (box stream :type t)
    (format stream "size ~a" (demo-box-size box))))

(make-instance 'demo-box :size 3)
```

### Methods before and after

A method can be **primary**, the default, or **auxiliary**: `:before`,
`:after` or `:around`. An `:after` method runs after the primary method, and
its result is ignored. That makes it right for a record or a check that must
not change what the call returns.

An accessor such as `item-quantity` is a generic function. So is its setter,
`(setf item-quantity)`, which takes the new value first and the object second.
`incf` and `decf` on an accessor call that setter too.

## Exercise: Today's price

Define the generic function `shelf-price`, which returns the price in cents
to sell one of an item for today. For an `item`, that is its price. A
`perishable-item` with 1 day left or fewer is half price, rounded down. Add
the method for `perishable-item` below the one for `item`.

```stub
(defgeneric shelf-price (item)
  (:documentation "The price in cents to sell one of ITEM for today."))

(defmethod shelf-price ((item item))
  (not-written-yet 'shelf-price))
```

```hint
The method for `item` returns `(item-price item)`. The method for
`perishable-item` gets that price with `(call-next-method)` and halves it
with `floor` when `(days-left item)` is 1 or less.
```

```solution
(defgeneric shelf-price (item)
  (:documentation "The price in cents to sell one of ITEM for today."))

(defmethod shelf-price ((item item))
  (item-price item))

(defmethod shelf-price ((item perishable-item))
  (let ((price (call-next-method)))
    (if (<= (days-left item) 1)
        (values (floor price 2))
        price)))
```

```check
(is (equal 250 (shelf-price (make-item "widget" 250 4))))
(is (equal 300 (shelf-price (make-perishable "milk" 300 10 5))))
(is (equal 150 (shelf-price (make-perishable "milk" 300 10 1))))
(is (equal 62 (shelf-price (make-perishable "bread" 125 3 0))))
```

## Exercise: An item that prints its label

Define `(item-label item)`. It returns the item's name, its quantity, and its
price for today, as in `"widget, 3 at $2.50"`. Use `shelf-price`, and
`cents-string` from the provided code. Then change the `print-object` method
below, so an item prints as `#<ITEM widget, 3 at $2.50>`.

```stub
(defun item-label (item)
  (not-written-yet 'item-label))

(defmethod print-object ((item item) stream)
  ;; Change this method too: print the label inside #<ITEM ...>.
  (call-next-method))
```

```hint
`(format nil "~a, ~d at ~a" ...)` makes the label. In `print-object`, call
`print-unreadable-object` with `:type t`, and write the label inside it with
`write-string`.
```

```solution
(defun item-label (item)
  (format nil "~a, ~d at ~a" (item-name item) (item-quantity item)
          (cents-string (shelf-price item))))

(defmethod print-object ((item item) stream)
  (print-unreadable-object (item stream :type t)
    (write-string (item-label item) stream)))
```

```check
(let ((*package* (symbol-package 'item-label))
      (widget (make-item "widget" 250 3))
      (milk (make-perishable "milk" 300 10 1)))
  (is (equal "widget, 3 at $2.50" (item-label widget)))
  (is (equal "milk, 10 at $1.50" (item-label milk)))
  (is (equal "#<ITEM widget, 3 at $2.50>" (prin1-to-string widget)))
  (is (equal "#<PERISHABLE-ITEM milk, 10 at $1.50>" (prin1-to-string milk))))
```

## Exercise: A record of each change

Define `(quantity-history item)`. It returns the quantities the item has had
since it was made, oldest first. To record them, write an `:after` method on
`(setf item-quantity)` that pushes each new quantity onto the item's entry in
`*quantity-history*`.

```stub
(defun quantity-history (item)
  (not-written-yet 'quantity-history))

;; Write the :after method on (setf item-quantity) here.
```

```hint
The method's lambda list is `(quantity (item item))`: the new value first.
Its body is `(push quantity (gethash item *quantity-history*))`.
`quantity-history` returns that list reversed.
```

```solution
(defun quantity-history (item)
  (reverse (gethash item *quantity-history*)))

(defmethod (setf item-quantity) :after (quantity (item item))
  (push quantity (gethash item *quantity-history*)))
```

```check
(let ((nut (make-item "nut" 5 100)))
  (is (equal '() (quantity-history nut)))
  (setf (item-quantity nut) 80)
  (decf (item-quantity nut) 30)
  (is (equal '(80 50) (quantity-history nut))))
(let ((bolt (make-perishable "bolt" 10 7 3)))
  (incf (item-quantity bolt) 3)
  (is (equal '(10) (quantity-history bolt))))
```
