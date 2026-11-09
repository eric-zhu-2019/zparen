// The Learn panel's state and the steps it takes: starting, checking and
// finishing lessons in a course project, with git as the record of progress.

import { create } from "zustand";
import * as actions from "../actions";
import { backend } from "../backend";
import type { CourseGitOp } from "../protocol/CourseGitOp";
import type { CourseGitReply } from "../protocol/CourseGitReply";
import type { CourseState } from "../protocol/CourseState";
import type { TestNode } from "../protocol/TestNode";
import { recentProjects } from "../platform";
import { get as getApp, set as setApp, useStore as useApp } from "../store";
import {
  addMessage,
  asdFile,
  finishMessage,
  type Exercise,
  type Lesson,
  lessonBranch,
  lessonDone,
  lessonPackage,
  lessonSource,
  lessonTests,
  LESSONS,
  passMessage,
  progress,
  progressMessage,
  sourceFile,
  startingFiles,
  testFile,
  testId,
} from "./course";

export type CheckResult = { status: "passed" | "failed" | "skipped" | "error"; message: string };

type LearnState = {
  /** The open project's course, null when it is not a course project, undefined until known. */
  course: { root: string; pkg: string } | null | undefined;
  git: CourseState | null;
  /** The lesson files in src/, by name. */
  sources: string[];
  /** The lesson shown, or null for the course outline. */
  lesson: string | null;
  results: Record<string, CheckResult>;
  /** The exercise being checked. */
  checking: string | null;
  /** What the panel is doing, such as starting a lesson. */
  busy: string | null;
  notice: { tone: "error" | "info"; text: string } | null;
  /** The lesson whose files the last Finish Lesson added. */
  arrived: string | null;
  /** Hints and solutions shown, by exercise key and kind. */
  shown: Record<string, boolean>;
  /** The lesson the assistant was asked about, for its Back to Lesson button. */
  askedFrom: string | null;
};

export const useLearn = create<LearnState>(() => ({
  course: undefined,
  git: null,
  sources: [],
  lesson: null,
  results: {},
  checking: null,
  busy: null,
  notice: null,
  arrived: null,
  shown: {},
  askedFrom: null,
}));

const set = useLearn.setState;
const get = useLearn.getState;

const VIEW_KEY = "zparen.learn.lesson";

function rememberView(lesson: string | null) {
  try {
    const root = get().course?.root;
    if (root) localStorage.setItem(`${VIEW_KEY}:${root}`, lesson ?? "");
  } catch {
    // The panel just opens on the course outline.
  }
}

function savedView(root: string): string | null {
  try {
    return localStorage.getItem(`${VIEW_KEY}:${root}`) || null;
  } catch {
    return null;
  }
}

export function showLesson(id: string | null) {
  set({ lesson: id, notice: null });
  rememberView(id);
}

export const toggleShown = (key: string) => set((s) => ({ shown: { ...s.shown, [key]: !s.shown[key] } }));

export const currentProgress = () => progress(get().git ?? { branch: null, git: false, dirty: false, merging: false, conflicts: [], branches: [], finished: [], passed: [] }, get().sources);

const path = (rel: string) => `${get().course!.root}/${rel}`;

async function git(op: CourseGitOp): Promise<CourseGitReply> {
  const r = await actions.request({ type: "courseGit", op });
  if (r.type !== "courseGit") throw new Error("git did not answer");
  return r.reply;
}

/** Reads which project is open, whether it is a course, and its progress from git. */
export async function refreshCourse() {
  const project = getApp().status.project;
  if (!project) return set({ course: null, git: null, sources: [] });
  // Most projects have no marker, so a failed read is an answer, not an error for the REPL.
  const marker = await backend.request({ type: "readFile", path: `${project.root}/.zparen-course` }).catch(() => null);
  if (marker?.type !== "file") return set({ course: null, git: null, sources: [] });
  let pkg = project.name;
  try {
    pkg = JSON.parse(marker.content).package ?? pkg;
  } catch {
    // An older or hand-made marker: the package is named after the project.
  }
  const changed = get().course?.root !== project.root;
  set({ course: { root: project.root, pkg } });
  if (changed) set({ lesson: savedView(project.root), results: {}, shown: {}, arrived: null, notice: null });
  const [reply, entries] = await Promise.all([git({ op: "state" }).catch(() => null), actions.listDir(`${project.root}/src`)]);
  set({ git: reply?.kind === "state" ? reply : null, sources: entries.filter((e) => !e.isDir).map((e) => e.name) });
}

