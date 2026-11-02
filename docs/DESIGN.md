# Design plan: Learn Lisp

A course inside ZParen that takes a beginner from `(+ 1 2)` to writing the
macros in *On Lisp*. It follows the order of Paul Graham's *ANSI Common Lisp*
and *On Lisp*. The text and exercises are ZParen's own, and each lesson names
the chapters to read.

The course has three parts:

1. **A course project.** The New Project dialog makes an ordinary ASDF
   project from a "Lisp course" template. It has one source file per lesson,
   with exercise stubs to fill in, and FiveAM tests pinned with ocicl.
2. **Git as the progress record.** Each lesson is a branch. Each passed
   exercise is a commit. A finished lesson is merged into `main`.
3. **The Learn panel.** It shows lessons and exercises next to the editor and
   REPL, and it drives the files, tests and git for you.

This file is a plan, not user documentation, so `scripts/build-site.mjs` does
not publish it.

Built so far: the template, git progress, the panel, the Beginner level
(lessons 1–8) and the Intermediate level (lessons 9–15). Lessons 16–24 follow.

## Feeling

**Calm and confident.** You are never lost, never rushed, and never punished
for a wrong answer. A failing test says what went wrong in plain words. A
passed exercise gets a check mark and the word "Passed", with no confetti. Git
works quietly behind the panel. You can look at it, but you never need to
type a git command.

## The eight principles, applied

| Principle | What it means here |
| --- | --- |
| Purpose | Every exercise is a real function in a real file with real tests. What you learn is how Lisp is actually written. |
| Agency | Nothing opens by itself. Every lesson can be read at any time and every finished lesson can be revisited. Lessons are worked in order, so the project only holds what you have reached. You can always ignore the panel and use ⌘U and git yourself. |
| Responsibility | The course is its own project, so it never touches your other projects. The panel commits and merges only in that project, and only on its `lesson/*` branches and `main`. The assistant gives hints, not answers, and runs only when you ask. |
| Familiarity | Exercises are `defun`s you edit and evaluate with ⌘↩. Tests show in the usual Tests panel, and the git gutter shows your changes. The panel looks like Docs and the Inspector. |
| Flexibility | Panel buttons, ⌘U, the REPL and plain git all work and agree. Progress is read from git, so it is right whichever way you worked. |
| Simplicity | Each card has one main action, Check. The panel has two levels: the course and a lesson. |
| Craft | Check saves, loads and tests in about a second. Endless loops and stack overflows become failed tests, never a stuck debugger. |
| Delight | `git log` becomes the story of how you learned Lisp. |

## Archetype

**A trailing panel in the project window**, beside the editor and REPL. It is
not a separate window. It uses the right-panel slot, alongside Inspector,
Documentation and Assistant.

- It opens 420 px wide, because lessons are prose, and stays resizable.
- It only means something in a course project. In another project it shows
  one line, "The course runs in a course project", and a **New Course
  Project…** button.

## The course project

### Template

The New Project dialog gets a **Template** choice, Empty or Lisp course,
above Language. Choosing Lisp course does three things:

- It sets the name to `learn-lisp`.
- It locks the dependencies to ocicl and the language to Lisp. Those
  controls stay visible but disabled, with a note saying why.
- If ocicl is not set up, it shows the dialog's existing ocicl message and
  disables Create, as an ocicl project does today.

The template produces:

```
learn-lisp/
├─ .zparen-course              course id and template version; marks the project
├─ README.md                   how the course works, for reading on GitHub too
├─ learn-lisp.asd              learn-lisp and learn-lisp/tests
├─ ocicl.csv                   fiveam, pinned
├─ src/
│  ├─ package.lisp             (defpackage #:learn-lisp (:use #:cl))
│  ├─ not-written.lisp         the NOT-WRITTEN-YET condition the stubs signal
│  └─ 01-forms.lisp           lesson 1 only; each later lesson arrives when
│                              the one before it is finished
└─ tests/
   ├─ package.lisp
   ├─ support.lisp             CHECKING: a time limit, errors as failures, stubs as skips
   └─ 01-forms.lisp            (def-suite lesson-01) and one TEST per exercise
```

