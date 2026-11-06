# Run and debug

ZParen keeps one SBCL running for the project. Everything on this page works
in that live image, so a fix you make while the debugger is open applies to
the call that failed.

![The REPL beside the debugger, with its restarts and backtrace, and the inspector on the right](screenshots/debugger.png)

## REPL and inspector

Results are live objects. Click one to use it in the next input, or ⌘-click
it to inspect it. ⌃R searches earlier input. Extra REPLs run in their own
threads. ⌘J goes to the REPL, and from the REPL back to the editor.

With Vim keys on, the REPL uses Vim too. Each prompt starts in insert mode,
so you type as before. Press Escape for normal mode. There, `k` and the other
motions move into the transcript, `y` copies from it, and edits change only
the input. Enter runs the input, or copies an earlier input down to the
prompt. ↑ and ↓ recall earlier inputs. ⌃C, ⌃R and ⌃L keep their REPL meaning
in every mode: interrupt, search history, clear. `K` shows a symbol's
documentation.

## Debugger

An error opens the debugger with its restarts, the backtrace, and each
frame's locals. You can fix the data or redefine the function, then restart
the frame that failed. Form breakpoints and stepping stop the code where you
choose.

### Breakpoints

Click the gutter left of a line to set a breakpoint on the form that starts
there. Click it again to clear it. A solid dot means the breakpoint is on
compiled code. A hollow dot means the code is not loaded yet, or the form
makes no call to stop at.

Code stops at a breakpoint wherever it is called from in the project's Lisp:
the REPL, **Run** in the Systems list, or the tests (⌘U). A load or a test
run that loads a file again puts its breakpoints back on the new code before
that code runs. The debugger opens in the REPL tab with the form and the
backtrace. **Into** (F7), **Over** (F8) and **Out** (⇧F8) step from there,
and **Continue** (F9) runs on. A time limit around the code, such as the 5
seconds the Lisp course gives each check, does not end the stop.

To see values, click a frame in the backtrace. Frame 0 is the function that
stopped. The frame shows its local variables: click a value to inspect it.
Type a form in **Evaluate in this frame** to run it with those variables,
for example `(length name)`. A variable the frame does not list cannot be
evaluated there. SBCL sometimes keeps a variable under another name, such as
`#:G2` for an argument passed to `format`.

A breakpoint stops only the project's Lisp. A Learn Lisp **Check** runs in a
new SBCL, so it does not stop there.

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