/** Runs STEP with the panel showing LABEL, reporting what went wrong in the panel. */
async function busy(label: string, step: () => Promise<void>) {
  if (get().busy) return;
  set({ busy: label, notice: null });
  try {
    await step();
  } catch (e) {
    set({ notice: { tone: "error", text: String(e instanceof Error ? e.message : e) } });
  } finally {
    set({ busy: null });
    await refreshCourse();
  }
}

/** Open tabs follow the files a branch switch changed. */
const followDisk = () => actions.syncWithDisk(getApp().tabs.map((t) => t.path));

/**
 * Loads the course's systems, tests included, into the image. ASDF compiles
 * what changed; a file that does not compile is reported, not debugged.
 */
async function loadCourse(): Promise<string | null> {
  const { pkg } = get().course!;
  // ASDF counts write dates in whole seconds, so a lesson file changed in the
  // second its fasl was written would load that fasl, with the old definitions.
  const form = `(handler-case (progn (zparen::drop-unsure-fasls "${pkg}/tests") (asdf:load-system "${pkg}/tests") :ok)
  (error (e) (format t "~a" e) :failed))`;
  const r = await actions.lisp({ op: "eval", form, package: "COMMON-LISP-USER" });
  if (r.kind !== "evaluated") return "Lisp did not answer.";
  // A project's first lesson brings a package, which the title bar lists.
  await actions.refreshPackages().catch(() => {});
  return r.value.trim() === ":OK" ? null : r.output.trim() || "The course did not load.";
}

/**
 * Before leaving the branch checked out: saves open files and commits what is
 * left on a course branch, so switching never loses work.
 */
async function leaveBranch(to: string): Promise<boolean> {
  await actions.saveAll();
  const state = get().git;
  if (!state?.git) throw new Error("Progress needs git. macOS offers to install it the first time git runs.");
  const branch = state.branch;
  if (branch && branch !== "main" && !branch.startsWith("lesson/")) {
    const go = await new Promise<boolean>((resolve) =>
      actions.ask(`Switch to ${to}?`, `You are on ${branch}. Your work there is kept.`, [
        { label: "Switch", kind: "primary", run: () => resolve(true) },
        { label: "Cancel", run: () => resolve(false) },
      ]),
    );
    if (!go) return false;
  }
  const fresh = await git({ op: "state" });
  if (fresh.kind === "state" && fresh.dirty && (fresh.branch === "main" || fresh.branch?.startsWith("lesson/"))) {
    const lesson = LESSONS.find((l) => fresh.branch === lessonBranch(l));
    await git({ op: "commit", message: lesson ? progressMessage(lesson) : "Work in progress", paths: [], allowEmpty: false });
  }
  return true;
}

export function startLesson(l: Lesson) {
  return busy(`Starting lesson ${l.number}…`, () => enterLesson(l));
}

/**
 * The package lesson L's code is in, as the running Lisp has it: the
 * project's own, or else the course's, where a project lesson written before
 * projects had packages is. Null when the course is not loaded. Asking the
 * REPL for a package it lacks stops it in the debugger, so callers ask this first.
 */
function loadedPackage(l: Lesson | null): string | null {
  const course = get().course;
  if (!course) return null;
  const have = new Set(getApp().packages.map((p) => p.toLowerCase()));
  const own = l ? lessonPackage(course.pkg, l) : course.pkg;
  return have.has(own) ? own : have.has(course.pkg) ? course.pkg : null;
}

/** Sets the REPL to lesson L's package, when the running Lisp has it. */
async function useLessonPackage(l: Lesson | null) {
  const name = loadedPackage(l);
  if (name) await actions.setPackage(name.toUpperCase()).catch(() => {});
}

/**
 * Sets the REPL to lesson L's package once Lisp is ready, as Start Lesson
 * does. A new session has not loaded the course, so this loads it first.
 */
export function followLesson(l: Lesson) {
  const root = getApp().status.project?.root;
  const go = async () => {
    const course = get().course;
    if (!course || getApp().status.project?.root !== root) return;
    if (loadedPackage(l) !== lessonPackage(course.pkg, l)) await loadCourse().catch(() => null);
    await useLessonPackage(l);
  };
  if (getApp().status.session.state === "ready") return void go();
  const stop = useApp.subscribe((s) => {
    if (s.status.project?.root !== root) return stop();
    if (s.status.session.state !== "ready") return;
    stop();
    void go();
  });
}