**A lesson source file** holds each exercise as a commented prompt above a
stub:

```lisp
;;;; Lesson 3: Recursion over lists
;;;; ANSI Common Lisp, 2.7–2.8. Open the Learn panel for the lesson.

(in-package #:learn-lisp)

;;; Exercise 3.1: Count the elements
;;; Define OUR-LENGTH, which returns how many elements LIST has.
;;; Use recursion, not LENGTH.
(defun our-length (list)
  (not-written-yet 'our-length))
```

**A lesson test file** has one FiveAM test per exercise. Its expectations come
from the lesson's `check` rows:

```lisp
(in-suite lesson-03)

(test our-length
  (checking our-length
    (is (equal 0 (our-length '())))
    (is (equal 3 (our-length '(a b c))))))
```

`checking` does three things:

- It turns a stub's `not-written-yet` into a FiveAM **skip**. ⌘U then shows
  exercises you haven't written yet as skipped, not as failures.
- It reports errors, stack exhaustion and a 5-second time limit as failures,
  never the debugger.
- It stays readable, so the tests double as the exercise's specification. You
  may read them; that is test-driven learning, not cheating.

### Lessons arrive one at a time

The project starts with lesson 1 only. When you finish a lesson, the panel
writes the next lesson's two files on `main`, adds them to the `.asd`, and
commits "Add lesson 4: Variables and iteration". So:

- The file list shows only lessons you have reached. Nothing ahead of you
  clutters the tree, and the next file appearing marks the step forward.
- ⌘U runs only lessons you have reached, so it never reports a wall of
  lessons you haven't started.
- Only one lesson is open at a time, and the `.asd` changes only on `main`,
  between lessons. Two branches never edit it at once, so merges don't
  conflict.
- A course project made by an older ZParen keeps working. When a newer
  ZParen has more lessons, the next one simply arrives when you get there.

### Getting there without a project

The Welcome screen gets a **Learn Lisp…** button. It opens the New Project
dialog with the Lisp course template chosen, so a beginner's first click
leads straight into the course.

## Git: one branch per lesson

```
main ──●──────────────●─●──────────────●─●──
        \            /    \            /
lesson/01-forms ●──●──●    lesson/02-functions ●──●

● on a lesson branch      = an exercise passed
merge into main           = lesson finished
● right after a merge     = "Add lesson N+1", the next lesson's files
```

| Event | What the panel does in git |
| --- | --- |
| Project created | Writes the template with lesson 1's files, runs `git init`, then commits "Start the Lisp course" on `main`. |
| **Start Lesson**, offered once the lesson's files exist | Saves open files, then creates `lesson/NN-slug` from `main` and checks it out. If the branch exists, it just checks it out. |
| **Check** passes | Saves the lesson file, then commits it with "Pass 3.1: Count the elements" and the trailer `Exercise: 03/1`. If an earlier pass already committed the code, the commit is empty, so every pass keeps its trailer. A pass already recorded is not committed again. |
| Check fails | No commit. The file stays as you left it. |
| **Finish Lesson**, shown once every exercise passes | Checks out `main`, then merges `lesson/NN-slug` with `--no-ff` and the message "Finish lesson 3: Recursion over lists". The branch is kept as history. It then writes the next lesson's files and commits "Add lesson 4: Variables and iteration" on `main`. |
| Revisit a finished lesson | Opening it shows it. Its file is on `main`, so your answers are there with no branch switch. Changing an answer later is ordinary editing on whatever branch you're on. |
| **Continue** | Checks out the branch of the lesson in progress, or starts the lesson whose files arrived last. |

**Progress is read from git, never stored on the side:**

- **A lesson is finished** when a merge on `main` carries its trailer
  `Lesson: NN`. A branch just made from `main` already counts as merged into
  it, so merged branches cannot tell.
