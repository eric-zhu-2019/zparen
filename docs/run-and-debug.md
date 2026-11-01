# Run and debug

ZParen keeps one SBCL running for the project. Everything on this page works
in that live image, so a fix you make while the debugger is open applies to
the call that failed.

![The REPL beside the debugger, with its restarts and backtrace, and the inspector on the right](screenshots/debugger.png)

## REPL and inspector

Results are live objects. Click one to use it in the next input, or ⌘-click
it to inspect it. ⌃R searches earlier input. Extra REPLs run in their own
threads. ⌘J goes to the REPL, and from the REPL back to the editor.

## Debugger

An error opens the debugger with its restarts, the backtrace, and each
frame's locals. You can fix the data or redefine the function, then restart
the frame that failed. Form breakpoints and stepping stop the code where you
choose.

## Tools

- **Trace** and **Profile** panels.
- **Macroexpansion** in place, under the form.
- **Disassembly** of a function.
- **Tests** for FiveAM, Parachute and Rove, shown as a tree.

![Tests as a tree: a failed FiveAM check shows the form and why it failed, with Rerun failed](screenshots/tests.png)

![Macroexpansion in place under the form, with Step back, while GREET is traced](screenshots/macrostep.png)

## Documentation

The Docs panel (⇧⌘D) shows argument lists, docstrings, apropos and the
HyperSpec. Hover a symbol to see its documentation, or its argument list when
it has none. In Vim, `K` shows a symbol's documentation in a popup.

## Sessions

A project's next session loads the systems its last one loaded. Assistant
conversations are kept, listed and continued.

To start Lisp with the project's systems already loaded, save a startup
image. See [Projects](projects.md#startup-images).
