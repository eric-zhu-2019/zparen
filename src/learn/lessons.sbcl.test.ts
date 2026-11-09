// Every lesson's tests, run by SBCL and FiveAM against three versions of the
// learner's files: the stubs, which must skip; wrong answers, which must fail;
// and the lessons' own solutions, which must pass. Every lesson loads into
// one Lisp, in order, so a project's later lessons run on its earlier ones.
// Code to fix is checked as a learner meets it: with every other exercise
// solved, it must fail. A project can be started on its own, so each project's
// solutions must also pass with only that project's lessons loaded. It is skipped on a Mac
// without SBCL, ocicl, or the network to fetch FiveAM once.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { asdFile, LESSONS, lessonPackage, lessonSource, lessonTests, notWrittenFile, packageFile, projectLessons, sourceFile, stubWithArguments, supportFile, testFile, type Lesson } from "./course";

const PKG = "learn-lisp";
const CACHE = join(process.cwd(), "node_modules/.cache/zparen-learn");
const CA_BUNDLES = ["/opt/homebrew/etc/ca-certificates/cert.pem", "/usr/local/etc/ca-certificates/cert.pem", "/etc/ssl/cert.pem"];

function has(program: string) {
  return spawnSync("which", [program]).status === 0;
}

/** A folder holding FiveAM and what it depends on, fetched with ocicl once. */
function fiveam(): string | null {
  const dir = join(CACHE, "ocicl");
  const ready = () => existsSync(dir) && readdirSync(dir).some((d) => d.startsWith("fiveam"));
  if (ready()) return dir;
  if (!has("ocicl") || !existsSync(join(homedir(), ".local/share/ocicl/ocicl-runtime.lisp"))) return null;
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(join(CACHE, "ocicl.csv"), "");
  const bundle = CA_BUNDLES.find((b) => existsSync(b));
  spawnSync("ocicl", ["install", "fiveam"], {
    cwd: CACHE,
    env: { ...process.env, ...(process.env.SSL_CERT_FILE || !bundle ? {} : { SSL_CERT_FILE: bundle }) },
    timeout: 120_000,
  });
  return ready() ? dir : null;
}

type Variant = "stub" | "wrong" | "solution" | "broken";

