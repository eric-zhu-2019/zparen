# Learn Lisp

ZParen has a course in Common Lisp. It follows the order of Paul Graham's
*ANSI Common Lisp* and *On Lisp*, from your first form to writing macros. The
text and exercises are ZParen's own, and each lesson names the chapters to
read. The Beginner level, lessons 1 to 8, is here now. Later levels arrive
with ZParen updates.

You learn in a real project. Each exercise is a function you write in a file,
and FiveAM tests check it. Git records your progress.

## Start the course

On the Welcome screen, click **Learn Lisp…**. In an open project, choose
**New Lisp Course Project…** from the command palette, or choose the **Lisp
course** template in the New Project dialog.

The course uses ocicl to pin FiveAM, the test framework. If ocicl is not set
up, the dialog says how: run `brew install ocicl`, then `ocicl setup`. The
first time, ocicl downloads FiveAM, so you need the network once.

The new project holds lesson 1 only:

| File | What it is |
| --- | --- |
| `src/01-forms.lisp` | The lesson's exercises, each a commented task above a stub `defun` |
| `tests/01-forms.lisp` | A FiveAM test per exercise. Read it: it says exactly what each function must do |
| `learn-lisp.asd` | The systems `learn-lisp` and `learn-lisp/tests` |
| `.zparen-course` | Marks the folder as a course project |

## The Learn panel

Help ▸ Learn Lisp, or **Toggle Learn Lisp** in the palette, opens the panel on
the right. It shows the levels and lessons, with what you have finished.
Click a lesson to read it. Reading a lesson never changes your files.

A lesson has prose, examples and exercises. Hover over an example and click
**Run**, or focus it and press ⌘↩, to send it to the REPL. ⌘[ and ⌘] move to
the previous and next lesson while the panel has focus.

To work on a lesson:

1. Click **Start Lesson**. ZParen saves your files, makes the branch
   `lesson/NN-name` from `main`, and opens the lesson's file.
2. Replace a stub with your answer. Evaluate it with ⌘↩ as you go.
3. Click **Check** on the exercise, or press ⌘↩ in its card. ZParen saves the
   file, compiles and loads it, and runs the exercise's test. A stub shows as
   **Not written**. A failing check shows FiveAM's reason. Compiler notes go
   to Problems.
4. When the test passes, ZParen commits your file as "Pass 1.1: Twice".
5. When every exercise passes, click **Finish Lesson**. ZParen merges the
   branch into `main` and adds the next lesson's files there.

Each card also has **Go to Code**, **Hint**, **Show Solution** and **Ask
Assistant…**. The solution shows in the panel only, never in your file. Ask
Assistant sends the exercise and the last check's result to the assistant,
and asks for a hint rather than the answer. **‹ Back to Lesson** in the
assistant's header returns to the lesson.

⌘U runs every lesson's tests. Exercises you have not written yet are skipped,
not failed.

## Progress is git

| Event | What git records |
| --- | --- |
| The project is made | "Start the Lisp course, with lesson 1" on `main` |
| Start Lesson | A branch, `lesson/NN-name`, from `main` |
| An exercise passes | A commit "Pass N.K: Title", with the trailer `Exercise: NN/K` |
| Finish Lesson | A merge into `main` with the trailer `Lesson: NN`, then "Add lesson N+1" |

The panel reads progress from these trailers, so it stays right after a
clone, on another Mac, or after you commit by hand. **Show Course History** in
the panel's ⋯ menu shows the graph in the Output panel.

Before it switches branches, the panel saves your files and commits any
unfinished work as "Work in progress on lesson N", so switching never loses
typing. It switches only between `main` and `lesson/*` branches, and asks
before it leaves a branch of your own. It never resets, deletes or pushes
anything. If a merge stops on a conflict, the panel says which files, and
offers **Abort Merge**.

Exercises run in the `learn-lisp` package, which uses only Common Lisp. Your
other projects are never touched.
