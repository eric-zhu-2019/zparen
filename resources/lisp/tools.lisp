;;;; Tracing, profiling and disassembly, reported as data for the IDE's panels.

(in-package #:zparen)

(defun spec-name (spec)
  "SPEC printed so that reading it back in any package finds it again."
  (let ((*package* (find-package :keyword)))
    (prin1-to-string spec)))

(defun trace-report (&optional (limit 1000))
  "Traced specs and the latest LIMIT recorded calls as
(SPECS TOTAL ((ID PARENT SPEC ARGS VALUES DONE) ...))."
  (let* ((traces swank-trace-dialog::*traces*)
         (total (length traces))
         (start (max 0 (- total limit))))
    (list (mapcar #'spec-name (swank-trace-dialog:report-specs))
          total
          (loop for i from start below total
                for e = (aref traces i)
                for parent = (swank-trace-dialog::parent-of e)
                for done = (swank-trace-dialog::completed-p e)
                collect (list i
                              (and parent (swank-trace-dialog::id-of parent))
                              (spec-name (swank-trace-dialog::spec-of e))
                              (mapcar #'swank::to-line (swank-trace-dialog::args-of e))
                              (if done
                                  (mapcar #'swank::to-line
                                          (swank::ensure-list (swank-trace-dialog::retlist-of e)))
                                  '())
                              (and done t))))))

(defun toggle-trace (name)
  (swank-trace-dialog:dialog-toggle-trace (swank::from-string name)))

;;; A profile counts every frame on the sampled stacks, so the frames that
;;; were already running when profiling began (Swank's request loop, EVAL)
;;; would each show at 100%. They are left out, as is the IDE's own code.

(defparameter *hidden-packages* '("SWANK" "SWANK/BACKEND" "SWANK/SBCL" "SWANK-REPL" "SWANK/RPC" "ZPAREN"))

(defvar *outside-frames* '()
  "Names of the frames on the profiling thread's stack when profiling began.")

(defun frame-name (name)
  "NAME without the compiler's entry-point wrappers, as swank-sprof shows it.
Wrapper symbols are compared by name, since they vary between SBCL releases."
  (if (and (consp name) (symbolp (first name))
           (member (symbol-name (first name)) '("XEP" "TL-XEP" "&MORE-PROCESSOR" "TOP-LEVEL-FORM" "&OPTIONAL-PROCESSOR")
                   :test #'string=))
      (second name)
      name))

(defun hidden-node-p (node)
  (let* ((name (frame-name (sb-sprof::node-name node)))
         (sym (if (consp name) (find-if #'symbolp (rest name)) name)))
    (or (member name *outside-frames* :test #'equal)
        (and sym (symbolp sym) (symbol-package sym)
             (member (package-name (symbol-package sym)) *hidden-packages* :test #'string=)))))

(defun node-label (node)
  (let ((*package* (find-package :cl-user))
        (*print-right-margin* most-positive-fixnum))
    (prin1-to-string (frame-name (sb-sprof::node-name node)))))

(defun call-counts (node)
  "NODE's callees with the samples in which each was called from it."
  (loop for e in (sb-sprof::vertex-edges node)
        for v = (sb-sprof::edge-vertex e)
        when (and (typep v 'sb-sprof::node) (not (hidden-node-p v)))
          collect (list (node-label v) (sb-sprof::call-count e))))

(defun profile-report (&optional (limit 200))
  "The last profile as (:SAMPLES N :ROWS ((:NAME :SELF :TOTAL :CALLERS :CALLEES) ...)),
counting samples."
  (let ((graph (sb-sprof:report :type nil)))
    (if (null graph)
        (list :samples 0 :rows '())
        (let ((samples (sb-sprof::call-graph-nsamples graph))
              (nodes (sort (remove-if #'hidden-node-p (copy-list (sb-sprof::call-graph-flat-nodes graph)))
                           #'> :key #'sb-sprof::node-accrued-count)))
          (flet ((by-count (list) (sort list #'> :key #'second)))
            (list :samples samples
                  :rows (loop for n in nodes
                              for label = (node-label n)
                              repeat limit
                              collect (list :name label
                                            :self (sb-sprof::node-count n)
                                            ;; A recursive function is on a stack more than once.
                                            :total (min samples (sb-sprof::node-accrued-count n))
                                            :callers (by-count
                                                      (loop for c in (sb-sprof::node-callers n)
                                                            when (and (typep c 'sb-sprof::node) (not (hidden-node-p c)))
                                                              collect (list (node-label c)
                                                                            (or (second (assoc label (call-counts c) :test #'string=)) 0))))
                                            :callees (by-count (call-counts n))))))))))

(defun outside-frames ()
  (let ((names '()))
    (sb-debug:map-backtrace
     (lambda (frame) (push (frame-name (sb-di:debug-fun-name (sb-di:frame-debug-fun frame))) names)))
    names))

(defun start-profiling (&key (mode :cpu) (threads :all))
  (sb-sprof:reset)
  (setf *outside-frames* (outside-frames))
  (sb-sprof:start-profiling :mode mode :sample-interval 0.001 :max-samples 200000 :threads threads)
  t)

(defun stop-profiling ()
  (sb-sprof:stop-profiling)
  (profile-report))

(defun profile-form (string &optional (mode :cpu))
  "Runs the form in STRING under the statistical profiler, sampling this thread.
The form is compiled first, so the profile shows running it, not compiling it;
its function is named in this package, which profiles leave out."
  (let* ((form (swank::from-string string))
         (fun (compile nil `(sb-int:named-lambda profiled-form () ,form)))
         (start (get-internal-real-time))
         values)
    (start-profiling :mode mode :threads (list sb-thread:*current-thread*))
    (unwind-protect (setf values (multiple-value-list (funcall fun)))
      (sb-sprof:stop-profiling))
    (append (list :value (format nil "~{~s~^, ~}" values)
                  :seconds (/ (- (get-internal-real-time) start) (float internal-time-units-per-second)))
            (profile-report))))

(defun disassemble-name (string)
  "Disassembly of the function named in STRING, under any trace wrapping it."
  (let* ((name (swank::from-string string))
         (fun (cond ((and (symbolp name) (macro-function name)) (macro-function name))
                    ((fboundp name) (fdefinition name))
                    (t (error "~s is not a function." name)))))
    (loop for info = (sb-impl::encapsulation-info fun) while info
          do (setf fun (sb-impl::encapsulation-info-definition info)))
    (with-output-to-string (*standard-output*)
      (disassemble fun))))

(defun abort-requests (ids)
  "Unwinds the threads still answering the Swank requests IDS."
  (dolist (thread (sb-thread:list-all-threads))
    (when (and (not (eq thread sb-thread:*current-thread*))
               (intersection ids (sb-thread:symbol-value-in-thread 'swank::*pending-continuations* thread nil)))
      (ignore-errors (sb-thread:interrupt-thread thread (lambda () (abort)))))))

;;; Checking a rename. The editor renames a local variable or function in the
;;; text; here both versions are fully macroexpanded, so every binding left is
;;; a special form or a lambda list, and compared up to a consistent change of
;;; bound names. A macro that quotes or captures the name shows up as a difference.

(defun rename-check (before after)
  "\"same\" when the forms in BEFORE and AFTER expand to the same code, up to the
names of the locals they bind; \"different\" when they do not; \"unchecked: why\"
when they cannot be read or expanded."
  (handler-case
      (handler-bind ((warning #'muffle-warning))
        ;; Read in the editor's package, as Swank's own commands do.
        (swank::with-buffer-syntax ()
          (let* ((*read-eval* nil)
                 (old (expand-fully (read-from-string before)))
                 (new (expand-fully (read-from-string after))))
            (if (same-code-p old new) "same" "different"))))
    (error (e) (format nil "unchecked: ~a" e))))

(defun expand-fully (form)
  ;; SBCL's macroexpand-all leaves a DEFUN or DEFMACRO it is given whole, so the outer macro goes first.
  (sb-cltl2:macroexpand-all (macroexpand form)))

(defun same-code-p (old new)
  (let ((gensyms (make-hash-table)) (back (make-hash-table)))
    (labels ((bound (a b env)
               ;; A bound name matches only its partner in the innermost binding of either.
               (let ((by-old (assoc a env)) (by-new (rassoc b env)))
                 (cond ((or by-old by-new) (and by-old (eq by-old by-new)))
                       ((or (symbol-package a) (symbol-package b)) (eq a b))
                       (t (let ((x (gethash a gensyms)) (y (gethash b back)))
                            (cond ((or x y) (and (eq x b) (eq y a)))
                                  (t (setf (gethash a gensyms) b (gethash b back) a) t)))))))
             (data (a b)
               (cond ((and (symbolp a) (symbolp b)) (bound a b nil))
                     ((and (consp a) (consp b)) (and (data (car a) (car b)) (data (cdr a) (cdr b))))
                     (t (equal a b))))
             (code (a b vars fns)
               (cond ((and (symbolp a) (symbolp b)) (bound a b vars))
                     ((and (consp a) (consp b)) (compound a b vars fns))
                     (t (equal a b))))
             (all (as bs vars fns)
               (loop (cond ((and (consp as) (consp bs))
                            (unless (code (pop as) (pop bs) vars fns) (return nil)))
                           (t (return (code as bs vars fns))))))
             (fname (a b fns)
               (if (and (symbolp a) (symbolp b)) (bound a b fns) (data a b)))
             (lambda-list (as bs body-a body-b vars fns)
               ;; Defaults see the parameters before them, so they extend VARS one by one.
               (loop
                 (cond ((and (null as) (null bs)) (return (all body-a body-b vars fns)))
                       ((or (atom as) (atom bs))
                        (return (and (symbolp as) (symbolp bs)
                                     (all body-a body-b (acons as bs vars) fns))))
                       (t (let ((a (pop as)) (b (pop bs)))
                            (cond ((and (symbolp a) (member a lambda-list-keywords)) (unless (eq a b) (return nil)))
                                  ((and (symbolp a) (symbolp b)) (setf vars (acons a b vars)))
                                  ((and (consp a) (consp b) (= (length a) (length b)))
                                   (destructuring-bind (va &optional ia sa) a
                                     (destructuring-bind (vb &optional ib sb) b
                                       (unless (code ia ib vars fns) (return nil))
                                       (cond ((and (consp va) (consp vb))
                                              (unless (data (first va) (first vb)) (return nil))
                                              (setf vars (acons (second va) (second vb) vars)))
                                             (t (setf vars (acons va vb vars))))
                                       (when sa (setf vars (acons sa sb vars))))))
                                  (t (return nil))))))))
             (bindings (as bs vars fns sequential)
               ;; LET's values see only the outer names; LET*'s see the ones before them.
               ;; Returns whether the values match, and the names the body sees.
               (let ((inner vars))
                 (loop for a in as for b in bs
                       for va = (if (consp a) (first a) a) and vb = (if (consp b) (first b) b)
                       unless (code (if (consp a) (second a)) (if (consp b) (second b)) (if sequential inner vars) fns)
                         do (return-from bindings (values nil nil))
                       do (setf inner (acons va vb inner)))
                 (values t inner)))
             (compound (a b vars fns)
               (let ((op (car a)))
                 (case (and (eq op (car b)) op)
                   (quote (data a b))
                   (function
                    (let ((x (second a)) (y (second b)))
                      (if (and (consp x) (consp y) (member (car x) '(lambda sb-int:named-lambda)) (eq (car x) (car y)))
                          (compound x y vars fns)
                          (fname x y fns))))
                   (lambda (and (= (length a) (length b)) (lambda-list (second a) (second b) (cddr a) (cddr b) vars fns)))
                   (sb-int:named-lambda
                    (and (data (second a) (second b)) (lambda-list (third a) (third b) (cdddr a) (cdddr b) vars fns)))
                   ((let let* symbol-macrolet)
                    (and (= (length (second a)) (length (second b)))
                         (multiple-value-bind (ok inner) (bindings (second a) (second b) vars fns (not (eq op 'let)))
                           (and ok (all (cddr a) (cddr b) inner fns)))))
                   ((flet labels macrolet)
                    (let* ((da (second a)) (db (second b))
                           (inner (loop with e = fns for x in da for y in db do (setf e (acons (first x) (first y) e)) finally (return e))))
                      (and (= (length da) (length db))
                           (loop for x in da for y in db
                                 always (lambda-list (second x) (second y) (cddr x) (cddr y) vars (if (eq op 'labels) inner fns)))
                           (all (cddr a) (cddr b) vars inner))))
                   (t (and (if (and (symbolp (car a)) (symbolp (car b)))
                               (fname (car a) (car b) fns)
                               (code (car a) (car b) vars fns))
                           (all (cdr a) (cdr b) vars fns)))))))
      (code old new nil nil))))

;;; Renaming a global symbol. The editor finds every token in the project that
;;; could name it; here each one is read the way the reader would, without
;;; interning anything, to say whether it is that symbol.

(defun token-symbol (token)
  "The symbol TOKEN reads as in *PACKAGE*, without interning one, or NIL and
why not: :ESCAPED, :NO-PACKAGE or :NOT-FOUND."
  (when (find-if (lambda (c) (find c "|\\")) token)
    (return-from token-symbol (values nil :escaped)))
  (let* ((first (position #\: token))
         (last (position #\: token :from-end t))
         (package (cond ((null first) *package*)
                        ((zerop first) (find-package "KEYWORD"))
                        (t (find-package (string-upcase (subseq token 0 first))))))
         (name (string-upcase (if last (subseq token (1+ last)) token))))
    (if (null package)
        (values nil :no-package)
        (multiple-value-bind (symbol status) (find-symbol name package)
          (if status (values symbol nil) (values nil :not-found))))))

(defun rename-target (token)
  "\"PACKAGE<newline>NAME\" for the symbol TOKEN names in the editor's package,
or \"error: why\" when it cannot be renamed."
  (swank::with-buffer-syntax ()
    (multiple-value-bind (symbol why) (token-symbol token)
      (let ((home (and symbol (symbol-package symbol))))
        (cond ((eq why :no-package) (format nil "error: The package in ~a does not exist in Lisp. Load the code first." token))
              (why (format nil "error: Lisp does not know ~a yet. Load the code that defines it first." token))
              ((null home) (format nil "error: ~a belongs to no package." token))
              ((eq home (find-package "KEYWORD")) (format nil "error: ~a is a keyword. Keywords mean the same everywhere, so ZParen does not rename them." token))
              ((sb-ext:package-locked-p home)
               (format nil "error: ~a belongs to ~a, which is locked." token (package-name home)))
              (t (format nil "~a~%~a" (package-name home) (symbol-name symbol))))))))

(defun rename-matches (home name lines)
  "One character per line of LINES, each \"package<tab>designator<tab>token\":
y when the token reads as HOME::NAME in that package, n when it does not, and ?
when Lisp cannot tell. A designator, such as #:foo in DEFPACKAGE, is looked up
by name in its package."
  (multiple-value-bind (target found) (find-symbol name home)
    (with-output-to-string (out)
      (dolist (line (uiop:split-string lines :separator '(#\Newline)))
        (when (plusp (length line))
          (destructuring-bind (context designator token) (uiop:split-string line :separator '(#\Tab))
            (let* ((context (find-package context))
                   (*package* (or context *package*)))
              (write-char
               ;; A qualified token names its package, so it reads the same in any file.
               (cond ((or (not found) (and (null context) (or (string= designator "1") (not (find #\: token))))) #\?)
                     ((string= designator "1")
                      (let ((name (string-upcase (string-left-trim "#:" token))))
                        (multiple-value-bind (symbol status) (find-symbol name)
                          (if (and status (eq symbol target)) #\y #\n))))
                     (t (multiple-value-bind (symbol why) (token-symbol token)
                          (cond ((member why '(:escaped :no-package)) #\?)
                                ((and (not why) (eq symbol target)) #\y)
                                (t #\n)))))
               out))))))))

(defun rename-conflict (home name new)
  "Why HOME::NAME cannot become NEW, or an empty string when it can."
  (let* ((package (find-package home))
         (new-name (string-upcase new)))
    (multiple-value-bind (symbol status) (find-symbol new-name package)
      (cond ((string= new-name name) "")
            ((null status) "")
            ((not (eq (symbol-package symbol) package))
             (format nil "~a in ~a already means ~a:~a." new home (package-name (symbol-package symbol)) (symbol-name symbol)))
            ((or (fboundp symbol) (boundp symbol) (find-class symbol nil))
             (format nil "~a already names a ~a in ~a." new
                     (cond ((macro-function symbol) "macro") ((fboundp symbol) "function")
                           ((boundp symbol) "variable") (t "class"))
                     home))
            (t "")))))
