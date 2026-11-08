---
title: Fix it live
level: advanced
project: Inventory
reading: ANSI Common Lisp, sections 12.1–12.3 and chapter 14
---
The second project is a shop's **inventory**: items with a price and a
quantity, orders, and restocking. This time the code is written already, and
three of its functions have a bug each. Your work is to find each bug with
ZParen's tools, fix it in the file, and carry on without restarting.

Each exercise card says **To fix**. Check fails until the function is right.

```given
(defclass item ()
  ((name :initarg :name :reader item-name)
   (price :initarg :price :accessor item-price
          :documentation "The price of one, in cents.")
   (quantity :initarg :quantity :initform 0 :accessor item-quantity)))

(defun make-item (name price &optional (quantity 0))
  (make-instance 'item :name name :price price :quantity quantity))

(defclass inventory ()
  ((items :initarg :items :initform '() :accessor inventory-items)))

(defun make-inventory (&rest items)
  (make-instance 'inventory :items items))

(defun find-item (inventory name)
  "The item called NAME in INVENTORY, or NIL. Names ignore case."
  (find name (inventory-items inventory) :key #'item-name :test #'string-equal))

(defun apply-discount (price percent)
  "PRICE, in cents, less PERCENT percent, rounded to whole cents."
  (values (round (* price (- 100 percent)) 100)))

(defun sample-inventory ()
  "A new small inventory to try the exercises on."
  (make-inventory (make-item "widget" 250 40)
                  (make-item "gadget" 1200 5)
                  (make-item "sprocket" 75 300)))
```

### The debugger

Call the broken function yourself, in the REPL, with the sample inventory:

```lisp
(restock (sample-inventory) "flange" 12 90)
```

The debugger opens beside the REPL. It says what went wrong in plain words,
and the backtrace shows your frames first, with their arguments. Click a frame
to see its variables. The bug is usually in the innermost frame of yours.

Fix the function in the file and compile it with ⇧⌘↩. Then, in the debugger,
choose **Restart frame** on that function's frame. It runs again, with the
same arguments, on the new code. That is how Lisp programmers fix a running
program without starting it again.

### Trace

Some bugs give a wrong answer, not an error. Put the cursor on a function's
name and press ⌥⌘T (`,t` in Vim) to trace it. Each call then shows in the
Trace panel with its arguments and its result. Trace the functions a wrong
answer comes from, and look for the first call that returns something odd.

```lisp
(order-total (sample-inventory) '(("widget" . 12)))
```

### The inspector

Some bugs are about which objects are which. ⌘-click a result in the REPL to
inspect it. The inspector shows its slots, and you can click your way into
them. Two values that are `eq` are one object: change one and you change
both.

```lisp
(let* ((shop (sample-inventory))
       (copy (copy-inventory shop)))
  (list (first (inventory-items shop)) (first (inventory-items copy))))
```

## Exercise: Restock

`(restock inventory name amount &optional price)` adds `amount` to the
quantity of the item called `name`, and returns the item. When the inventory
has no such item, it makes one at `price` cents and adds it. It fails for a
new item. Find out why, and fix it.

```fix
(defun restock (inventory name amount &optional (price 0))
  "Adds AMOUNT of the item NAME to INVENTORY, as a new item at PRICE when it
has none. Returns the item."
  (let ((item (find-item inventory name)))
    (incf (item-quantity item) amount)
    item))
```

```hint
The debugger says a method got `NIL`. Where does that `NIL` come from? When
`find-item` finds nothing, make the item with `make-item`, `push` it onto
`(inventory-items inventory)`, and go on with it.
```

```solution
(defun restock (inventory name amount &optional (price 0))
  "Adds AMOUNT of the item NAME to INVENTORY, as a new item at PRICE when it
has none. Returns the item."
  (let ((item (find-item inventory name)))
    (unless item
      (setf item (make-item name price))
      (push item (inventory-items inventory)))
    (incf (item-quantity item) amount)
    item))
```

```check
(let ((inv (sample-inventory)))
  (is (equal 50 (item-quantity (restock inv "widget" 10))))
  (is (equal 50 (item-quantity (find-item inv "Widget"))))
  (let ((new (restock inv "flange" 12 90)))
    (is (equal "flange" (item-name new)))
    (is (equal 12 (item-quantity new)))
    (is (equal 90 (item-price new)))
    (is (eq new (find-item inv "flange"))))
  (is (equal 4 (length (inventory-items inv)))))
```

## Exercise: The order total

`(order-total inventory order)` returns the price in cents of an order: a
list of `(name . count)`. A line of 10 or more of one item is 10% off. Small
orders come out right, but large ones do not. Trace it, and fix it.

```fix
(defun order-total (inventory order)
  "The price in cents of ORDER, a list of (name . count). A line of 10 or
more of one item is 10% off."
  (loop for (name . count) in order
        for price = (* count (item-price (find-item inventory name)))
        sum (if (>= count 10)
                (apply-discount 10 price)
                price)))
```

```hint
Trace `apply-discount` and run the order of 12 widgets. Compare the call's
arguments with the order in its lambda list, `(price percent)`.
```

```solution
(defun order-total (inventory order)
  "The price in cents of ORDER, a list of (name . count). A line of 10 or
more of one item is 10% off."
  (loop for (name . count) in order
        for price = (* count (item-price (find-item inventory name)))
        sum (if (>= count 10)
                (apply-discount price 10)
                price)))
```

```check
(let ((inv (sample-inventory)))
  (is (equal 2400 (order-total inv '(("gadget" . 2)))))
  (is (equal 2700 (order-total inv '(("widget" . 12)))))
  (is (equal 3375 (order-total inv '(("widget" . 12) ("sprocket" . 9)))))
  (is (equal 0 (order-total inv '()))))
```

## Exercise: A copy that stays apart

`(copy-inventory inventory)` returns a new inventory, so that a what-if plan
can change the copy and leave the real stock alone. But changing an item in
the copy changes the original too. Inspect both, and fix it.

```fix
(defun copy-inventory (inventory)
  "A new inventory with copies of INVENTORY's items, so that changing one
leaves the other as it was."
  (let ((copy (make-inventory)))
    (setf (inventory-items copy) (copy-list (inventory-items inventory)))
    copy))
```

```hint
`copy-list` makes new conses, but they hold the same item objects. Make a new
item for each one, with `mapcar` and `make-item`.
```

```solution
(defun copy-inventory (inventory)
  "A new inventory with copies of INVENTORY's items, so that changing one
leaves the other as it was."
  (let ((copy (make-inventory)))
    (setf (inventory-items copy)
          (mapcar (lambda (item)
                    (make-item (item-name item) (item-price item) (item-quantity item)))
                  (inventory-items inventory)))
    copy))
```

```check
(let* ((inv (sample-inventory))
       (copy (copy-inventory inv)))
  (is (equal '("widget" "gadget" "sprocket") (mapcar #'item-name (inventory-items copy))))
  (is (equal '(40 5 300) (mapcar #'item-quantity (inventory-items copy))))
  (is (not (eq (find-item copy "widget") (find-item inv "widget"))))
  (setf (item-quantity (find-item copy "widget")) 0
        (item-price (find-item copy "gadget")) 999)
  (is (equal 40 (item-quantity (find-item inv "widget"))))
  (is (equal 1200 (item-price (find-item inv "gadget")))))
```
