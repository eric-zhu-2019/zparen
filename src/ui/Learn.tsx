import { Marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Exercise, exercisesPassed, type Lesson, lessonBranch, lessonDone, lessonSource, LESSONS, LEVELS, type Progress, progress } from "../learn/course";
import { escapeHtml, highlightLispHtml } from "../editor/lispSyntax";
import {
  abortMerge,
  addWaitingLesson,
  waitingLesson,
  askForHint,
  check,
  continueCourse,
  findCourse,
  finishLesson,
  goToCode,
  openCourse,
  refreshCourse,
  runExample,
  showHistory,
  showLesson,
  startLesson,
  toggleShown,
  useLearn,
} from "../learn/learn";
import { openExternal } from "../platform";
import { set, useStore } from "../store";
import * as actions from "../actions";
import { Icon } from "./Icon";

const ON_LISP = "https://paulgraham.com/onlisp.html";

/** Markdown for lesson text. Lisp blocks get Run and Copy, and HTML in a lesson is shown as text. */
function renderProse(md: string): { html: string; codes: string[] } {
  const codes: string[] = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      html: ({ text }) => escapeHtml(text),
      code: ({ text, lang }) => {
        if (lang && lang !== "lisp") return `<pre class="learn-plain">${escapeHtml(text)}</pre>`;
        const i = codes.push(text) - 1;
        return `<div class="learn-code" tabindex="0" data-code="${i}"><div class="learn-code-actions">
<button class="btn" data-copy="${i}" title="Copy the code">Copy</button>
<button class="btn" data-run="${i}" title="Run it in the REPL (⌘↩)">Run <kbd>⌘↩</kbd></button></div><pre>${highlightLispHtml(text)}</pre></div>`;
      },
    },
  });
  return { html: marked.parse(md) as string, codes };
}

const inline = new Marked({ gfm: true, renderer: { html: ({ text }) => escapeHtml(text) } });