/** Checks out the lesson's branch, made from main when new, then opens its file and loads the course. */
async function enterLesson(l: Lesson) {
  const branch = lessonBranch(l);
  if (get().git?.branch !== branch) {
    if (!(await leaveBranch(branch))) return;
    await git({ op: "switch", branch, create: !get().git?.branches.includes(branch) });
    await followDisk();
  }
  showLesson(l.id);
  await actions.openFile(path(lessonSource(l)));
  const failed = await loadCourse();
  if (failed) set({ notice: { tone: "error", text: `The course did not load: ${failed}` } });
  else await useLessonPackage(l);
}

/**
 * Starts a project at its first lesson, without the lessons before it: adds the
 * lesson's files on main, then starts it. Lessons before it stay where they are.
 */
export function startProject(first: Lesson) {
  return busy(`Starting the ${first.project?.toLowerCase()} project…`, async () => {
    if (get().git?.branch !== "main") {
      if (!(await leaveBranch("main"))) return;
      await git({ op: "switch", branch: "main", create: false });
      await followDisk();
    }
    await addLesson(first);
    await refreshCourse();
    await enterLesson(first);
  });
}

/** Opens the lesson in progress, starting it if its branch is not checked out. */
export function continueCourse() {
  const p = currentProgress();
  if (!p.current) return;
  if (p.onLesson?.id === p.current.id) {
    showLesson(p.current.id);
    followLesson(p.current);
    return void actions.openFile(path(lessonSource(p.current)));
  }
  return startLesson(p.current);
}

function findTest(nodes: TestNode[], name: string): TestNode | null {
  for (const n of nodes) {
    if (n.kind === "test" && n.name.toLowerCase() === name) return n;
    const inner = findTest(n.children, name);
    if (inner) return inner;
  }
  return null;
}

/** Why a test failed or was skipped, from its checks. */
function reasons(n: TestNode): string {
  const own = n.message ? [n.message] : [];
  const checks = n.children.filter((c) => c.status === n.status && c.message).map((c) => c.message!);
  return [...own, ...checks].join("\n\n").trim();
}

/** Where the running Lisp has NAME defined, when that is not the lesson's file, for the learner. */
async function definedElsewhere(l: Lesson, name: string, pkg: string): Promise<string> {
  const op = { op: "findDefinitions" as const, name, package: pkg.toUpperCase() };
  const r = await backend.request({ type: "lisp", op }).catch(() => null);
  if (r?.type !== "lisp" || r.reply.kind !== "definitions" || !r.reply.items.length) return "";
  const file = lessonSource(l);
  const files = r.reply.items.map((d) => d.location?.file ?? null);
  if (files.some((f) => f?.endsWith(`/${file}`))) return `${name} is in ${file}. Something it uses may be defined only in your Lisp, for example in the REPL.`;
  const others = [...new Set(files.filter((f): f is string => !!f).map((f) => f.split("/").pop()))];
  return others.length ? `Your Lisp has ${name} from ${others.join(", ")}, not from ${file}.` : `Your Lisp has ${name} from the REPL, not from ${file}.`;
}

/**
 * Runs the exercise's test again in a new Lisp that has only the project's
 * files, so that a definition only the running Lisp has, such as one typed in
 * the REPL or since deleted from the file, cannot pass it. Null when it passes there too.
 */
async function fromFilesAlone(l: Lesson, e: Exercise, pkg: string, inPackage: string): Promise<CheckResult | null> {
  const tests = [{ framework: "fiveam", id: testId(inPackage, e) }];
  let nodes: TestNode[];
  try {
    const r = await backend.request({ type: "cleanTests", system: `${pkg}/tests`, tests });
    if (r.type !== "lisp" || r.reply.kind !== "tests") return { status: "error", message: "The check from your files alone did not run." };
    nodes = r.reply.tests;
  } catch (err) {
    const why = String(err instanceof Error ? err.message : err);
    return { status: "error", message: `Your Lisp passes the test, but a new Lisp could not load your files:\n${why}` };
  }
  const node = findTest(nodes, e.name);
  if (node?.status === "passed") return null;
  const lines = [
    "Your Lisp passes the test, but a new Lisp with only your files does not, so the pass is not recorded.",
    await definedElsewhere(l, e.name, inPackage),
    node ? reasons(node) : `No test named ${e.name} ran there.`,
  ];
  return { status: "failed", message: lines.filter(Boolean).join("\n\n") };
}

