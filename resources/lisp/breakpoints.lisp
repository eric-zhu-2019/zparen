;;;; Breakpoints on source forms, set from the editor's gutter.
;;;; A breakpoint covers a form and stops before the first call compiled from
;;;; inside it, through an sb-di breakpoint on that call site.

(in-package #:zparen)

(define-condition breakpoint-hit (simple-condition) ()
  (:documentation "Not an error, so handlers in user code never see a breakpoint."))

(defvar *breakpoints* (make-hash-table :test 'equal)
  "File path to the sb-di breakpoints installed for it.")

(defvar *breakpoint-ranges* (make-hash-table :test 'equal)
  "File path to its breakpoints as the editor sent them, (FROM TO LABEL) each,
so that code loaded again from the file gets them back.")

(defvar *breakpoint-lock* (sb-thread:make-mutex :name "zparen breakpoints"))

;; The debugger shows a breakpoint's frame source the way it shows a step's.
(let ((extras (fdefinition 'swank/backend:condition-extras)))
  (setf (fdefinition 'swank/backend:condition-extras)
        (lambda (condition)
          (if (typep condition 'breakpoint-hit)
              '((:show-frame-source 0))
              (funcall extras condition)))))

(defun stop-at-breakpoint (frame label)
  ;; Like BREAK: enter the debugger without signalling.
  (let ((sb-debug:*stack-top-hint* frame))
    ;; A time limit around the code, such as the Lisp course's 5 seconds per
    ;; check, would end the stop and fail the code it stopped. While stopped,
    ;; the time limit is passed by, as its Continue restart does.
    (handler-bind ((sb-ext:timeout (lambda (c)
                                     (let ((continue (find-restart 'continue c)))
                                       (when continue (invoke-restart continue))))))
      (with-simple-restart (continue "Continue from the breakpoint.")
        (invoke-debugger (make-condition 'breakpoint-hit :format-control "Breakpoint at ~a"
                                                         :format-arguments (list label)))))))

(defun source-offset (location)
  "LOCATION's 0-based character offset in its file or editor buffer, as the editor counts it."
  (let ((loc (ignore-errors (swank/sbcl::code-location-source-location location))))
    (when (eq (car loc) :location)
      (let ((pos (third loc)))
        (case (car pos)
          (:position (1- (second pos)))
          (:offset (+ (1- (second pos)) (third pos))))))))

(defun compiled-from-p (fun names)
  "Whether FUN was compiled from a file or editor buffer in NAMES, judged from its debug source alone."
  (let* ((start (ignore-errors (sb-di:debug-fun-start-location fun)))
         (source (and start (sb-di:code-location-debug-source start))))
    (and source
         (or (member (sb-di:debug-source-namestring source) names :test #'equal)
             (member (getf (sb-c::debug-source-plist source) :emacs-buffer) names :test #'equal)))))

(defun call-sites (names)
  "Each call site compiled from a file or buffer in NAMES, as (code-location . offset)."
  (let ((sites '()))
    ;; Code loaded a moment ago sits in an open allocation region the heap walk skips until a GC.
    (sb-ext:gc)
    (sb-vm:map-allocated-objects
     (lambda (object type size)
       (declare (ignore size))
       (when (= type sb-vm:code-header-widetag)
         (dotimes (i (sb-kernel:code-n-entries object))
           (let ((fun (ignore-errors (sb-di:fun-debug-fun (sb-kernel:%code-entry-point object i)))))
             (when (and fun (compiled-from-p fun names))
               (sb-di:do-debug-fun-blocks (block fun)
                 (sb-di:do-debug-block-locations (location block)
                   (when (and (not (sb-di:code-location-unknown-p location))
                              (eq (sb-di:code-location-kind location) :call-site))
                     (let ((offset (source-offset location)))
                       (when offset (push (cons location offset) sites)))))))))))
     :all)
    sites))

(defun set-breakpoints (path ranges)
  "Replaces PATH's breakpoints with RANGES, each (FROM TO LABEL), and returns the FROMs bound to code."
  ;; Files are recorded by truename and editor buffers by the path the editor sent.
  (let ((names (list path (namestring (truename path)))))
    (sb-thread:with-mutex (*breakpoint-lock*)
      (mapc #'sb-di:delete-breakpoint (gethash path *breakpoints*))
      (remhash path *breakpoints*)
      (if ranges
          (setf (gethash path *breakpoint-ranges*) ranges)
          (remhash path *breakpoint-ranges*))
      (let ((sites (and ranges (call-sites names)))
            (bound '()))
        (loop for (from to label) in ranges
              for inside = (remove-if-not (lambda (site) (<= from (cdr site) (1- to))) sites)
              when inside
                do (let ((first (reduce #'min inside :key #'cdr)))
                     (loop for (location . offset) in inside
                           when (= offset first)
                             do (let ((bp (sb-di:make-breakpoint
                                           (lambda (frame bp)
                                             (declare (ignore bp))
                                             (stop-at-breakpoint frame label))
                                           location)))
                                  (sb-di:activate-breakpoint bp)
                                  (push bp (gethash path *breakpoints*))))
                     (push from bound)))
        (nreverse bound)))))

(defun reinstall-breakpoints (file)
  "Installs FILE's breakpoints again, on the code just loaded from it."
  (let* ((true (ignore-errors (namestring (truename file))))
         (paths (and true
                     (sb-thread:with-mutex (*breakpoint-lock*)
                       (loop for path being the hash-keys of *breakpoint-ranges* using (hash-value ranges)
                             when (equal (ignore-errors (namestring (truename path))) true)
                               collect (cons path ranges))))))
    (loop for (path . ranges) in paths
          do (ignore-errors (set-breakpoints path ranges)))))

;; A load or a test run loads a file's fasl again, which makes new code
;; without the breakpoints. They go back in before that code runs.
(defmethod asdf:perform :after ((o asdf:load-op) (c asdf:cl-source-file))
  (when (plusp (hash-table-count *breakpoint-ranges*))
    (reinstall-breakpoints (asdf:component-pathname c))))