- **An exercise has passed** when a commit reachable from that lesson's
  branch or from `main` has the trailer `Exercise: NN/k`.

So progress follows the repository. It is right after a clone, after you
commit by hand, and on another Mac.

**Safety rules:**

- **Leaving a branch with unsaved or uncommitted work:** the panel saves open
  buffers, then commits what is uncommitted on that branch as "Work in
  progress on lesson N". Switching lessons never loses typing and never needs
  a stash.
- **The panel only switches between `main` and `lesson/*`.** If you are on a
  branch of your own, Start and Continue ask first: "You are on `my-idea`.
  Switch to lesson 3? Your work there is kept."
- **Merge conflicts:** these happen only if you edit outside the lesson file.
  The panel then stops and says so. It leaves git as `git merge` left it, and
  offers **Abort Merge**.
- **No rewriting:** the panel never force-pushes, resets or deletes a branch.
- **After switching:** open tabs reload from disk, as they do today when
  files change, and the panel reloads the lesson file into the image.
- **Without git:** if git is missing, macOS offers to install the Command
  Line Tools. The panel says "Progress needs git" and still lets you read the
  lessons and run tests.

## Information architecture

Two levels:

1. **Course**: four levels shown as disclosure groups, each with its lessons.
2. **Lesson**: prose, runnable examples, then exercise cards.

```
Beginner        (ANSI Common Lisp, ch. 2–5)        ← first version
   1 Forms and evaluation
   2 Functions and conditionals
   3 Recursion over lists
   4 Variables and iteration
   5 Functions as data
   6 Lists in depth
   7 Arrays, strings, hash tables and structures
   8 Control flow and multiple values
Intermediate    (ANSI Common Lisp, ch. 6–11, 14)
   9–15  closures, I/O, packages, numbers, first macros, conditions, CLOS
Advanced        (ANSI Common Lisp, ch. 12–13; On Lisp, ch. 2–5)
  16–19  shared structure, speed, utilities, functions returning functions
Master          (On Lisp, ch. 7–19)
  20–24  macro design, capture, classic macros, anaphora, macro-defining macros
```

## Layout

### Course view

```
┌ Learn Lisp ─────────────────────── ⋯  ✕ ┐
│ 3 of 8 lessons · 9 of 21 exercises        │
│ [ Continue: Recursion over lists ]        │  ← the one prominent button
│                                           │
│ ▾ Beginner                     2 of 8     │
│     ✓ 1 Forms and evaluation              │
│     ✓ 2 Functions and conditionals        │
│     ◐ 3 Recursion over lists   1/3  ⎇     │  ⎇ = the branch you are on
│       4 Variables and iteration   after 3 │  ← readable, files not yet made
│ ▸ Intermediate                 soon       │
└───────────────────────────────────────────┘
```

- Rows are list rows: a hover state, the arrow keys move between them, and
  Return opens a lesson. Opening a lesson only shows it; it does not switch
  branches.
- Lessons ahead of you are dimmed with "after 3", meaning they arrive when
  lesson 3 is finished. You can open them to read ahead. Their cards show
  the exercises, but Start and Check say "Finish lesson 3 first".
- A row's status is an icon plus a word or count. The ⎇ mark has the tooltip
  "You are on lesson/03-recursion".
- The ⋯ menu holds **Show Course History** (`git log --graph` in the
  Output panel), **Read On Lisp Online** and **Open README**.

### Lesson view

