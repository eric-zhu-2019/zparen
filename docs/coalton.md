# Coalton

[Coalton](https://coalton-lang.github.io) is a statically typed language that
runs inside Common Lisp. ZParen edits, checks and runs Coalton code in the same
live image as Lisp code.

To start a Coalton project:

1. Choose **New Project**, then choose **Coalton** in the **Language** row.
2. Choose **Create**. A Coalton project always uses ocicl, so set up ocicl first.
3. Wait for the first open to finish. ocicl downloads Coalton, and ASDF
   compiles it. This takes some minutes, and later opens use the compiled files.

The new project keeps its code in `src/main.ct`, Coalton's own file type. Its
`.asd` names `"coalton"` and `"coalton-asdf"` in `:defsystem-depends-on`, and
lists `main` as a `:ct-file`. Quicklisp's Coalton is from 2024 and cannot read
`.ct` files, so the dialog does not offer Quicklisp for Coalton.

In the editor and the REPL:

- **Run Coalton forms.** ⌘Enter on a `(coalton-toplevel …)` block compiles it.
  A definition typed alone, such as `define`, `declare` or `define-type`, runs
  inside `coalton-toplevel`. An expression typed alone, such as `match` or
  `let`, runs inside `coalton`.
- **See types.** Hover and `K` show the Coalton type of a name, such as
  `∀ :A. NUM :A ⇒ :A → :A`. On a type, such as `Optional`, they show its kind,
  documentation and constructors. On a class, such as `Num`, they show its
  superclasses, documentation and methods. The search in the Documentation
  panel finds Coalton types and classes too.
- **Read the manual.** For Coalton's operators, such as `match`, and its
  library, such as `Optional` or `map`, the Documentation panel (⇧⌘D) shows
  the page of [Coalton's manual](https://coalton-lang.github.io/manual/).
  **Docstring** switches to the text above. A library name also has a button
  for its package's part of the reference, such as `coalton/list`. Once Coalton
  is loaded, the **Coalton manual…** menu opens the manual's other pages, such
  as Whirlwind tour, Lisp interop, Debugging and the library reference. The
  manual is online, so it needs a network connection.
- **Ask for help.** `(help Optional)` in the REPL prints the same, and for a
  value it prints its type and documentation. For a name that Coalton does not
  know, it prints what Lisp knows. `(help)` says how to use it. A `help`
  function of your own still runs as before.
- **Fix type errors.** The check as you type, ⌘Enter, and a file compile mark
  the expression Coalton blames. The note shows Coalton's message without its
  copy of the source. **Copy** and **Ask AI to fix** give the full message.
  When Coalton suggests an edit, such as `_x` for an unused variable `x`, the
  note has a button that makes it.
  A type error in a form typed in the REPL prints Coalton's message in the
  REPL, and the debugger stays closed. A Lisp call such as `(scale 10)` to a
  Coalton function whose type has a constraint, such as `Num :a`, prints how
  to call it with `coalton`, and the debugger stays closed.
- **Color.** Coalton's operators, such as `define`, `match` and `declare`, have
  their own color. ZParen reads `.ct` and `.coal` files as Lisp source.

Coalton also has the `.coal` file type. A `.coal` file starts with a
`(package …)` form, and its definitions follow without `coalton-toplevel`. An
`.asd` lists such a file as a `:coalton-file`. ZParen compiles a `.coal` file
with Coalton's own compiler:

- ⌘B compiles and loads the file.
- Saving a loaded `.coal` file compiles all of it again.
- The check as you type marks the expression Coalton blames.
- The `(package …)` form sets the package for ⌘Enter, hover and completion.

Save a startup image after the first load. Lisp then starts with Coalton
loaded, and does not compile it again.

Some limits apply:

- When a file compile finds a type error, the forms after it in the file do
  not load.
- When a `.coal` file has a type error, no part of it loads.
