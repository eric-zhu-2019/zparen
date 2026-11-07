;;;; What the debugger panel shows in plain words: a headline for the
;;;; condition, the restarts sorted by what they do, and whose code each frame
;;;; runs. Called in the thread that is in the debugger, as Swank's own
;;;; debugger requests are, so the condition and frames are the ones shown.

(in-package #:zparen)

(defun json (x) (zparen-plugin::json x))

(defun bool (x) (if x :true :false))

;;; Names

(defparameter *system-packages* '("COMMON-LISP" "KEYWORD"))

(defparameter *system-package-prefixes*
  '("SB-" "SWANK" "ASDF" "UIOP" "QUICKLISP" "QL-" "ZPAREN" "SLYNK"))

(defun system-package-p (package)
  (and package
       (let ((name (package-name package)))
         (or (member name *system-packages* :test #'string=)
             (some (lambda (p) (and (<= (length p) (length name)) (string= p name :end2 (length p))))
                   *system-package-prefixes*)))))

(defun shown-name (thing)
  "THING as Lisp would print it here, in lower case: a symbol without its
package when *PACKAGE* has it."
  (let ((*print-case* :downcase)) (prin1-to-string thing)))

(defun code (thing)
  "THING marked as code for the panel, which shows `...` in a code font."
  (format nil "`~a`" (if (stringp thing) thing (shown-name thing))))

(defun short (thing &optional (limit 60))
  (let ((text (let ((*print-case* :downcase) (*print-length* 8) (*print-level* 3))
                (prin1-to-string thing))))
    (if (> (length text) limit) (concatenate 'string (subseq text 0 (- limit 1)) "…") text)))

(defun function-symbol (name)
  "The symbol a debug function's NAME is for: GREET for GREET, (LAMBDA () :IN
GREET), (FLET HELPER :IN GREET) and (SETF GREET). Heads are compared by name,
since some are internal to SBCL."
  (let ((head (and (consp name) (symbolp (first name)) (symbol-name (first name)))))
    (cond ((symbolp name) name)
          ((not head) nil)
          ((member head '("LAMBDA" "TOP-LEVEL-FORM") :test #'string=)
           (let ((in (member :in name))) (and in (function-symbol (second in)))))
          ((member head '("FLET" "LABELS" "SETF" "FAST-METHOD" "SLOW-METHOD" "METHOD" "&OPTIONAL-PROCESSOR"
                          "&MORE-PROCESSOR" "XEP" "TL-XEP" "VARARGS-ENTRY" "HAIRY-ARG-PROCESSOR" "EXTERNAL")
                   :test #'string=)
           (function-symbol (second name)))
          (t nil))))

;;; Did you mean

(defun edit-distance (a b)
  (let* ((n (length b)) (row (make-array (1+ n))))
    (dotimes (j (1+ n)) (setf (aref row j) j))
    (loop for i from 1 to (length a)
          do (let ((diagonal (aref row 0)))
               (setf (aref row 0) i)
               (loop for j from 1 to n
                     do (let ((above (aref row j)))
                          (setf (aref row j)
                                (min (1+ above) (1+ (aref row (1- j)))
                                     (+ diagonal (if (char-equal (char a (1- i)) (char b (1- j))) 0 1))))
                          (setf diagonal above)))))
    (aref row n)))

(defun similar-symbols (symbol predicate &optional (limit 3))
  "Up to LIMIT symbols that satisfy PREDICATE and have SYMBOL's name, in another
package, or a name a typo or two away. The same name comes first."
  (let* ((name (symbol-name symbol))
         (most (if (<= (length name) 4) 1 2))
         (found '()))
    (do-all-symbols (s)
      (unless (or (eq s symbol) (member s found :key #'car))
        (let ((other (symbol-name s)))
          (when (and (<= (abs (- (length other) (length name))) most)
                     (or (not (system-package-p (symbol-package s)))
                         (eq (symbol-package s) (find-package "COMMON-LISP")))
                     (funcall predicate s))
            (let ((d (edit-distance name other)))
              (when (<= d most) (push (cons s d) found)))))))
    (loop for (s . nil) in (sort found #'< :key #'cdr)
          repeat limit
          collect (shown-name s))))

;;; The headline

(defun a-or-an (word)
  (if (find (char word 0) "aeiouAEIOU") "an" "a"))

(defun type-phrase (type)
  (let ((simple (if (consp type) (first type) type)))
    (case simple
      ((number real) "a number")
      ((integer fixnum unsigned-byte signed-byte bit) "an integer")
      (float "a float")
      (rational "a rational number")
      ((string simple-string base-string simple-base-string) "a string")
      (character "a character")
      ((list cons) "a list")
      ((sequence vector simple-vector array) (format nil "~a ~a" (a-or-an (string-downcase simple)) (string-downcase simple)))
      (symbol "a symbol")
      (keyword "a keyword")
      (function "a function")
      (hash-table "a hash table")
      (t (if (and (consp type) (eq (first type) 'or) (member 'null (rest type)))
             (format nil "~a or nil" (type-phrase (find 'null (rest type) :test-not #'eq)))
             (format nil "a value of type ~a" (code (short type))))))))

(defun value-phrase (value)
  (cond ((null value) "`nil`")
        ((stringp value) (format nil "the string ~a" (code (short value))))
        ((characterp value) (format nil "the character ~a" (code (short value))))
        ((integerp value) (format nil "the integer ~a" (code (short value))))
        ((numberp value) (format nil "the number ~a" (code (short value))))
        ((keywordp value) (format nil "the keyword ~a" (code (short value))))
        ((symbolp value) (format nil "the symbol ~a" (code (short value))))
        ((consp value) (format nil "the list ~a" (code (short value))))
        ((vectorp value) (format nil "the vector ~a" (code (short value))))
        (t (code (short value)))))

(defun first-line (text)
  (string-trim " " (subseq text 0 (or (position #\Newline text) (length text)))))

(defun message (condition)
  (string-trim '(#\Space #\Newline) (swank::safe-condition-message condition)))

(defun interrupt-p (condition)
  "Swank interrupts a thread with BREAK, as an interrupt from Emacs."
  (or (typep condition 'sb-sys:interactive-interrupt)
      (search "Interrupt from Emacs" (message condition))))

(defun argument-count-error-p (condition)
  (and (typep condition 'program-error)
       (search "invalid number of arguments" (message condition))))

(defun headline (condition frames)
  "A plist: :KIND, :TITLE and :DETAIL, with `code` marked, and :SUGGESTIONS
and :DEFINE for a name that is not defined."
  (let ((in (let ((f (find "yours" frames :key (lambda (f) (getf f :owner)) :test #'string=)))
              (and f (plusp (length (getf f :name))) (format nil " in ~a" (code (getf f :name)))))))
    (flet ((say (kind title &rest more) (list* :kind kind :title title more)))
      (typecase condition
        (breakpoint-hit
         (let ((f (first frames)))
           (say "breakpoint"
                (format nil "Stopped at the breakpoint~@[ in ~a~]~@[, line ~d~]"
                        (and f (plusp (length (getf f :name))) (code (getf f :name)))
                        (and f (getf f :line)))
                :detail (let ((form (first (simple-condition-format-arguments condition))))
                          (format nil "~@[Before ~a. ~]Continue (F9) goes on, or step a form at a time." (and form (code form)))))))
        (sb-ext:step-condition
         (say "step" (first-line (message condition))))
        (sb-sys:interactive-interrupt
         (say "interrupt" "Interrupted"
              :detail "Lisp stopped where it was. Continue goes on, and Abort stops it."))
        (undefined-function
         (let ((name (cell-error-name condition)))
           (if (and (symbolp name) (fboundp name))
               (say "error" (format nil "~a was not defined" (code name))
                    :detail (format nil "It is defined now. Call ~a again goes on." (code name)))
               (say "error" (format nil "~a is not defined as a function" (code name))
                    :detail "Define it, or call another function."
                    :suggestions (and (symbolp name) (similar-symbols name #'fboundp))
                    :define (and (symbolp name) (shown-name name))))))
        (unbound-variable
         (let ((name (cell-error-name condition)))
           (say "error" (format nil "~a has no value" (code name))
                :detail (if (boundp name)
                            (format nil "It has a value now. Try ~a again goes on." (code name))
                            "Check its spelling. A global variable needs defvar or defparameter.")
                :suggestions (similar-symbols name #'boundp))))
        (unbound-slot
         (say "error" (format nil "The slot ~a of ~a has no value"
                              (code (cell-error-name condition)) (code (short (unbound-slot-instance condition))))))
        (sb-int:invalid-array-index-error
         (let ((bound (ignore-errors (first (third (type-error-expected-type condition))))))
           (say "error" (format nil "Index ~a is out of range~@[: there are ~d elements~]"
                                (code (type-error-datum condition)) bound)
                :detail (format nil "The first element is index 0.~@[ The error is~a.~]" in))))
        (type-error
         (say "error" (format nil "Expected ~a, but got ~a"
                              (type-phrase (type-error-expected-type condition))
                              (value-phrase (type-error-datum condition)))
              :detail (and in (format nil "The error is~a." in))))
        (division-by-zero
         (let ((op (ignore-errors (arithmetic-error-operation condition)))
               (args (ignore-errors (arithmetic-error-operands condition))))
           (say "error" "Division by zero"
                :detail (if op (format nil "~a~@[~a~]" (code (short (cons op args))) in) (and in (format nil "The error is~a." in))))))
        (sb-kernel::control-stack-exhausted
         (say "error" "The stack ran out"
              :detail "This usually means a function calls itself without end. Look for the repeated frames below."))
        (sb-kernel::heap-exhausted-error
         (say "error" "Lisp ran out of memory"))
        (file-error
         (let ((path (ignore-errors (file-error-pathname condition))))
           (if (and path (not (ignore-errors (probe-file path))))
               (say "error" (format nil "There is no file ~a" (code (namestring path))))
               (say "error" (first-line (message condition))))))
        (t
         (cond ((interrupt-p condition)
                (say "interrupt" "Interrupted"
                     :detail "Lisp stopped where it was. Continue goes on, and Abort stops it."))
               ((argument-count-error-p condition)
                (let* ((f (first frames))
                       (name (and f (getf f :symbol)))
                       (args (and name (fboundp name) (ignore-errors (sb-introspect:function-lambda-list name)))))
                  (say "error" (format nil "~a got the wrong number of arguments" (if name (code name) "A function"))
                       :detail (format nil "~@[It takes ~a. ~]~a" (and name (code (shown-name (or args '())))) (first-line (message condition))))))
               ((typep condition 'warning)
                (say "warning" (first-line (message condition))))
               ((typep condition 'error)
                (say "error" (first-line (message condition))))
               (t (say "signal" (first-line (message condition))))))))))

;;; Restarts

(defun restart-role (restart quit)
  (let ((name (restart-name restart))
        (report (princ-to-string restart)))
    (cond ((eq restart quit) "abort")
          ((or (search "SLIME" report) (search "sldb level" report) (search "abort thread" report))
           (if (and name (string= (symbol-name name) "RETRY")) "retry" "internal"))
          ((member name '(use-value store-value)) "value")
          ((and name (string= (symbol-name name) "RETURN-VALUE")) "value")
          ((and name (string= (symbol-name name) "RETURN-NOTHING")) "internal")
          ((eq name 'continue) "continue")
          (t "other"))))

(defun restart-words (restart role condition)
  "The label and, for a restart that takes a value, the prompt."
  (let ((name (restart-name restart))
        (report (princ-to-string restart))
        (cell (and (typep condition 'cell-error) (cell-error-name condition))))
    (flet ((says (label &optional prompt) (values label prompt)))
      (cond ((string= role "abort")
             (says (if (> swank::*sldb-level* 1) "Back to the earlier error" "Abort")))
            ((string= role "retry")
             (says (if (search "REPL" report) "Run the input again" "Evaluate again")))
            ((or (typep condition 'breakpoint-hit) (and (eq name 'continue) (interrupt-p condition))) (says "Continue"))
            ((and (typep condition 'undefined-function) (eq name 'continue))
             (says (format nil "Call ~a again" (code cell))))
            ((and (typep condition 'undefined-function) (eq name 'use-value))
             (says "Call another function…" (format nil "A function to call instead of ~a" (code cell))))
            ((and (typep condition 'undefined-function) (string= role "value"))
             (says "Return a value instead…" (format nil "A value to return instead of calling ~a" (code cell))))
            ((and (typep condition 'unbound-variable) (eq name 'continue))
             (says (format nil "Try ~a again" (code cell))))
            ((and (typep condition 'unbound-variable) (eq name 'use-value))
             (says "Use a value instead…" (format nil "A value to use for ~a this time" (code cell))))
            ((and (typep condition 'unbound-variable) (eq name 'store-value))
             (says (format nil "Set ~a and go on…" (code cell)) (format nil "A value to give ~a" (code cell))))
            ((string= role "value")
             (says (format nil "~a…" (string-right-trim "." report)) "A value"))
            (t (says (string-right-trim "." report)))))))

(defun restarts-json (condition)
  "Restarts after the first ABORT belong to the earlier debugger levels, so they
are internal: one of them leaves this level and that earlier error too."
  (let* ((quit (find 'abort swank::*sldb-restarts* :key #'restart-name))
         (after (position quit swank::*sldb-restarts*)))
    (loop for r in swank::*sldb-restarts*
          for i from 0
          collect (let ((role (if (and after (> i after)) "internal" (restart-role r quit))))
                    (multiple-value-bind (label prompt) (restart-words r role condition)
                      (list :obj :index i :role role :label label :prompt (or prompt :null)))))))

;;; Frames

(defun under-p (root path)
  (and root path (<= (length root) (length path)) (string= root path :end2 (length root))))

(defun real-directory (root)
  (let ((dir (ignore-errors (truename (uiop:ensure-directory-pathname root)))))
    (and dir (namestring dir))))

(defun frame-source-file (frame)
  (ignore-errors
   (let* ((loc (sb-di:frame-code-location frame))
          (source (sb-di:code-location-debug-source loc)))
     (sb-di:debug-source-namestring source))))

(defun frame-owner (frame symbol roots)
  "\"yours\" for code from the project, or defined in the REPL in a package of
your own, \"library\" for code from another file, \"system\" for SBCL's, Swank's
and the code that evaluates input."
  (let ((file (frame-source-file frame)))
    (cond ((and file (some (lambda (root)
                             (or (under-p root file)
                                 (let ((real (ignore-errors (namestring (truename file)))))
                                   (under-p root real))))
                           roots))
           "yours")
          ((and file (not (or (string= "SYS:" file :end2 (min 4 (length file)))
                              (search "/swank/" file)
                              (system-package-p (and symbol (symbol-package symbol))))))
           "library")
          ((and (not file) symbol (symbol-package symbol) (not (system-package-p (symbol-package symbol))))
           "yours")
          (t "system"))))

(defun frame-arguments (debug-fun)
  (ignore-errors
   (loop for arg in (sb-di:debug-fun-lambda-list debug-fun)
         for var = (cond ((typep arg 'sb-di:debug-var) arg)
                         ((and (consp arg) (typep (car (last arg)) 'sb-di:debug-var)) (car (last arg))))
         when var collect (string-downcase (symbol-name (sb-di:debug-var-symbol var))))))

(defun stale-p (debug-fun symbol)
  "Whether SYMBOL's function was defined again after this frame started."
  (ignore-errors
   (and symbol (fboundp symbol) (not (macro-function symbol)) (not (special-operator-p symbol))
        (not (sb-int:encapsulated-p symbol 'trace))
        (let ((running (sb-di:debug-fun-fun debug-fun))
              (current (fdefinition symbol)))
          (when (sb-kernel:closurep current) (setf current (sb-kernel:%closure-fun current)))
          (and running (functionp current) (not (typep current 'generic-function))
               (not (eq (sb-kernel:fun-code-header running) (sb-kernel:fun-code-header current))))))))

(defvar *file-texts* nil)

(defun line-at (file position)
  "The 1-based line of 1-based character POSITION in FILE."
  (let ((text (or (cdr (assoc file *file-texts* :test #'string=))
                  (let ((read (ignore-errors (uiop:read-file-string file))))
                    (push (cons file read) *file-texts*)
                    read))))
    (and text (1+ (count #\Newline text :end (min (length text) (max 0 (1- position))))))))

(defun frame-line (index)
  (ignore-errors
   (let* ((location (swank/backend:frame-source-location index))
          (where (and (eq (first location) :location) (second location)))
          (file (case (first where) (:file (second where)) (:buffer-and-file (third where))))
          (spot (and (eq (first location) :location) (third location)))
          (position (case (first spot)
                      (:position (second spot))
                      (:offset (+ (second spot) (third spot))))))
     (and file position (values (line-at file position) file)))))

(defparameter *frame-limit* 200)

(defun frames-json-plists (roots)
  (let ((*file-texts* '())
        (lines 0))
    (loop for frame in (swank/backend:compute-backtrace 0 *frame-limit*)
          for index from 0
          collect (let* ((debug-fun (ignore-errors (sb-di:frame-debug-fun frame)))
                         (name (and debug-fun (ignore-errors (sb-di:debug-fun-name debug-fun))))
                         (symbol (function-symbol name))
                         (owner (frame-owner frame symbol roots))
                         (yours (string= owner "yours")))
                    (multiple-value-bind (line file)
                        (and yours (< lines 20) (progn (incf lines) (frame-line index)))
                      (list :index index
                            ;; In the function's own package, so (add-one 5) shows without its prefix.
                            :call (let ((*print-case* :downcase)
                                        (*package* (or (and (not (string= owner "system")) symbol (symbol-package symbol)) *package*)))
                                    (swank::frame-to-string frame))
                            :owner owner
                            :symbol symbol
                            :name (if symbol (string-downcase (symbol-name symbol)) "")
                            :restartable (ignore-errors (swank/backend:frame-restartable-p frame))
                            :stale (and yours debug-fun (stale-p debug-fun symbol))
                            :file (or file (and yours (frame-source-file frame)))
                            :line line
                            :args (and yours debug-fun (frame-arguments debug-fun))))))))

(defun frame-json (f)
  (list :obj
        :index (getf f :index)
        :call (getf f :call)
        :owner (getf f :owner)
        :name (getf f :name)
        :restartable (bool (getf f :restartable))
        :stale (bool (getf f :stale))
        :file (or (getf f :file) :null)
        :line (or (getf f :line) :null)
        :args (getf f :args)))

(defun in-debugger-p ()
  (and (plusp swank::*sldb-level*) (boundp 'swank/sbcl::*sldb-stack-top*) swank::*swank-debugger-condition*))

(defun debugger-summary (root)
  "The open debugger in plain words, as JSON: the headline, the restarts, and
the first frames with whose code each runs. ROOT is the project's folder. JSON
null when the thread is no longer in the debugger, which happens when the
panel asks just as the debugger closes. It never signals, so it never opens a
debugger of its own."
  (handler-case
      (if (not (in-debugger-p))
          "null"
          (let* ((condition swank::*swank-debugger-condition*)
                 (roots (remove nil (list (and root (namestring (uiop:ensure-directory-pathname root)))
                                          (and root (real-directory root)))))
                 (frames (frames-json-plists roots))
                 (head (headline condition frames)))
            (json (list :obj
                        :level swank::*sldb-level*
                        :kind (getf head :kind)
                        :title (getf head :title)
                        :detail (or (getf head :detail) :null)
                        :suggestions (getf head :suggestions)
                        :define (or (getf head :define) :null)
                        :restarts (restarts-json condition)
                        :frames (mapcar #'frame-json frames)))))
    (serious-condition () "null")))

;;; Acting on the debugger without opening another one

(defun read-in (string package)
  (let ((*package* (or (and package (find-package (string-upcase package))) *package*)))
    (read-from-string string)))

(defun invoke-restart-with-value (level index string package)
  "Invokes restart INDEX of debugger LEVEL with the value of STRING, a form. For
a restart that calls another function, a bare name is that function. An error
in the form is returned as text, and the debugger stays as it was."
  (when (and (in-debugger-p) (= level swank::*sldb-level*))
    (let* ((restart (nth index swank::*sldb-restarts*))
           (condition swank::*swank-debugger-condition*)
           (value (handler-case
                      (let ((form (read-in string package)))
                        (if (and (symbolp form) form (typep condition 'undefined-function) (eq (restart-name restart) 'use-value))
                            form
                            (eval form)))
                    (error (c) (return-from invoke-restart-with-value
                                 (format nil "Error: ~a" (first-line (message c))))))))
      (invoke-restart restart value))))

(defun eval-in-frame-quietly (string index package)
  "Swank's eval in a frame, but an error is returned as text rather than
opening another debugger level."
  (handler-case (if (in-debugger-p)
                    (swank:eval-string-in-frame string index package)
                    "The debugger has closed")
    (unbound-variable (c)
      (format nil "~a is not a variable in this frame" (code (cell-error-name c))))
    (error (c)
      (format nil "Error: ~a" (first-line (message c))))))