/** The stub with each NOT-WRITTEN-YET call answering NIL: a definition that exists but does nothing useful. */
function wrongAnswer(stub: string): string {
  return stubWithArguments(stub).replace(/\(not-written-yet\s+'[^()]*\)/g, "nil");
}

/** What the learner's file holds for exercise E in VARIANT. */
function answer(e: Lesson["exercises"][number], variant: Variant): string {
  if (variant === "solution" || (variant === "broken" && !e.fix)) return e.solution;
  return variant === "wrong" ? wrongAnswer(e.stub) : e.stub;
}

function writeProject(root: string, variant: Variant, lessons: Lesson[]) {
  const files: [string, string][] = [
    [`${PKG}.asd`, asdFile(PKG, lessons)],
    ["src/package.lisp", packageFile(PKG)],
    ["src/not-written.lisp", notWrittenFile(PKG)],
    ["tests/support.lisp", supportFile(PKG)],
  ];
  for (const l of lessons) {
    const answered: Lesson = {
      ...l,
      exercises: l.exercises.map((e) => ({ ...e, stub: answer(e, variant) })),
    };
    files.push([lessonSource(l), sourceFile(PKG, answered)], [lessonTests(l), testFile(PKG, l)]);
  }
  for (const [path, content] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

const RUN = `
(let ((by-name (make-hash-table :test 'equal)))
  (dolist (r (fiveam:run (find-symbol "COURSE" "LEARN-LISP")))
    (let ((name (let ((s (fiveam::name (fiveam::test-case r))))
                  (string-downcase (format nil "~a::~a" (package-name (symbol-package s)) (symbol-name s)))))
          (kind (typecase r
                  (fiveam::test-failure :failed)
                  (fiveam::test-skipped :skipped)
                  (fiveam::test-passed :passed))))
      (push (cons kind (ignore-errors (fiveam::reason r))) (gethash name by-name))))
  (maphash (lambda (name results)
             (let ((kinds (mapcar #'car results)))
               (format t "~&RESULT ~a ~(~a~) ~s~%" name
                       (cond ((member :failed kinds) :failed)
                             ((member :passed kinds) :passed)
                             (t :skipped))
                       (cdr (find :failed results :key #'car)))))
           by-name))`;

/** How RUN names exercise E's test: its package and name. */
const key = (l: Lesson, e: Lesson["exercises"][number]) => `${lessonPackage(PKG, l)}::${e.name}`;

/** Each exercise's test, as KEY names it, and its outcome, with why it failed. */
function run(variant: Variant, ocicl: string, lessons = LESSONS): Map<string, { status: string; reason: string }> {
  const root = mkdtempSync(join(tmpdir(), `zparen-learn-${variant}-`));
  try {
    writeProject(root, variant, lessons);
    const forms = [
      "(require :asdf)",
      `(asdf:initialize-source-registry '(:source-registry (:tree ${JSON.stringify(ocicl + "/")}) (:directory ${JSON.stringify(root + "/")}) :ignore-inherited-configuration))`,
      `(handler-bind ((warning #'muffle-warning)) (asdf:load-system "${PKG}/tests"))`,
      RUN,
    ];
    const out = execFileSync("sbcl", ["--noinform", "--non-interactive", "--no-userinit", ...forms.flatMap((f) => ["--eval", f])], {
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const results = new Map<string, { status: string; reason: string }>();
    for (const m of out.matchAll(/^RESULT (\S+) (\S+) (.*)$/gm)) results.set(m[1], { status: m[2], reason: m[3] });
    return results;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const ocicl = has("sbcl") ? fiveam() : null;

describe.skipIf(!ocicl)("every lesson, run by SBCL and FiveAM", () => {
  const exercises = LESSONS.flatMap((l) => l.exercises.map((e) => ({ lesson: l, e })));

  const names: Record<Variant, string> = {
    stub: "skips the stubs",
    wrong: "fails wrong answers",
    solution: "passes the solutions",
    broken: "fails code to fix, with every other exercise solved",
  };
  /** What exercise E's test must report in VARIANT. Code to fix may meet an earlier lesson's stub in the stub run. */
  const want = (e: Lesson["exercises"][number], variant: Variant): string[] =>
    ({
      stub: e.fix ? ["skipped", "failed"] : ["skipped"],
      wrong: ["failed"],
      solution: ["passed"],
      broken: [e.fix ? "failed" : "passed"],
    })[variant];
  for (const variant of ["stub", "wrong", "solution", "broken"] as const) {
    it(names[variant], () => {
      const results = run(variant, ocicl!);
      const wrong = exercises
        .map(({ lesson, e }) => ({ where: `${lesson.id} ${e.label} ${e.name}`, want: want(e, variant), got: results.get(key(lesson, e)) }))
        .filter((r) => !r.got || !r.want.includes(r.got.status))
        .map((r) => `${r.where}: ${r.got ? `${r.got.status} ${r.got.reason}` : "did not run"}`);
      expect(wrong).toEqual([]);
    }, 240_000);
  }

  const projects = [...new Set(LESSONS.map((l) => l.project).filter((p): p is string => !!p))];
  for (const project of projects) {
    it(`passes the ${project.toLowerCase()} project's solutions with only its own lessons`, () => {
      const lessons = projectLessons(LESSONS.find((l) => l.project === project)!);
      const results = run("solution", ocicl!, lessons);
      const wrong = lessons
        .flatMap((l) => l.exercises.map((e) => ({ where: `${l.id} ${e.label} ${e.name}`, got: results.get(key(l, e)) })))
        .filter((r) => r.got?.status !== "passed")
        .map((r) => `${r.where}: ${r.got ? `${r.got.status} ${r.got.reason}` : "did not run"}`);
      expect(wrong).toEqual([]);
    }, 240_000);
  }
});
