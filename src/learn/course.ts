// The Lisp course: lessons written as Markdown in ./lessons, and the files a
// course project holds for each one.
//
// A lesson file starts with front matter (title, level, reading), then prose
// and examples. Each `## Exercise: Title` section ends the prose and holds one
// exercise: its prompt, then fenced blocks marked `stub`, `hint`, `solution`
// and `check`. The stub is what the learner's file starts with; the check block
// holds FiveAM checks, written `(is ...)`, that the exercise's test runs.

import type { CourseState } from "../protocol/CourseState";

export type Level = "beginner" | "intermediate" | "advanced" | "master";

export const LEVELS: { id: Level; title: string; reading: string }[] = [
  { id: "beginner", title: "Beginner", reading: "ANSI Common Lisp, ch. 2–5" },
  { id: "intermediate", title: "Intermediate", reading: "ANSI Common Lisp, ch. 6–11 and 14" },
  { id: "advanced", title: "Advanced", reading: "ANSI Common Lisp, ch. 12–13; On Lisp, ch. 2–5" },
  { id: "master", title: "Master", reading: "On Lisp, ch. 7–19" },
];

export type Exercise = {
  /** The lesson's number and the exercise's, as git trailers name it: "03/1". */
  key: string;
  /** "3.1", as the learner reads it. */
  label: string;
  index: number;
  title: string;
  /** The task, in Markdown. */
  prompt: string;
  /** The function or macro the exercise defines, which names its test too. */
  name: string;
  stub: string;
  hint: string | null;
  solution: string;
  /** FiveAM checks, one form per line or more, written with `is`. */
  check: string;
};

export type Lesson = {
  /** The file name without its extension, such as 03-lists; it names the lesson's files and branch. */
  id: string;
  number: number;
  title: string;
  level: Level;
  /** Where the books cover the same ground. */
  reading: string | null;
  /** The lesson's prose, in Markdown. */
  body: string;
  exercises: Exercise[];
};

function frontMatter(text: string): { fields: Record<string, string>; rest: string } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return { fields: {}, rest: text };
  const fields: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return { fields, rest: text.slice(m[0].length) };
}

/** Takes the fenced blocks marked `kind` out of `md`, returning their contents and what is left. */
function takeBlocks(md: string, kind: string): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  const rest = md.replace(new RegExp("^```" + kind + "[ \\t]*\\n([\\s\\S]*?)^```[ \\t]*$\\n?", "gm"), (_, body: string) => {
    blocks.push(body.replace(/\n$/, ""));
    return "";
  });
  return { blocks, rest };
}

