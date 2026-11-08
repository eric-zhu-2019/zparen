import { describe, expect, it } from "vitest";
import { asdFile, definedName, lambdaVariables, lessonBranch, lessonPackage, LESSONS, parseLesson, passMessage, progress, sourceFile, startingFiles, startsProject, stubWithArguments, testFile, testId } from "./course";
import type { CourseState } from "../protocol/CourseState";
import { waitingLesson } from "./learn";

const LESSON = `---
title: Sample
level: beginner
reading: ANSI Common Lisp, 2.1
---
Some prose.

\`\`\`lisp
(+ 1 2)
\`\`\`

## Exercise: Double it

Define \`(double x)\`.

\`\`\`stub
(defun double (x)
  (not-written-yet 'double))
\`\`\`

\`\`\`hint
Multiply.
\`\`\`

\`\`\`solution
(defun double (x) (* 2 x))
\`\`\`

\`\`\`check
(is (equal 4 (double 2)))
\`\`\`
`;

const state = (s: Partial<CourseState>): CourseState => ({ branch: "main", git: true, dirty: false, merging: false, conflicts: [], branches: [], finished: [], passed: [], ...s });

describe("lessons", () => {
  it("parses prose, exercises and their blocks", () => {
    const l = parseLesson("04-sample", LESSON);
    expect(l).toMatchObject({ number: 4, title: "Sample", level: "beginner", reading: "ANSI Common Lisp, 2.1" });
    expect(l.body).toContain("```lisp\n(+ 1 2)\n```");
    expect(l.exercises).toHaveLength(1);
    const e = l.exercises[0];
    expect(e).toMatchObject({ key: "04/1", label: "4.1", title: "Double it", name: "double", hint: "Multiply.", prompt: "Define `(double x)`." });
    expect(e.check).toBe("(is (equal 4 (double 2)))");
  });

  it("rejects an exercise without a check", () => {
    expect(() => parseLesson("01-x", LESSON.replace(/```check[\s\S]*?```\n/, ""))).toThrow(/check/);
  });

  it("names exercises by what they define", () => {
    expect(definedName("(defstruct point x y)\n(defun point-distance (a b) nil)")).toBe("point-distance");
    expect(definedName("(defmacro while (test &body b) nil)")).toBe("while");
  });

  it("gives every exercise its own name in its package", () => {
    const names = LESSONS.flatMap((l) => l.exercises.map((e) => `${lessonPackage("c", l)} ${e.name}`));
    expect(new Set(names).size).toBe(names.length);
    expect(LESSONS.map((l) => l.number)).toEqual(LESSONS.map((_, i) => i + 1));
    expect(LESSONS.every((l) => l.exercises.length > 0)).toBe(true);
  });

  it("keeps the names provided code defines apart from every other lesson's in its package", () => {
    const defs = (code: string) => [...code.matchAll(/^\(def(?:un|macro|generic|struct|class|var|parameter|constant|ine-condition)\s+(\(setf\s+)?\(?([^\s()]+)/gim)].map((m) => `${m[1] ? "setf " : ""}${m[2].toLowerCase()}`);
    const names = LESSONS.flatMap((l) => [...defs(l.given ?? ""), ...l.exercises.map((e) => e.name)].map((n) => `${lessonPackage("c", l)} ${n}`));
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it("reads a project lesson's provided code and code to fix", () => {
    const project = `---
title: Cells
level: advanced
project: Spreadsheet
---
Prose.

\`\`\`given
(defstruct sheet cells)
\`\`\`

More prose.

## Exercise: Repair it

\`\`\`fix
(defun broken (x) (car x))
\`\`\`

\`\`\`solution
(defun broken (x) (first x))
\`\`\`

\`\`\`check
(is (eq 1 (broken '(1))))
\`\`\`
`;
    const l = parseLesson("16-cells", project);
    expect(l).toMatchObject({ project: "Spreadsheet", given: "(defstruct sheet cells)" });
    expect(l.body).toBe("Prose.\n\n\nMore prose.");
    expect(l.exercises[0]).toMatchObject({ name: "broken", fix: true, stub: "(defun broken (x) (car x))" });
    const src = sourceFile("learn-lisp", l);
    expect(src).toContain(";;; Provided code for the spreadsheet. Read it: the exercises below use it.");
    expect(src.indexOf("(defstruct sheet cells)")).toBeLessThan(src.indexOf(";;; Exercise 16.1: Repair it (fix this code)\n(defun broken (x) (car x))"));
    expect(() => parseLesson("16-cells", project.replace("```fix", "```stub\n(defun other ())\n```\n\n```fix"))).toThrow(/one stub or fix/);
  });
});

describe("course files", () => {
  const l = parseLesson("04-sample", LESSON);

  it("writes the lesson's stubs under its prompts", () => {
    const src = sourceFile("learn-lisp", l);
    expect(src).toContain("(in-package #:learn-lisp)");
    expect(src).toContain(";;; Exercise 4.1: Double it\n;;; Define (double x).\n(defun double (x)\n  (not-written-yet 'double x))");
  });

  it("writes a FiveAM test per exercise, with the checks qualified", () => {
    const tests = testFile("learn-lisp", l);
    expect(tests).toContain("(fiveam:def-suite lesson-04 :in course");
    expect(tests).toContain("(fiveam:test double\n  \"Exercise 4.1: Double it\"\n  (checking double\n    (fiveam:is (equal 4 (double 2)))))");
  });

  it("lists only the lessons reached in the system", () => {
    const asd = asdFile("learn-lisp", [LESSONS[0], LESSONS[1]]);
    expect(asd).toContain(`(:file "${LESSONS[1].id}")`);
    expect(asd).not.toContain(`(:file "${LESSONS[2].id}")`);
    expect(asd).toContain(`:depends-on ("learn-lisp" "fiveam")`);
  });

  it("starts a project with lesson 1 only", () => {
    const paths = startingFiles("learn-lisp").map((f) => f.path);
    expect(paths).toContain(`src/${LESSONS[0].id}.lisp`);
    expect(paths).toContain(`tests/${LESSONS[0].id}.lisp`);
    expect(paths.filter((p) => p.startsWith("src/")).length).toBe(3);
    expect(JSON.parse(startingFiles("my-course")[0].content)).toEqual({ version: 1, package: "my-course" });
  });

  it("passes a stub's variables on, so none is reported unused", () => {
    expect(stubWithArguments("(defun double (x)\n  (not-written-yet 'double))")).toBe("(defun double (x)\n  (not-written-yet 'double x))");
    expect(stubWithArguments("(defun f (a &optional (b 1) &key c)\n  (not-written-yet 'f))")).toContain("(not-written-yet 'f a b c)");
    expect(stubWithArguments("(defstruct point x y)\n(defun g ()\n  (not-written-yet 'g))")).toContain("(not-written-yet 'g))");
    expect(lambdaVariables("(list &rest more)")).toEqual(["list", "more"]);
    expect(stubWithArguments("(defmethod area ((s circle) scale)\n  (not-written-yet 'area))")).toContain("(not-written-yet 'area s scale)");
    expect(stubWithArguments("(defmacro my-while (test &body body)\n  (not-written-yet 'my-while))")).toContain("`(not-written-yet 'my-while ',test ',body)");
  });

  it("puts each project in a package of its own, made by its first lesson", () => {
    const [first, second] = LESSONS.filter((l) => l.project === "Query engine");
    expect(lessonPackage("learn-lisp", first)).toBe("learn-lisp.query-engine");
    expect(lessonPackage("learn-lisp", LESSONS[0])).toBe("learn-lisp");
    const src = sourceFile("learn-lisp", first);
    expect(src).toContain("(defpackage #:learn-lisp.query-engine\n  (:use #:cl)\n  (:import-from #:learn-lisp #:not-written-yet)");
    expect(src.indexOf("(defpackage")).toBeLessThan(src.indexOf("(in-package #:learn-lisp.query-engine)"));
    expect(sourceFile("learn-lisp", second)).not.toContain("(defpackage");
    expect(sourceFile("learn-lisp", second)).toContain("(in-package #:learn-lisp.query-engine)");
    const tests = testFile("learn-lisp", second);
    expect(tests).toContain("(in-package #:learn-lisp.query-engine)");
    expect(tests).toContain(`:in learn-lisp::course`);
    expect(tests).toContain(`(learn-lisp::checking ${second.exercises[0].name}`);
    expect(testId(lessonPackage("learn-lisp", second), second.exercises[0])).toBe(`LEARN-LISP.QUERY-ENGINE::${second.exercises[0].name.toUpperCase()}`);
  });

  it("marks a passing commit with the exercise's trailer", () => {
    expect(passMessage(l.exercises[0])).toBe("Pass 4.1: Double it\n\nExercise: 04/1");
  });
});

describe("progress", () => {
  const [one, two, three] = LESSONS;
  const files = (ls: typeof LESSONS) => ["package.lisp", "not-written.lisp", ...ls.map((l) => `${l.id}.lisp`)];

  it("reads finished lessons and passed exercises from git", () => {
    const p = progress(state({ branch: `lesson/${two.id}`, branches: [`lesson/${one.id}`, `lesson/${two.id}`], finished: ["01"], passed: ["01/1", "02/1"] }), files([one, two]));
    expect(p.reached).toEqual([one, two]);
    expect([...p.finished]).toEqual([one.id]);
    expect(p.passed.has("02/1")).toBe(true);
    expect(p.onLesson).toBe(two);
    expect(p.current).toBe(two);
  });

  it("offers a lesson an update brought once every lesson in the project is finished", () => {
    expect(waitingLesson(progress(state({ finished: ["01", "02"] }), files([one, two])))).toBe(three);
    expect(waitingLesson(progress(state({ finished: ["01"] }), files([one, two])))).toBeNull();
  });

  it("points at the lesson that arrived last once the one before is merged", () => {
    const p = progress(state({ finished: ["01", "02"] }), files([one, two, three]));
    expect(p.onLesson).toBeNull();
    expect(p.current).toBe(three);
  });

  it("goes on with a project started ahead of the lessons before it", () => {
    const [first, second] = LESSONS.filter((l) => l.project === "Spreadsheet");
    expect(startsProject(first)).toBe(true);
    expect(startsProject(second)).toBe(false);
    const branch = { branches: [lessonBranch(first)] };
    expect(progress(state({ ...branch, branch: lessonBranch(first) }), files([one, first])).current).toBe(first);
    expect(progress(state(branch), files([one, first])).current, "back on main, the lesson started").toBe(first);
    expect(progress(state({ ...branch, finished: [String(first.number)] }), files([one, first, second])).current, "then the one that arrived after it").toBe(second);
    expect(progress(state({}), files([one, first])).current, "with nothing started, the first").toBe(one);
  });
});
