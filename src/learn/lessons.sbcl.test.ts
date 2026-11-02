// Every lesson's tests, run by SBCL and FiveAM against three versions of the
// learner's files: the stubs, which must skip; wrong answers, which must fail;
// and the lessons' own solutions, which must pass. It is skipped on a Mac
// without SBCL, ocicl, or the network to fetch FiveAM once.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { asdFile, LESSONS, lessonSource, lessonTests, notWrittenFile, packageFile, sourceFile, supportFile, testFile, type Lesson } from "./course";

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

type Variant = "stub" | "wrong" | "solution";

function wrongAnswer(stub: string): string {
  const m = /\(\s*(defun|defmacro)\s+([^\s()]+)/i.exec(stub)!;
  return `(${m[1]} ${m[2]} (&rest args)\n  (declare (ignore args))\n  nil)`;
}

function writeProject(root: string, variant: Variant) {
  const files: [string, string][] = [
    [`${PKG}.asd`, asdFile(PKG, LESSONS)],
    ["src/package.lisp", packageFile(PKG)],
    ["src/not-written.lisp", notWrittenFile(PKG)],
    ["tests/support.lisp", supportFile(PKG)],
  ];
  for (const l of LESSONS) {
    const answered: Lesson = {
      ...l,
      exercises: l.exercises.map((e) => ({ ...e, stub: variant === "solution" ? e.solution : variant === "wrong" ? wrongAnswer(e.stub) : e.stub })),
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
    (let ((name (string-downcase (symbol-name (fiveam::name (fiveam::test-case r)))))
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

/** Each exercise's test name and outcome, with why it failed. */
function run(variant: Variant, ocicl: string): Map<string, { status: string; reason: string }> {
  const root = mkdtempSync(join(tmpdir(), `zparen-learn-${variant}-`));
  try {
    writeProject(root, variant);
    const forms = [
      "(require :asdf)",
      `(asdf:initialize-source-registry '(:source-registry (:tree ${JSON.stringify(ocicl + "/")}) (:directory ${JSON.stringify(root + "/")}) :ignore-inherited-configuration))`,
      `(handler-bind ((warning #'muffle-warning)) (asdf:load-system "${PKG}/tests"))`,
      RUN,
    ];
    const out = execFileSync("sbcl", ["--noinform", "--non-interactive", "--no-userinit", ...forms.flatMap((f) => ["--eval", f])], {
      encoding: "utf8",
      timeout: 180_000,
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

  for (const variant of ["stub", "wrong", "solution"] as const) {
    const want = { stub: "skipped", wrong: "failed", solution: "passed" }[variant];
    it(`${variant === "stub" ? "skips the stubs" : variant === "wrong" ? "fails wrong answers" : "passes the solutions"}`, () => {
      const results = run(variant, ocicl!);
      const wrong = exercises
        .map(({ lesson, e }) => ({ where: `${lesson.id} ${e.label} ${e.name}`, got: results.get(e.name) }))
        .filter((r) => r.got?.status !== want)
        .map((r) => `${r.where}: ${r.got ? `${r.got.status} ${r.got.reason}` : "did not run"}`);
      expect(wrong).toEqual([]);
    }, 240_000);
  }
});