function Prose({ md, className = "learn-prose" }: { md: string; className?: string }) {
  const { html, codes } = useMemo(() => renderProse(md), [md]);
  return (
    <div
      className={className}
      onClick={(e) => {
        const el = e.target instanceof Element ? e.target.closest("[data-run], [data-copy], a") : null;
        if (!el) return;
        e.preventDefault();
        if (el.hasAttribute("data-run")) void runExample(codes[Number(el.getAttribute("data-run"))]);
        else if (el.hasAttribute("data-copy")) void navigator.clipboard.writeText(codes[Number(el.getAttribute("data-copy"))]).then(() => actions.flash("Copied"));
        else if (/^https?:/.test(el.getAttribute("href") ?? "")) void openExternal(el.getAttribute("href")!);
      }}
      onKeyDown={(e) => {
        const block = e.target instanceof Element ? e.target.closest("[data-code]") : null;
        if (block && e.key === "Enter" && e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          void runExample(codes[Number(block.getAttribute("data-code"))]);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function useCourseProgress(): Progress {
  const git = useLearn((s) => s.git);
  const sources = useLearn((s) => s.sources);
  return useMemo(
    () => progress(git ?? { branch: null, git: false, dirty: false, merging: false, conflicts: [], branches: [], finished: [], passed: [] }, sources),
    [git, sources],
  );
}

function Menu({ onClose, lesson }: { onClose: () => void; lesson: Lesson | null }) {
  const course = useLearn((s) => s.course);
  const item = (label: string, run: () => unknown) => (
    <button role="menuitem" onClick={() => (onClose(), void run())}>
      {label}
    </button>
  );
  return (
    <div className="learn-menu" role="menu" onMouseLeave={onClose}>
      {course && item("Show Course History", showHistory)}
      {course && lesson && item("Open the Lesson's File", () => actions.navigate(`${course.root}/${lessonSource(lesson)}`))}
      {course && item("Open README", () => actions.navigate(`${course.root}/README.md`))}
      {item("Read On Lisp Online", () => openExternal(ON_LISP))}
    </div>
  );
}

function NotCourse() {
  const [found, setFound] = useState<string | null>(null);
  useEffect(() => void findCourse().then((c) => setFound(c?.root ?? null)), []);
  return (
    <div className="learn-body">
      <div className="learn-box">
        <p>
          <strong>The course runs in a course project of its own</strong>, so it never touches this one.
        </p>
        {found ? (
          <p className="learn-dim">Your course is in {found.split("/").pop()}. Continue opens it where you stopped.</p>
        ) : (
          <p className="learn-dim">A course project has a file for each lesson, FiveAM tests, and a git branch per lesson that records your progress.</p>
        )}
        <div>
          {found ? (
            <button className="btn primary" onClick={() => void openCourse(found)} title={found}>
              Continue Learning Lisp
            </button>
          ) : (
            <button className="btn primary" onClick={() => set({ newProject: "course" })}>
              New Course Project…
            </button>
          )}
        </div>
      </div>
      <Outline p={null} />
    </div>
  );
}

function Outline({ p }: { p: Progress | null }) {
  return (
    <>
      {LEVELS.map((level) => {
        const lessons = LESSONS.filter((l) => l.level === level.id);
        const done = p ? lessons.filter((l) => lessonDone(p, l)).length : 0;
        return (
          <section key={level.id} className="learn-level" aria-label={level.title}>
            <div className="learn-level-head">
              {level.title} <span className="learn-dim">{level.reading}</span>
              <span className="learn-count">{lessons.length ? (p ? `${done} of ${lessons.length}` : "") : "Arrives in a later update"}</span>
            </div>
            {lessons.map((l) => (
              <LessonRow key={l.id} l={l} p={p} />
            ))}
          </section>
        );
      })}
    </>
  );
}

function LessonRow({ l, p }: { l: Lesson; p: Progress | null }) {
  const reached = !p || p.reached.includes(l);
  const done = p && lessonDone(p, l);
  const here = p?.onLesson?.id === l.id;
  const passed = p ? exercisesPassed(p, l) : 0;
  const before = LESSONS[LESSONS.indexOf(l) - 1];
  return (
    <button className={`learn-row ${here && !done ? "current" : ""} ${reached ? "" : "ahead"}`} onClick={() => showLesson(l.id)}>
      <span className="learn-mark" aria-hidden>
        {done ? "✓" : passed > 0 || here ? "◐" : ""}
      </span>
      <span className="learn-num">{l.number}</span>
      <span className="learn-row-title">{l.title}</span>
      <span className="learn-row-state">
        {!p ? "" : done ? "Finished" : !reached ? <span title={`Arrives when lesson ${before?.number} is finished`}>after {before?.number}</span> : passed ? `${passed}/${l.exercises.length}` : ""}
        {here && <span title={`You are on ${lessonBranch(l)}`}> ⎇</span>}
      </span>
    </button>
  );
}

function CourseView() {
  const p = useCourseProgress();
  const git = useLearn((s) => s.git);
  const busy = useLearn((s) => s.busy);
  const ready = useStore((s) => s.status.session.state === "ready");
  const lessons = LESSONS.length;
  const exercises = LESSONS.reduce((n, l) => n + l.exercises.length, 0);
  const done = LESSONS.filter((l) => lessonDone(p, l)).length;
  const passed = LESSONS.reduce((n, l) => n + exercisesPassed(p, l), 0);
  const fresh = passed === 0 && done === 0 && !git?.branches.length;
  const waiting = waitingLesson(p);
  const label = p.current ? `${p.onLesson?.id === p.current.id || git?.branches.includes(lessonBranch(p.current)) ? "Continue" : "Start"}: ${p.current.title}` : null;
  return (
    <div className="learn-body">
      <div className="learn-summary">
        <div className="learn-progress">
          <span className="learn-dim">
            {done} of {lessons} lessons · {passed} of {exercises} exercises
          </span>
          <span className="learn-bar" aria-hidden>
            <i style={{ width: `${(passed / exercises) * 100}%` }} />
          </span>
        </div>
        {fresh && <p className="learn-dim">Each lesson is a git branch in this project. Write the functions in the lesson's file and press Check; passing an exercise commits your answer.</p>}
        {waiting ? (
          <>
            <p className="learn-dim">You finished every lesson this project has. This ZParen brings more.</p>
            <div>
              <button className="btn primary" disabled={!!busy || !ready} title={ready ? undefined : "Lisp is not running"} onClick={() => void addWaitingLesson(waiting)}>
                {busy ?? `Add Lesson ${waiting.number}: ${waiting.title}`}
              </button>
            </div>
          </>
        ) : label ? (
          <div>
            <button className="btn primary" disabled={!!busy || !ready} title={ready ? undefined : "Lisp is not running"} onClick={() => void continueCourse()}>
              {busy ?? label}
            </button>
          </div>
        ) : (
          <p>
            <strong>You finished every lesson this ZParen has.</strong> More lessons arrive with ZParen updates; until then,{" "}
            <a href="#" onClick={(e) => (e.preventDefault(), void openExternal(ON_LISP))}>
              On Lisp
            </a>{" "}
            is free to read.
          </p>
        )}
      </div>
      <Outline p={p} />
    </div>
  );
}

function status(p: Progress, e: Exercise, result: ReturnType<typeof useLearn.getState>["results"][string] | undefined) {
  if (result?.status === "passed" || p.passed.has(e.key)) return "passed";
  return result?.status ?? "todo";
}

const PILL: Record<string, [string, string]> = {
  passed: ["pass", "✓ Passed"],
  failed: ["fail", "✕ Not yet"],
  error: ["fail", "✕ Not yet"],
  skipped: ["todo", "Not written"],
  todo: ["todo", "To do"],
};

function Card({ l, e, p, canCheck, why }: { l: Lesson; e: Exercise; p: Progress; canCheck: boolean; why: string }) {
  const result = useLearn((s) => s.results[e.key]);
  const shown = useLearn((s) => s.shown);
  const checking = useLearn((s) => s.checking === e.key);
  const busy = useLearn((s) => s.checking !== null || s.busy !== null);
  const st = status(p, e, result);
  const open = st !== "passed" || shown[`open:${e.key}`];
  const [cls, text] = PILL[st];
  const head = (
    <>
      <span className="learn-num">{e.index}</span>
      <span className="learn-card-title">{e.title}</span>
      <span className={`learn-pill ${cls}`}>{text}</span>
    </>
  );
  if (!open) {
    return (
      <div className="learn-card folded">
        <button className="learn-card-head" aria-expanded={false} onClick={() => toggleShown(`open:${e.key}`)}>
          {head}
        </button>
      </div>
    );
  }
  return (
    <div
      className="learn-card"
      data-key={e.key}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" && ev.metaKey && canCheck && !busy) {
          ev.preventDefault();
          ev.stopPropagation();
          void check(l, e);
        }
      }}
    >
      {st === "passed" ? (
        <button className="learn-card-head" aria-expanded onClick={() => toggleShown(`open:${e.key}`)}>
          {head}
        </button>
      ) : (
        <div className="learn-card-head">{head}</div>
      )}
      <div className="learn-prompt" dangerouslySetInnerHTML={{ __html: inline.parse(e.prompt) as string }} />
      {result && result.status !== "passed" && (
        <div className="learn-result fail" role="status" aria-live="polite">
          <span className="learn-result-label">{result.status === "skipped" ? "Not written yet" : result.status === "error" ? "Could not check" : "A check failed"}</span>
          {result.message}
        </div>
      )}
      {result?.status === "passed" && (
        <div className="learn-result pass" role="status" aria-live="polite">
          <span className="learn-result-label">Passed · committed</span>“Pass {e.label}: {e.title}” on {lessonBranch(l)}
        </div>
      )}
      <div className="learn-actions">
        <button className="btn primary" disabled={!canCheck || busy} title={canCheck ? "Save, load and test your answer (⌘↩)" : why} onClick={() => void check(l, e)}>
          {checking ? "Checking…" : (
            <>
              Check <kbd>⌘↩</kbd>
            </>
          )}
        </button>
        <button className="btn" disabled={!p.reached.includes(l)} onClick={() => void goToCode(l, e)}>
          Go to Code
        </button>
        <span className="grow" />
        <button className="btn link" onClick={() => void askForHint(l, e)}>
          Ask Assistant…
        </button>
      </div>
      <div className="learn-actions">
        {e.hint && (
          <button className="learn-disclosure" aria-expanded={!!shown[`hint:${e.key}`]} onClick={() => toggleShown(`hint:${e.key}`)}>
            <span className="chev">▶</span>Hint
          </button>
        )}
        <button className="learn-disclosure" aria-expanded={!!shown[`solution:${e.key}`]} onClick={() => toggleShown(`solution:${e.key}`)}>
          <span className="chev">▶</span>Show Solution
        </button>
      </div>
      {e.hint && shown[`hint:${e.key}`] && <Prose md={e.hint} className="learn-reveal" />}
      {shown[`solution:${e.key}`] && (
        <div className="learn-reveal code">
          <pre dangerouslySetInnerHTML={{ __html: highlightLispHtml(e.solution) }} />
          <span className="learn-dim">Shown here only. It is never written into your file.</span>
        </div>
      )}
    </div>
  );
}

function ConflictBanner() {
  const git = useLearn((s) => s.git);
  const root = useLearn((s) => s.course?.root);
  if (!git?.merging) return null;
  const lesson = LESSONS.find((l) => git.conflicts.some((c) => c === lessonSource(l)));
  return (
    <div className="learn-banner" role="alert">
      <p>
        <strong>A lesson could not merge into main.</strong> {git.conflicts.length ? `These files changed on both branches: ${git.conflicts.join(", ")}.` : ""}
      </p>
      <p className="learn-dim">Git is left as the merge left it, so you can fix the files yourself, or abort and keep both branches as they were.</p>
      <div className="learn-actions">
        {git.conflicts[0] && root && (
          <button className="btn" onClick={() => void actions.navigate(`${root}/${git.conflicts[0]}`)}>
            Show Changes
          </button>
        )}
        <button className="btn" onClick={() => void abortMerge()}>
          Abort Merge
        </button>
      </div>
      {lesson && <p className="learn-dim">Your answers are safe on {lessonBranch(lesson)} either way.</p>}
    </div>
  );
}

function LessonView({ l }: { l: Lesson }) {
  const p = useCourseProgress();
  const course = useLearn((s) => s.course!);
  const git = useLearn((s) => s.git);
  const busy = useLearn((s) => s.busy);
  const arrived = useLearn((s) => s.arrived);
  const ready = useStore((s) => s.status.session.state === "ready");
  const index = LESSONS.indexOf(l);
  const before = LESSONS[index - 1];
  const next = LESSONS[index + 1];
  const reached = p.reached.includes(l);
  const done = lessonDone(p, l);
  const here = p.onLesson?.id === l.id;
  const allPassed = l.exercises.every((e) => p.passed.has(e.key));
  const canCheck = ready && here && !done;
  const why = !ready
    ? "Lisp is not running"
    : !reached
      ? `Finish lesson ${before?.number} first`
      : done
        ? "This lesson is finished; your answers are on main"
        : "Start the lesson to check your work";
  const file = (
    <a href="#" onClick={(e) => (e.preventDefault(), void actions.navigate(`${course.root}/${lessonSource(l)}`))}>
      {lessonSource(l)}
    </a>
  );
  return (
    <div className="learn-body">
      <div className="learn-lesson-head">
        <h2>{l.title}</h2>
        <div className="learn-dim">
          {LEVELS.find((x) => x.id === l.level)?.title}
          {l.reading && ` · ${l.reading}`}
        </div>
        <div className="learn-branch">
          {here ? (
            <>
              <code>⎇ {lessonBranch(l)}</code>
              {file}
            </>
          ) : done ? (
            <>
              Finished · merged into <code>main</code>
              {file}
            </>
          ) : !reached ? (
            waitingLesson(p) === l ? <>Ready to add: lesson {before?.number} is finished</> : <>Arrives when lesson {before?.number} is finished</>
          ) : (
            <>
              {git?.branches.includes(lessonBranch(l)) ? "Started" : "Not started"} · you are on <code>⎇ {git?.branch ?? "no branch"}</code>
            </>
          )}
        </div>
      </div>
      <ConflictBanner />
      {waitingLesson(p) === l && (
        <div className="learn-box">
          <p>
            This lesson came with a ZParen update. Adding it writes <code>{lessonSource(l)}</code> and its tests on main.
          </p>
          <div>
            <button className="btn primary" disabled={!!busy || !ready} title={ready ? undefined : "Lisp is not running"} onClick={() => void addWaitingLesson(l)}>
              {busy ?? "Add Lesson"}
            </button>
          </div>
        </div>
      )}
      {reached && !here && !done && (
        <div className="learn-box">
          <p>
            {git?.branches.includes(lessonBranch(l)) ? "Continuing switches to " : "Starting makes the branch "}
            <code>{lessonBranch(l)}</code>
            {git?.branches.includes(lessonBranch(l)) ? "" : " from main"} and opens <code>{lessonSource(l)}</code>. Your open files are saved first.
          </p>
          <div>
            <button className="btn primary" disabled={!!busy || !ready || git?.merging} title={ready ? undefined : "Lisp is not running"} onClick={() => void startLesson(l)}>
              {busy ?? (git?.branches.includes(lessonBranch(l)) ? "Continue Lesson" : "Start Lesson")}
            </button>
          </div>
        </div>
      )}
      <Prose md={l.body} />
      {l.reading && <p className="learn-dim">Read more: {l.reading}.</p>}
      <h3 className="learn-section">Exercises</h3>
      <div className="learn-cards">
        {l.exercises.map((e) => (
          <Card key={e.key} l={l} e={e} p={p} canCheck={canCheck} why={why} />
        ))}
      </div>
      {here && !done && allPassed && (
        <div className="learn-finish">
          <p>
            <strong>Every exercise passes.</strong> Finish the lesson to merge <code>{lessonBranch(l)}</code> into main.
            {next ? ` Lesson ${next.number}'s files arrive with it.` : ""}
          </p>
          <div>
            <button className="btn primary" disabled={!!busy} onClick={() => void finishLesson(l)}>
              {busy ?? "Finish Lesson"}
            </button>
          </div>
        </div>
      )}
      {done && next && (
        <>
          {arrived === next.id && (
            <div className="learn-done" role="status">
              <strong>✓ Merged into main.</strong> <span>Lesson {l.number} is finished, and {lessonSource(next)} is ready.</span>
            </div>
          )}
          <div className="learn-next">
            {p.reached.includes(next) && !lessonDone(p, next) && p.onLesson?.id !== next.id ? (
              <button className="btn primary" disabled={!!busy || !ready} onClick={() => void startLesson(next)}>
                Start Lesson {next.number}
              </button>
            ) : (
              <button className="btn link" onClick={() => showLesson(next.id)}>
                Next: {next.number} · {next.title}
              </button>
            )}
            {p.reached.includes(next) && !lessonDone(p, next) && p.onLesson?.id !== next.id && <span>{next.title}</span>}
            <kbd>⌘]</kbd>
          </div>
        </>
      )}
      {!here && !done && !allPassed && reached && null}
      {here && !done && !allPassed && <div className="learn-next learn-dim">Finish Lesson appears when every exercise passes.</div>}
    </div>
  );
}

export function LearnPanel() {
  const root = useStore((s) => s.status.project?.root);
  const course = useLearn((s) => s.course);
  const lessonId = useLearn((s) => s.lesson);
  const notice = useLearn((s) => s.notice);
  const git = useLearn((s) => s.git);
  const [menu, setMenu] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const lesson = course ? (LESSONS.find((l) => l.id === lessonId) ?? null) : null;

  useEffect(() => {
    void refreshCourse();
    const again = () => void refreshCourse();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [root]);
  // A lesson opens at its top.
  useEffect(() => body.current?.querySelector(".learn-body")?.scrollTo(0, 0), [lessonId]);

  const go = (delta: number) => {
    if (!lesson) return delta > 0 && LESSONS[0] && showLesson(LESSONS[0].id);
    const to = LESSONS[LESSONS.indexOf(lesson) + delta];
    showLesson(to ? to.id : null);
  };

  return (
    <div
      className="learn"
      ref={body}
      data-testid="learn"
      onKeyDown={(e) => {
        if (e.metaKey && (e.key === "[" || e.key === "]")) {
          e.preventDefault();
          go(e.key === "]" ? 1 : -1);
        }
      }}
    >
      <div className="right-header">
        {lesson && (
          <button className="icon-btn" title="Back to the course (⌘[)" aria-label="Back to the course" onClick={() => showLesson(null)}>
            <Icon name="back" />
          </button>
        )}
        <span className="title">{lesson ? `${lesson.number} · ${lesson.title}` : "Learn Lisp"}</span>
        <button className="icon-btn" title="More" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <Icon name="more" size={13} />
        </button>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={() => set({ right: null })}>
          <Icon name="x" size={12} />
        </button>
      </div>
      {menu && <Menu lesson={lesson} onClose={() => setMenu(false)} />}
      {notice && (
        <div className={`learn-notice ${notice.tone}`} role="alert">
          {notice.text}
        </div>
      )}
      {course && git && !git.git && <div className="learn-notice info">Progress needs git. macOS offers to install it the first time git runs.</div>}
      {course === undefined ? <div className="learn-body" /> : course === null ? <NotCourse /> : lesson ? <LessonView l={lesson} /> : <CourseView />}
    </div>
  );
}