/** Saves the lesson's file, loads it, runs the exercise's test, and commits a pass that the files alone also give. */
export async function check(l: Lesson, e: Exercise) {
  if (get().checking || get().busy) return;
  const { pkg } = get().course!;
  set({ checking: e.key, notice: null });
  const result = (r: CheckResult) => set((s) => ({ results: { ...s.results, [e.key]: r } }));
  try {
    const file = path(lessonSource(l));
    const tab = getApp().tabs.find((t) => t.path === file);
    if (tab && tab.text !== tab.saved) await actions.saveTab(file, { compileChanges: false });
    const failed = await loadCourse();
    // ASDF tells changes by write dates in whole seconds, so an edit saved just
    // after the last load could be skipped: the lesson's file is always compiled.
    // Its notes show in Problems, at the line they are about.
    const compiled = await actions.compileFile(file);
    if (failed || !compiled) {
      return result({ status: "error", message: `Your file did not compile.${failed ? `\n${failed}` : ""}\nProblems shows where.` });
    }
    const inPackage = loadedPackage(l) ?? lessonPackage(pkg, l);
    const r = await actions.lisp({ op: "rerunTests", tests: [{ framework: "fiveam", id: testId(inPackage, e) }] });
    if (r.kind !== "tests") return result({ status: "error", message: "The test did not run." });
    setApp({ tests: { system: `${pkg}/tests`, run: r } });
    const node = findTest(r.tests, e.name);
    if (!node) return result({ status: "error", message: `No test named ${e.name} ran.` });
    const message = reasons(node);
    if (node.status === "passed") {
      const unclean = await fromFilesAlone(l, e, pkg, inPackage);
      if (unclean) return result(unclean);
      // A pass is recorded once, even when an earlier pass already committed this code.
      await git({ op: "commit", message: passMessage(e), paths: [lessonSource(l)], allowEmpty: !currentProgress().passed.has(e.key) });
      result({ status: "passed", message: "" });
    } else result({ status: node.status, message: message || (node.status === "skipped" ? `${e.name} is not written yet.` : "A check failed.") });
  } catch (err) {
    result({ status: "error", message: String(err instanceof Error ? err.message : err) });
  } finally {
    set({ checking: null });
    await refreshCourse();
  }
}

/** Merges the lesson into main, then adds the next lesson's files there. */
export function finishLesson(l: Lesson) {
  return busy(`Finishing lesson ${l.number}…`, async () => {
    if (!(await leaveBranch("main"))) return;
    await git({ op: "switch", branch: "main", create: false });
    try {
      await git({ op: "merge", branch: lessonBranch(l), message: finishMessage(l) });
    } finally {
      await followDisk();
    }
    const next = LESSONS[LESSONS.indexOf(l) + 1];
    if (next) await addLesson(next);
    const failed = await loadCourse();
    if (failed) set({ notice: { tone: "error", text: `The course did not load: ${failed}` } });
  });
}

/** Writes a lesson's files on main, lists it in the system, and commits it; nothing when it is there. */
async function addLesson(next: Lesson) {
  const { pkg } = get().course!;
  const files = (await actions.listDir(path("src"))).map((e) => e.name);
  if (files.includes(`${next.id}.lisp`)) return;
  const reached = LESSONS.filter((x) => files.includes(`${x.id}.lisp`) || x === next);
  const writes: [string, string][] = [
    [lessonSource(next), sourceFile(pkg, next)],
    [lessonTests(next), testFile(pkg, next)],
    [`${pkg}.asd`, asdFile(pkg, reached)],
  ];
  for (const [rel, content] of writes) await actions.request({ type: "writeFile", path: path(rel), content });
  await git({ op: "commit", message: addMessage(next), paths: writes.map(([rel]) => rel), allowEmpty: false });
  await followDisk();
  set({ arrived: next.id });
}

/** The lesson a newer ZParen brought, for a learner who finished every lesson the project has. */
export function waitingLesson(p: ReturnType<typeof currentProgress>): Lesson | null {
  if (p.current || !p.reached.length || !p.reached.every((l) => p.finished.has(l.id))) return null;
  return LESSONS.find((l) => !p.reached.includes(l)) ?? null;
}

/** Adds the lesson an update brought, on main, and opens it. */
export function addWaitingLesson(next: Lesson) {
  return busy(`Adding lesson ${next.number}…`, async () => {
    if (get().git?.branch !== "main") {
      if (!(await leaveBranch("main"))) return;
      await git({ op: "switch", branch: "main", create: false });
      await followDisk();
    }
    await addLesson(next);
    showLesson(next.id);
    const failed = await loadCourse();
    if (failed) set({ notice: { tone: "error", text: `The course did not load: ${failed}` } });
  });
}