```
┌ ‹  3 · Recursion over lists        ⋯  ✕ ┐
│ Beginner · ANSI Common Lisp, 2.7–2.8      │
│ ⎇ lesson/03-recursion · src/03-lists.lisp │  ← click to open the file
│                                           │
│ Prose…                                    │
│ ┌──────────────────────── Copy  Run ⌘↩ ┐ │
│ │ (cons 'a '(b c))                      │ │
│ └──────────────────────────────────────┘ │
│                                           │
│ Exercises                                 │
│ ┌ 1  Count the elements      ✓ Passed  ┐  │
│ └──────────────────────────────────────┘  │
│ ┌ 2  Find a member                      ┐ │
│ │ Define (our-member x list) so that …  │ │
│ │ ✕ Not yet                              │ │
│ │   (our-member 'b '(a b c))             │ │
│ │   returned NIL; expected (B C)         │ │
│ │ [ Check ⌘↩ ]  Go to Code  Hint ▸       │ │
│ │ Ask Assistant…   Show Solution ▸      │ │
│ └──────────────────────────────────────┘ │
│                                           │
│ [ Finish Lesson ]  ← once every card passes│
└───────────────────────────────────────────┘
```

- **When you are not on the lesson's branch,** the line under the title reads
  "Not started" or "On another branch", followed by **Start Lesson**, which
  is the prominent button. The Check buttons stay disabled until you start,
  with the tooltip "Start the lesson to check your work".
- **Code examples** use the editor's font and syntax colors. **Run** and
  **Copy** show on hover and on keyboard focus. Run sends the code to the
  REPL in `learn-lisp` and shows the REPL tab.
- **Go to Code** opens the lesson file in the editor at the exercise's
  `defun`.
- **Check** does the following, in order:
  1. Saves the file.
  2. Compiles it, so compiler notes show as usual.
  3. Runs the exercise's FiveAM test.
  4. Shows the first failing expectation in the card, in monospace.
  5. On a pass, commits.

  The Tests panel shows the same run.
- **Hint** and **Show Solution** expand in place and fold again, with no
  confirmation dialog. The solution is shown only in the panel and is never
  written into your file.
- **Ask Assistant…** ends in an ellipsis because it opens the assistant. It
  sends:
  - the lesson and the exercise,
  - the last failure text,
  - the file path,
  - the instruction "give a hint, not the answer; read the learner's code and
    tests with your tools".

  The Assistant panel then shows **‹ Back to Lesson** in its header.
- **Finish Lesson** appears when every exercise has passed. It merges and
  adds the next lesson's files, then shows "Merged into main.
  `src/04-iteration.lisp` is ready" and **Start Lesson 4**. The new file
  appears in the file list, briefly highlighted.

### Type and spacing

These use the app's existing CSS tokens: `--text`, `--text-dim`,
`--bg-panel`, `--accent`, `--success`, `--danger`, and `--syn-*` for code.
No new colors. Cards are content, so they get a flat `--bg-panel` with no
glass and no shadow.

| Element | Size and weight |
| --- | --- |
| Lesson title | 17 px, semibold |
| Section heading | 15 px, semibold |
| Prose | 13 px, line height 1.5 |
| Meta and branch lines | 11 px, `--text-dim` |
| Code | the editor's font size |
| Smallest text | 11 px |

Spacing:

- 16 px panel margins.
- 8 px between a card's controls.
- 20 px between cards and sections.
- Prose lines are limited to about 70 characters.

## Command map

| Action | Where | Key |
| --- | --- | --- |
| Show or hide Learn Lisp | Help ▸ Learn Lisp; palette "Toggle Learn Lisp" | none (see note below) |
| New course project | Welcome ▸ Learn Lisp…; New Project ▸ Template ▸ Lisp course; course panel in a non-course project | ⇧⌘N, then choose the template |
| Continue | Course view button; palette "Continue Lisp Course" | Return on the button |
| Open lesson | Course list | ↑ ↓ and Return |
| Back to the course | Header ‹ | ⌘[ |
| Next lesson | Lesson footer; palette | ⌘] |
| Start lesson | Lesson header button | Return on the button |
| Run example | Code block | ⌘↩ with the block focused |
| Check exercise | Card button; or ⌘↩ in the card | ⌘↩ |
| Check the whole lesson | Lesson ⋯ menu; palette "Check Lesson" | none; ⌘U runs every lesson |
| Go to code | Card button | none |
| Finish lesson | Lesson footer | Return on the button |
| Show course history | Course ⋯ menu | none |