/** The name the first definition in `code` defines. */
export function definedName(code: string): string | null {
  return /\(\s*def(?:un|macro|generic)\s+([^\s()]+)/i.exec(code)?.[1]?.toLowerCase() ?? null;
}

export function parseLesson(id: string, text: string): Lesson {
  const number = Number(/^(\d+)-/.exec(id)?.[1]);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${id}: a lesson file is named NN-name.md`);
  const { fields, rest } = frontMatter(text.replace(/\r\n/g, "\n"));
  const [body, ...sections] = rest.split(/^## Exercise:[ \t]*/m);
  const level = (fields.level ?? "beginner") as Level;
  if (!LEVELS.some((l) => l.id === level)) throw new Error(`${id}: unknown level ${level}`);
  const nn = String(number).padStart(2, "0");
  const exercises = sections.map((section, i): Exercise => {
    const newline = section.indexOf("\n");
    const title = section.slice(0, newline < 0 ? undefined : newline).trim();
    let md = newline < 0 ? "" : section.slice(newline + 1);
    const taken: Record<string, string[]> = {};
    for (const kind of ["stub", "hint", "solution", "check"]) {
      const t = takeBlocks(md, kind);
      taken[kind] = t.blocks;
      md = t.rest;
    }
    for (const kind of ["stub", "solution", "check"]) {
      if (taken[kind].length !== 1) throw new Error(`${id}: exercise "${title}" needs one ${kind} block`);
    }
    const name = definedName(taken.stub[0]);
    if (!name) throw new Error(`${id}: exercise "${title}" has a stub that defines nothing`);
    return {
      key: `${nn}/${i + 1}`,
      label: `${number}.${i + 1}`,
      index: i + 1,
      title,
      prompt: md.trim(),
      name,
      stub: taken.stub[0],
      hint: taken.hint[0] ?? null,
      solution: taken.solution[0],
      check: taken.check[0],
    };
  });
  return { id, number, title: fields.title ?? id, level, reading: fields.reading || null, body: body.trim(), exercises };
}

const files = import.meta.glob("./lessons/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const LESSONS: Lesson[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, text]) => parseLesson(path.replace(/^.*\/|\.md$/g, ""), text));

export const lessonBranch = (l: Lesson) => `lesson/${l.id}`;
export const lessonSource = (l: Lesson) => `src/${l.id}.lisp`;
export const lessonTests = (l: Lesson) => `tests/${l.id}.lisp`;

/** The test that checks an exercise, as FiveAM's rerun reads it. */
export const testId = (pkg: string, e: Exercise) => `${pkg.toUpperCase()}::${e.name.toUpperCase()}`;

export const passMessage = (e: Exercise) => `Pass ${e.label}: ${e.title}\n\nExercise: ${e.key}`;
export const finishMessage = (l: Lesson) => `Finish lesson ${l.number}: ${l.title}\n\nLesson: ${String(l.number).padStart(2, "0")}`;
export const addMessage = (l: Lesson) => `Add lesson ${l.number}: ${l.title}`;
export const progressMessage = (l: Lesson) => `Work in progress on lesson ${l.number}`;

// ---------------------------------------------------------------------------
// The files of a course project

/** Markdown inline code and emphasis as plain text, for a Lisp comment. */
const plain = (md: string) => md.replace(/`([^`]*)`/g, "$1").replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/\s+/g, " ").trim();

/** Text as `;;;` comment lines no wider than about 72 columns. */
function comment(text: string, width = 68): string {
  const lines: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    let line = "";
    for (const word of plain(para).split(" ")) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  return lines.map((l) => `;;; ${l}`).join("\n");
}

export function asdFile(pkg: string, reached: Lesson[]): string {
  const files = (names: string[]) => names.map((n) => `(:file "${n}")`).join("\n                             ");
  return `;;;; Written by ZParen's Learn panel, which adds each lesson here as you reach it.

(defsystem "${pkg}"
  :description "A course in Common Lisp, after ANSI Common Lisp and On Lisp"
  :serial t
  :components ((:module "src"
                :serial t
                :components (${files(["package", "not-written", ...reached.map((l) => l.id)])})))
  :in-order-to ((test-op (test-op "${pkg}/tests"))))

(defsystem "${pkg}/tests"
  :depends-on ("${pkg}" "fiveam")
  :serial t
  :components ((:module "tests"
                :serial t
                :components (${files(["support", ...reached.map((l) => l.id)])})))
  :perform (test-op (o c) (symbol-call :fiveam :run! (find-symbol* :course :${pkg}))))
`;
}

export function packageFile(pkg: string): string {
  return `(defpackage #:${pkg}
  (:use #:cl)
  (:documentation "Your answers to the course's exercises, one file per lesson."))
`;
}

export function notWrittenFile(pkg: string): string {
  return `(in-package #:${pkg})

;;; Each exercise starts as a stub that signals NOT-WRITTEN-YET. The tests
;;; skip an exercise while it does, so ⌘U shows what is left to write.

(define-condition not-written-yet (error)
  ((name :initarg :name :reader not-written-name))
  (:report (lambda (c stream)
             (format stream "~(~a~) is not written yet. Write it in this lesson's file, then evaluate it."
                     (not-written-name c)))))

(defun not-written-yet (name &rest arguments)
  "Signals that NAME is still a stub. The stub passes its ARGUMENTS, so none goes unused."
  (declare (ignore arguments))
  (error 'not-written-yet :name name))
`;
}

export function supportFile(pkg: string): string {
  return `(in-package #:${pkg})

(fiveam:def-suite course :description "Every lesson's tests.")

(defmacro checking (name &body checks)
  "Runs CHECKS with a time limit. While NAME is a stub the test is skipped,
and an error, an endless loop or a stack overflow fails it."
  \`(handler-case (sb-ext:with-timeout 5 ,@checks)
     (not-written-yet ()
       (fiveam:skip "~(~a~) is not written yet." ',name))
     (sb-ext:timeout ()
       (fiveam:fail "~(~a~) did not finish in 5 seconds. Is there an endless loop?" ',name))
     (serious-condition (e)
       (fiveam:fail "~a" e))))
`;
}

/** The variables a lambda list binds, from its text: (a b &optional (c 1) &key d) gives a, b, c, d. */
export function lambdaVariables(list: string): string[] {
  const inner = list.trim().replace(/^\(|\)$/g, "");
  const vars: string[] = [];
  let depth = 0;
  let token = "";
  let firstInGroup = false;
  const flush = () => {
    if (token && !token.startsWith("&") && (depth === 0 || firstInGroup)) vars.push(token);
    if (token && depth === 1) firstInGroup = false;
    token = "";
  };
  for (const c of inner) {
    if (c === "(") {
      flush();
      depth++;
      firstInGroup = true;
    } else if (c === ")") {
      flush();
      depth--;
    } else if (/\s/.test(c)) flush();
    else token += c;
  }
  flush();
  return vars;
}

/** A stub's call to NOT-WRITTEN-YET with the function's variables passed on. */
export function stubWithArguments(stub: string): string {
  return stub.replace(/\(\s*def(?:un|macro)\s+([^\s()]+)\s*(\([^()]*(?:\([^()]*\)[^()]*)*\))([\s\S]*?)\(not-written-yet\s+'([^\s()]+)\s*\)/g, (all, _name, list: string, _between: string, target: string) => {
    const vars = lambdaVariables(list);
    return vars.length ? all.replace(/\(not-written-yet\s+'[^\s()]+\s*\)$/, `(not-written-yet '${target} ${vars.join(" ")})`) : all;
  });
}

export function sourceFile(pkg: string, l: Lesson): string {
  const head = `;;;; Lesson ${l.number}: ${l.title}
;;;; Read the lesson in ZParen's Learn panel.${l.reading ? ` ${l.reading}.` : ""}

(in-package #:${pkg})
`;
  return [head, ...l.exercises.map((e) => `;;; Exercise ${e.label}: ${e.title}\n${comment(e.prompt)}\n${stubWithArguments(e.stub)}\n`)].join("\n");
}

/** The check block with FiveAM's operators named in full, since the lesson's package does not use FiveAM. */
const qualified = (check: string) => check.replace(/\((is|is-true|is-false|signals|finishes)(?=[\s)])/g, "(fiveam:$1");

const indent = (text: string, by: string) => text.split("\n").map((l) => (l ? by + l : l)).join("\n");

export function testFile(pkg: string, l: Lesson): string {
  const head = `(in-package #:${pkg})

(fiveam:def-suite lesson-${String(l.number).padStart(2, "0")} :in course :description "Lesson ${l.number}: ${l.title}")
(fiveam:in-suite lesson-${String(l.number).padStart(2, "0")})
`;
  const tests = l.exercises.map(
    (e) => `(fiveam:test ${e.name}
  "Exercise ${e.label}: ${e.title}"
  (checking ${e.name}
${indent(qualified(e.check), "    ")}))
`,
  );
  return [head, ...tests].join("\n");
}

export function readme(pkg: string): string {
  return `# ${pkg}

A course in Common Lisp, made by [ZParen](https://github.com/eric-zhu-2019/zparen).
It follows the order of Paul Graham's *ANSI Common Lisp* and *On Lisp*.

Open the Learn panel (Help ▸ Learn Lisp) to read each lesson.

- \`src/\` holds a file per lesson. Each exercise starts as a stub; replace it
  with your answer and evaluate it.
- \`tests/\` holds the FiveAM tests that check each exercise. Read them: they
  say exactly what each function must do. ⌘U runs them all.
- Git records your progress. Each lesson is a branch, \`lesson/NN-name\`; each
  passed exercise is a commit with an \`Exercise:\` trailer; a finished lesson
  is merged into \`main\`, and the next lesson's files are added there.
`;
}

/** Every file a new course project starts with, lesson 1 included. */
export function startingFiles(pkg: string): { path: string; content: string }[] {
  const first = LESSONS[0];
  return [
    { path: ".zparen-course", content: `${JSON.stringify({ version: 1, package: pkg })}\n` },
    { path: "README.md", content: readme(pkg) },
    { path: `${pkg}.asd`, content: asdFile(pkg, [first]) },
    { path: "src/package.lisp", content: packageFile(pkg) },
    { path: "src/not-written.lisp", content: notWrittenFile(pkg) },
    { path: lessonSource(first), content: sourceFile(pkg, first) },
    { path: "tests/support.lisp", content: supportFile(pkg) },
    { path: lessonTests(first), content: testFile(pkg, first) },
  ];
}

// ---------------------------------------------------------------------------
// Progress, as git records it

export type Progress = {
  /** Lessons whose files are in the project, in order. */
  reached: Lesson[];
  finished: Set<string>;
  passed: Set<string>;
  /** The lesson whose branch is checked out. */
  onLesson: Lesson | null;
  /** The lesson to work on next: the one in progress, or the one that arrived last. */
  current: Lesson | null;
};

export function progress(state: CourseState, sourceFiles: string[]): Progress {
  const have = new Set(sourceFiles);
  const reached = LESSONS.filter((l) => have.has(`${l.id}.lisp`));
  const finished = new Set(LESSONS.filter((l) => state.finished.includes(String(l.number).padStart(2, "0"))).map((l) => l.id));
  const onLesson = LESSONS.find((l) => state.branch === lessonBranch(l)) ?? null;
  const current = onLesson && !finished.has(onLesson.id) ? onLesson : (reached.find((l) => !finished.has(l.id)) ?? null);
  return { reached, finished, passed: new Set(state.passed), onLesson, current };
}

export const lessonDone = (p: Progress, l: Lesson) => p.finished.has(l.id);
export const exercisesPassed = (p: Progress, l: Lesson) => l.exercises.filter((e) => p.passed.has(e.key)).length;