export const abortMerge = () => busy("Aborting the merge…", async () => void (await git({ op: "abortMerge" })));

/** The course's git history as a graph, in the Output panel. */
export async function showHistory() {
  try {
    const r = await git({ op: "log" });
    if (r.kind !== "log") return;
    const name = "course history";
    setApp((s) => ({ tasks: { ...s.tasks, [name]: { output: r.text, running: false, ok: true } }, activeTask: name, bottom: "output" }));
  } catch (e) {
    set({ notice: { tone: "error", text: String(e instanceof Error ? e.message : e) } });
  }
}

/**
 * Runs an example in the REPL, in the package of the lesson shown. A project
 * not started yet has no package, so its examples run in the course's.
 */
export async function runExample(code: string) {
  const course = get().course;
  if (course) {
    const shown = LESSONS.find((l) => l.id === get().lesson) ?? null;
    if (loadedPackage(shown) !== (shown ? lessonPackage(course.pkg, shown) : course.pkg)) await loadCourse();
    await useLessonPackage(shown);
  }
  await actions.replEval(code);
}

/** Opens the lesson's file at the exercise's definition. */
export async function goToCode(l: Lesson, e: Exercise) {
  const file = path(lessonSource(l));
  if (!(await actions.navigate(file))) return;
  const text = getApp().tabs.find((t) => t.path === file)?.text ?? "";
  const at = text.search(new RegExp(`\\(def(?:un|macro|generic)\\s+${e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s)]`, "i"));
  if (at >= 0) await actions.navigate(file, at);
}

/** Asks the assistant for a hint, with the exercise and what its check said. */
export async function askForHint(l: Lesson, e: Exercise) {
  if (getApp().chatBusy) return;
  const { pkg } = get().course!;
  const file = path(lessonSource(l));
  const last = get().results[e.key];
  const text = [
    `I'm working through ZParen's Lisp course, lesson ${l.number} (${l.title}), exercise ${e.label}: "${e.title}".`,
    `The task: ${e.prompt}`,
    last && last.status !== "passed" ? `The last check said:\n${last.message}` : "",
    `My answer is the definition of ${e.name} in ${lessonSource(l)}, and its FiveAM test is in ${lessonTests(l)}.`,
    "Please give me a hint, not the answer. Read my code and the test with your tools, and point me at what to think about next.",
  ]
    .filter(Boolean)
    .join("\n\n");
  set({ askedFrom: l.id });
  setApp({ right: "assistant" });
  await actions.saveAll();
  await actions.askAssistant(text, { file, package: (loadedPackage(l) ?? lessonPackage(pkg, l)).toUpperCase(), form: null });
}

/** Leaves the assistant for the lesson it was asked about. */
export function backToLesson() {
  const id = get().askedFrom;
  set({ askedFrom: null });
  if (id) showLesson(id);
  setApp({ right: "learn" });
}

/** The most recent project that is a course, and whether it has finished every lesson in the course; null when there is none. */
export async function findCourse(): Promise<{ root: string; done: boolean } | null> {
  for (const root of recentProjects()) {
    const r = await backend.request({ type: "courseState", root }).catch(() => null);
    if (r?.type !== "courseGit" || r.reply.kind !== "state") continue;
    const p = progress(r.reply, []);
    return { root, done: LESSONS.every((l) => lessonDone(p, l)) };
  }
  return null;
}

/** Opens the course project at ROOT where the learner left it, without starting a lesson. */
export async function openCourse(root: string) {
  if (getApp().status.project?.root !== root) {
    if (!(await actions.leaveProject())) return;
    await actions.openProject(root);
  }
  setApp({ right: "learn" });
  await refreshCourse();
  const lesson = currentProgress().onLesson;
  if (lesson) {
    followLesson(lesson);
    await actions.openFile(path(lessonSource(lesson)));
  }
}

/** Makes a course project, opens it, and shows the course. */
export async function createCourse(parent: string, name: string): Promise<boolean> {
  if (!(await actions.leaveProject())) return false;
  const r = await actions.request({ type: "newCourse", parent, name, files: startingFiles(name) });
  if (r.type !== "project") return false;
  await actions.adoptNewProject(r.project.root, lessonSource(LESSONS[0]));
  setApp({ right: "learn" });
  await refreshCourse();
  showLesson(null);
  return true;
}

export function toggleLearn() {
  setApp({ right: getApp().right === "learn" ? null : "learn" });
}