**Why no global key for the panel:** ⌘L belongs to the assistant. ⇧⌘L would
add a modifier to that unrelated command, which rule 69 forbids. If the panel
turns out to be used often, ⌃⌘L is free.

ZParen has no View menu, so the toggle goes in Help, next to Lisp
Documentation and Getting Started.

## Empty and edge states

| State | What shows |
| --- | --- |
| No project open | Welcome shows **Learn Lisp…**, which opens New Project with the course template. |
| A project that is not a course | "The course runs in a course project of its own, so it never touches this one." followed by **New Course Project…**. |
| ocicl not set up | The New Project dialog shows its existing ocicl message, and Create is disabled. |
| First open of a new course | The course view with **Start: Forms and evaluation**, and one sentence: "Each lesson is a git branch; passing an exercise commits your answer." |
| FiveAM still downloading | Check reads "Loading the tests…". The Output panel shows ocicl's progress, as for any ocicl project. |
| Lisp starting or stopped | Run and Check are disabled, with the reason in their tooltips. |
| Check running | The button reads "Checking…" and is disabled, with no spinner; checks finish in seconds. |
| No git | "Progress needs git. macOS offers to install it the first time git runs." Lessons and tests still work. |
| Merge conflict | "Lesson 3 could not merge into main: a file outside the lesson changed." followed by **Show Changes** and **Abort Merge**. |
| Every lesson this ZParen has is finished | "You finished every lesson this ZParen has. More lessons arrive with ZParen updates." |
| An update brought more lessons | "This ZParen brings more", with **Add Lesson N**. It writes the lesson on `main` as an "Add lesson N" commit. |

## Restoring

The panel remembers whether it was open, the lesson shown, the expanded level
groups and each lesson's scroll position. This is UI state in `localStorage`.
Progress itself is always read from git.

## Accessibility

- Every icon-only button has a label, and a tooltip that ends with its
  shortcut.
- Pass, fail and skip always show a word, not only a color.
- Check results are announced through `aria-live`.
- Disclosures are buttons with `aria-expanded`.
- Opening the panel moves no focus.
- The only animation is the disclosure, and it is off under Reduce Motion.

## How it is built

- **Lessons** are Markdown files in `src/learn/lessons/`. Each has front
  matter (`title`, `level`, `reading`, `file`) and prose. Each
  `## Exercise:` section holds the following blocks:
  - `stub`: the `defun` with its arguments,
  - `hint`,
  - `solution`,
  - `check`: rows of `(form expected [test])`.

  The template writes the source and test files from these.
- **Template, Rust:** `project::create` gets a `NewTemplate` with two values,
  `Empty` and `Course`. The course variant writes the fixed files and runs
  `git init` and the first commit. The lesson files come from the UI, which
  owns the lesson text, and are written through the existing `writeFile`
  request before that first commit. `.zparen-course` marks the project.
- **Git, Rust:** `git.rs` gets the few commands the panel needs, as one
  `courseGit` request:
  - current branch,
  - create or switch branch,
  - commit paths with a message,
  - merge `--no-ff` and abort a merge,
  - the trailers on `main` and on each `lesson/*` branch,
  - `log --graph`.

  It runs only in a project with `.zparen-course`.
- **Check** uses the existing `compileFile` and `rerunTests` operations with
  the exercise's FiveAM test, so the Tests panel and the card show the same
  run.
- **Test, Vitest plus SBCL:** for each exercise, the generated test must
  - skip against the stub,
  - fail against a wrong answer, here the stub returning `nil`,
  - pass against the solution.

  A Rust test creates a course project and checks the git flow end to end:
  start, pass, finish and progress.

## Out of scope for the first version

- Lessons 16–24, the Advanced and Master levels.
- Pushing to a remote. Plain git push works, but the panel doesn't offer it.
- Lessons written by users or plugins, and Coalton lessons.
- Grading style. Only behavior is checked.
