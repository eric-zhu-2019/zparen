# Learn Lisp

ZParen has a course in Common Lisp. It follows the order of Paul Graham's
*ANSI Common Lisp* and *On Lisp*, from your first form to writing macros. The
text and exercises are ZParen's own, and each lesson names the chapters to
read. The Beginner level (lessons 1 to 8) and the Intermediate level
(lessons 9 to 15) are here now. Later levels arrive with ZParen updates.

You learn in a real project. Each exercise is a function you write in a file,
and FiveAM tests check it. Git records your progress.

## Start the course

On the Welcome screen, click **Learn Lisp…**. In an open project, choose
**New Lisp Course Project…** from the command palette, or choose the **Lisp
course** template in the New Project dialog.

After you start a course, the Welcome screen shows **Continue Learning Lisp**
instead of **Learn Lisp…**. It opens your most recent course project where you
stopped. The Learn panel in another project and the palette's **Continue Lisp
Course** do the same. To start a second course, use the New Project dialog.

When you finish every lesson, the Welcome screen stops offering the course. If
a ZParen update adds lessons, it offers the course again. To hide it before
then, turn off **Settings ▸ General ▸ Learn Lisp**. The course stays in
Help ▸ Learn Lisp and the command palette.

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

To make the panel's text larger or smaller, use Settings ▸ General ▸ Panel
font size. The Assistant uses the same size.

To work on a lesson:

1. Click **Start Lesson**. ZParen saves your files, makes the branch
   `lesson/NN-name` from `main`, and opens the lesson's file.
2. Replace a stub with your answer. Evaluate it with ⌘↩ as you go.
3. Click **Check** on the exercise, or press ⌘↩ in its card. ZParen saves the
   file, compiles and loads it, and runs the exercise's test. A stub shows as
   **Not written**. A failing check shows FiveAM's reason. Compiler notes go
   to Problems.
4. When the test passes, ZParen runs it again in a new SBCL that has only
   your files, then commits your file as "Pass 1.1: Twice". Your running Lisp
   can hold definitions the files do not, such as one typed in the REPL or
   deleted from the file since. When the test passes only because of one of
   those, the card says so and nothing is recorded. The new SBCL uses the
   files your Lisp already compiled, so this takes about a quarter of a
   second, and it leaves your running Lisp as it was.
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

When a ZParen update brings more lessons and you finished every lesson in your
project, the course view offers **Add Lesson N**. It writes the new lesson's
files on `main` in one commit.

Exercises run in the `learn-lisp` package, which uses only Common Lisp. Your
other projects are never touched.
