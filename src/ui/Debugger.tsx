import { useEffect, useRef, useState } from "react";
import * as actions from "../actions";
import { showLesson, useLearn } from "../learn/learn";
import type { Debugger as Dbg } from "../protocol/Debugger";
import type { Local } from "../protocol/Local";
import { updateSettings, useSettings } from "../settings";
import { activeDebugger, set, threadKey, useStore } from "../store";
import {
  bareName,
  codeParts,
  firstFrame,
  foldLabel,
  frameRows,
  localKind,
  restartGroups,
  staleFrames,
  type Summary,
  type SummaryFrame,
  type SummaryRestart,
} from "./debuggerSummary";
import { Icon } from "./Icon";

/** Text with `code` marked shown in the code font. */
function Code({ text }: { text: string }) {
  return (
    <>
      {codeParts(text).map((p, i) => (p.code ? <code key={i}>{p.text}</code> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** A file by its path in the project, such as src/main.lisp, or its name when it is elsewhere. */
function shownPath(path: string): string {
  const root = useStore.getState().status.project?.root?.replace(/\/$/, "");
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path.slice(path.lastIndexOf("/") + 1);
}

function FrameDetail({ dbg, frame, args }: { dbg: Dbg; frame: number; args: string[] | null }) {
  const [locals, setLocals] = useState<Local[] | null>(null);
  const [form, setForm] = useState("");
  const [out, setOut] = useState("");
  const [temps, setTemps] = useState(false);
  const restartable = dbg.frames.find((f) => f.index === frame)?.restartable;
  // The frame's source is marked in the editor, without its values yet.
  const wantsValues = useStore((s) => s.debugSpot?.frame === frame && s.debugSpot.thread === threadKey(dbg.thread) && s.debugSpot.level === dbg.level && !s.debugSpot.values);

  useEffect(() => {
    setLocals(null);
    actions.lisp({ op: "frameLocals", thread: dbg.thread, frame }).then((r) => {
      if (r.kind === "locals") setLocals(r.items);
    });
  }, [dbg, frame]);

  useEffect(() => {
    if (locals && wantsValues) actions.showFrameValues(dbg, frame, locals.map((l) => ({ name: l.name, value: l.value })));
  }, [locals, wantsValues]);

  const evalInFrame = async () => {
    const r = await actions.lisp({ op: "evalInFrame", thread: dbg.thread, frame, form, package: useStore.getState().package });
    if (r.kind === "text") setOut(r.text);
  };

  const groups = { arg: [] as Local[], local: [] as Local[], temp: [] as Local[] };
  for (const l of locals ?? []) groups[args ? localKind(l.name, args) : "local"].push(l);
  const row = (l: Local) => (
    <div className="local" key={l.id}>
      <span className="name" title={l.name}>
        {bareName(l.name)}
      </span>
      <span className="value" title="Inspect" onClick={() => actions.inspectFrameVar(dbg.thread, frame, l.id)}>
        {l.value}
      </span>
    </div>
  );

  return (
    <div className="frame-detail" data-testid="frame-detail">
      {locals === null && <div className="dim">Loading locals…</div>}
      {locals?.length === 0 && <div className="dim">No locals available. Compile with (debug 3) for more.</div>}
      {groups.arg.length > 0 && <div className="locals-head">Arguments</div>}
      {groups.arg.map(row)}
      {groups.local.length > 0 && args && <div className="locals-head">Locals</div>}
      {groups.local.map(row)}
      {groups.temp.length > 0 && (
        <button className="link temps" onClick={() => setTemps(!temps)} title="Names the compiler made, such as for an argument passed to format">
          {temps ? "Hide" : "Show"} {groups.temp.length} compiler temporar{groups.temp.length === 1 ? "y" : "ies"}
        </button>
      )}
      {temps && groups.temp.map(row)}
      <div className="frame-actions">
        <button className="btn" onClick={() => actions.showFrame(dbg, frame)}>
          Show source
        </button>
        <button
          className="btn"
          disabled={!restartable}
          title={restartable ? "Unwind to this frame and call it again, using current definitions" : "This frame cannot be restarted"}
          onClick={() => actions.restartFrame(dbg.thread, frame)}
        >
          <Icon name="restart" size={11} /> Restart frame
        </button>
        <button
          className="btn"
          disabled={!form.trim()}
          title="Make this frame return the value of the form below"
          onClick={() => actions.lisp({ op: "returnFromFrame", thread: dbg.thread, frame, form })}
        >
          Return value
        </button>
      </div>
      <form
        className="frame-eval"
        onSubmit={(e) => {
          e.preventDefault();
          evalInFrame();
        }}
      >
        <input placeholder="Evaluate in this frame, or a value to return…" value={form} onChange={(e) => setForm(e.target.value)} />
      </form>
      {out && (
        <div className="frame-eval out">
          <Code text={out} />
        </div>
      )}
    </div>
  );
}

export function DebuggerPanel() {
  const dbg = useStore(activeDebugger);
  const codeVersion = useStore((s) => s.codeVersion);
  const details = useSettings((s) => s.debuggerDetails);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const opened1st = useRef<Dbg | null>(null);

  useEffect(() => {
    setSelected(null);
    setOpened(new Set());
    setSummary(null);
    setLoading(true);
  }, [dbg]);

  // Asked again after code changes, so a frame that runs an old definition says so.
  useEffect(() => {
    if (!dbg) return;
    let live = true;
    void actions.debuggerSummary(dbg).then((s) => {
      if (!live) return;
      setSummary(s);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [dbg, codeVersion]);

  // The user's innermost frame opens first, with its source shown in the editor.
  useEffect(() => {
    if (!dbg || !summary || opened1st.current === dbg) return;
    opened1st.current = dbg;
    const f = firstFrame(summary.frames);
    if (!f) return;
    setSelected(f.index);
    if (!dbg.stepping && f.file) void actions.showFrame(dbg, f.index, { remember: false, focus: false });
  }, [dbg, summary]);

  useEffect(() => {
    if (!dbg) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".cm-editor, input, textarea")) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n < dbg.restarts.length) actions.invokeRestart(dbg.thread, dbg.level, n);
      if (e.key === "q") actions.debuggerAbort(dbg.thread);
      const how = dbg.stepping && ({ s: "into", x: "over", o: "out", c: "continue" } as const)[e.key as "s"];
      if (how) actions.stepActive(how);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dbg]);

  if (!dbg) return null;
  const plain = summary && !details;

  const select = (f: { index: number; file?: string | null }) => {
    const next = selected === f.index ? null : f.index;
    setSelected(next);
    if (next !== null && f.file) void actions.showFrame(dbg, f.index, { remember: false, focus: false });
  };

  const frameRow = (index: number, text: string, f: SummaryFrame | null) => (
    <div key={index}>
      <div className={`frame-row ${selected === index ? "selected" : ""} ${f?.owner ?? ""}`} onClick={() => select(f ?? { index })} data-owner={f?.owner}>
        <span className="idx">{index}</span>
        <span className="desc">{text}</span>
        {f?.stale && (
          <span className="tag" title="This frame runs the definition from before your latest change">
            changed
          </span>
        )}
        {f?.file && f.owner === "yours" && (
          <span className="where" title={f.file}>
            {shownPath(f.file)}
            {f.line ? `:${f.line}` : ""}
          </span>
        )}
      </div>
      {selected === index && <FrameDetail dbg={dbg} frame={index} args={f ? f.args : null} />}
    </div>
  );

  return (
    <div className="debugger" data-testid="debugger">
      <Threads current={threadKey(dbg.thread)} />
      <Levels dbg={dbg} />
      {dbg.stepping ? (
        <Stepper dbg={dbg} summary={summary} />
      ) : plain ? (
        <Plain dbg={dbg} summary={summary} />
      ) : loading && !details ? (
        <Loading dbg={dbg} />
      ) : (
        <Condition dbg={dbg} summary={summary} />
      )}
      {summary && <Stale dbg={dbg} summary={summary} />}
      <div className="frames">
        <div className="frames-head">
          <span>Backtrace</span>
          <span style={{ flex: 1 }} />
          {summary && (
            <button
              className="link"
              aria-pressed={details}
              title={details ? "Show the plain-words view" : "Show SBCL's own text: the whole condition, every restart and every frame"}
              onClick={() => updateSettings({ debuggerDetails: !details })}
            >
              {details ? "Show less" : "Show everything"}
            </button>
          )}
        </div>
        {plain
          ? frameRows(summary.frames, opened).map((r) =>
              r.kind === "frame" ? (
                frameRow(r.frame.index, r.frame.call, r.frame)
              ) : (
                <button key={r.key} className="frame-fold" onClick={() => setOpened(new Set([...opened, r.key]))} title="Show these frames">
                  … {foldLabel(r)}
                </button>
              ),
            )
          : (summary?.frames.length ? summary.frames.map((f) => ({ index: f.index, text: f.call, f })) : dbg.frames.map((f) => ({ index: f.index, text: f.description, f: null }))).map(
              (r) => frameRow(r.index, r.text, r.f),
            )}
      </div>
    </div>
  );
}

/** Every thread stopped in the debugger, so an error in a background thread is not hidden behind the REPL's. */
function Threads({ current }: { current: string }) {
  const debuggers = useStore((s) => s.debuggers);
  const keys = Object.keys(debuggers);
  if (keys.length < 2) return null;
  return (
    <div className="dbg-threads" data-testid="debugger-threads">
      {keys.map((key) => {
        const top = debuggers[key][debuggers[key].length - 1];
        const t = top.thread;
        return (
          <button key={key} className={`dbg-thread ${key === current ? "active" : ""}`} onClick={() => set({ lastDebugThread: key })}>
            <span className="tid">{typeof t === "object" && "id" in t ? `thread ${t.id}` : "repl"}</span>
            <span className="msg">{top.condition.split("\n")[0]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** An error while the debugger was open opened another level: says so, with the way back. */
function Levels({ dbg }: { dbg: Dbg }) {
  const stack = useStore((s) => s.debuggers[threadKey(dbg.thread)]) ?? [];
  if (stack.length < 2) return null;
  const earlier = stack[stack.length - 2];
  return (
    <div className="dbg-levels" data-testid="debugger-levels">
      <Icon name="history" size={12} />
      <span>
        A new error, while the debugger was open for: <span className="earlier">{earlier.condition.split("\n")[0]}</span>
      </span>
      <span style={{ flex: 1 }} />
      <button className="btn" onClick={() => actions.debuggerAbort(dbg.thread)} title="Leave this error and go back to the earlier one (q)">
        <Icon name="back" size={11} /> Back to the earlier error
      </button>
    </div>
  );
}

/** A frame that runs a definition from before the latest change, with the way to run the new one. */
function Stale({ dbg, summary }: { dbg: Dbg; summary: Summary }) {
  const f = staleFrames(summary.frames)[0];
  if (!f) return null;
  return (
    <div className="dbg-stale" data-testid="debugger-stale">
      <span>
        You changed <code>{f.name}</code>. Restart frame {f.index} to run the new definition.
      </span>
      <span style={{ flex: 1 }} />
      <button className="btn primary" onClick={() => actions.restartFrame(dbg.thread, f.index)}>
        <Icon name="restart" size={11} /> Restart frame {f.index}
      </button>
    </div>
  );
}

const STEPS = [
  { how: "into", icon: "stepInto", label: "Into", key: "F7" },
  { how: "over", icon: "stepOver", label: "Over", key: "F8" },
  { how: "out", icon: "stepOut", label: "Out", key: "⇧F8" },
  { how: "continue", icon: "play", label: "Continue", key: "F9" },
] as const;

function Stepper({ dbg, summary }: { dbg: Dbg; summary: Summary | null }) {
  const breakpoint = summary ? summary.kind === "breakpoint" : dbg.condition.startsWith("Breakpoint at");
  return (
    <div className={`dbg-head stepper ${breakpoint ? "at-breakpoint" : ""}`} data-testid="stepper">
      <div className="kind">
        <Icon name="stepInto" size={12} />
        {breakpoint ? "Breakpoint" : "Stepping"}
        <span style={{ flex: 1 }} />
        <button className="btn" title="Stop stepping and abort (q)" onClick={() => actions.debuggerAbort(dbg.thread)}>
          <Icon name="stop" size={11} /> Abort
        </button>
      </div>
      {summary && breakpoint ? (
        <>
          <div className="dbg-title">
            <Code text={summary.title} />
          </div>
          {summary.detail && (
            <div className="dbg-detail">
              <Code text={summary.detail} />
            </div>
          )}
        </>
      ) : (
        <div className="cond">{dbg.condition.replace(/\s+/g, " ").replace(/ With arguments:\s*$/, "").trim()}</div>
      )}
      <div className="step-actions">
        {STEPS.map((s) => (
          <button key={s.how} className="btn" title={`${s.label} (${s.key})`} onClick={() => actions.stepActive(s.how)}>
            <Icon name={s.icon} size={12} /> {s.label} <kbd>{s.key}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}

const conditionType = (dbg: Dbg) => dbg.conditionType.replace(/^\s*\[Condition of type |\]\s*$/g, "");

/** SBCL's own view: the whole condition text and every restart, numbered. */
function Condition({ dbg, summary }: { dbg: Dbg; summary: Summary | null }) {
  return (
    <>
      <div className="dbg-head">
        <div className="kind">
          <Icon name="bug" size={12} />
          {conditionType(dbg)}
          <span className="badge">level {dbg.level}</span>
          <span style={{ flex: 1 }} />
          <HeadButtons dbg={dbg} summary={summary} />
        </div>
        <div className="cond">{dbg.condition}</div>
      </div>
      <div className="restarts">
        {dbg.restarts.map((r, i) => (
          <button key={i} className="restart" onClick={() => actions.invokeRestart(dbg.thread, dbg.level, i)} title={r.description}>
            <span className="n">{i}</span>
            <span className="name">{r.name.replace(/^\*/, "")}</span>
            <span className="desc">{r.description.replace(/SLIME('s)? /g, "")}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function HeadButtons({ dbg, summary }: { dbg: Dbg; summary: Summary | null }) {
  const [help, setHelp] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => void actions.explainError(dbg, summary)} title="Ask the assistant what went wrong and how to fix it">
        <Icon name="sparkle" size={12} /> Explain
      </button>
      <button className="btn" onClick={() => actions.inspectCondition(dbg.thread)} title="Inspect the condition object">
        <Icon name="eye" size={12} /> Inspect
      </button>
      <button className="btn icon-only" aria-label="How the debugger works" aria-expanded={help} title="How the debugger works" onClick={() => setHelp(!help)}>
        ?
      </button>
      {help && <Help onClose={() => setHelp(false)} />}
    </>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  const course = useLearn((s) => s.course);
  return (
    <div className="dbg-help" role="dialog" aria-label="How the debugger works" data-testid="debugger-help">
      <p>
        <b>The error</b> stopped your code where it happened. Nothing is lost: the calls that led here wait for you to choose how to go on.
      </p>
      <p>
        <b>Restarts</b> are the ways to go on. <b>Abort</b> gives up and goes back to the REPL. Others retry, or go on with a value you give.
      </p>
      <p>
        <b>Frames</b> are the calls that led here, the innermost first. Yours show, and SBCL's fold. Click one to see its values, and to evaluate a form with them.
      </p>
      <p>
        <b>Fix and go on:</b> change the function, compile it (⌘B or ⌘↩), then <b>Restart frame</b> runs the new code from that call.
      </p>
      <p>
        <b>Levels:</b> an error while the debugger is open opens another level. <b>Back to the earlier error</b> leaves it.
      </p>
      <div className="dbg-help-actions">
        {course && (
          <button
            className="btn"
            onClick={() => {
              set({ right: "learn" });
              showLesson("14-conditions");
              onClose();
            }}
          >
            Lesson: Conditions and restarts
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** While Lisp says what went wrong: the condition's first line, and the way out. */
function Loading({ dbg }: { dbg: Dbg }) {
  return (
    <>
      <div className="dbg-head plain">
        <div className="kind">
          <Icon name="bug" size={12} />
          {conditionType(dbg)}
        </div>
        <div className="dbg-title">{dbg.condition.split("\n")[0]}</div>
      </div>
      <div className="dbg-actions" data-testid="debugger-actions">
        <button className="btn" onClick={() => actions.debuggerAbort(dbg.thread)} title="Stop, and go back to where you were (q)">
          <Icon name="stop" size={11} /> Abort <kbd>q</kbd>
        </button>
      </div>
    </>
  );
}

/** The plain-words view: what went wrong, and the ways to go on as buttons. */
function Plain({ dbg, summary }: { dbg: Dbg; summary: Summary }) {
  const groups = restartGroups(summary.restarts);
  const [asking, setAsking] = useState<SummaryRestart | null>(null);
  const useValue = summary.restarts.find((r) => r.role === "value");
  const yours = firstFrame(summary.frames);

  return (
    <>
      <div className={`dbg-head plain ${summary.kind}`}>
        <div className="kind">
          <Icon name="bug" size={12} />
          <span title="The condition's type">{conditionType(dbg)}</span>
          {dbg.level > 1 && <span className="badge">level {dbg.level}</span>}
          <span style={{ flex: 1 }} />
          <HeadButtons dbg={dbg} summary={summary} />
        </div>
        <div className="dbg-title" data-testid="debugger-title">
          <Code text={summary.title} />
        </div>
        {summary.detail && (
          <div className="dbg-detail">
            <Code text={summary.detail} />
          </div>
        )}
        {(summary.suggestions.length > 0 || summary.define) && (
          <div className="dbg-suggest">
            {summary.suggestions.length > 0 && <span>Did you mean</span>}
            {summary.suggestions.map((name) =>
              useValue ? (
                <button
                  key={name}
                  className="dbg-chip"
                  title={`${useValue.label.replace(/…$/, "")}: ${name}`}
                  onClick={() => void actions.invokeRestartWithValue(dbg, useValue.index, name)}
                >
                  <code>{name}</code>
                </button>
              ) : (
                <code key={name}>{name}</code>
              ),
            )}
            {summary.suggestions.length > 0 && <span>?</span>}
            {summary.define && (
              <button className="btn" onClick={() => void actions.defineFunction(summary.define!, yours)} title="Write a stub to fill in, after the form that calls it">
                <Icon name="plus" size={11} /> Define <code>{summary.define}</code>
              </button>
            )}
          </div>
        )}
      </div>
      <div className="dbg-actions" data-testid="debugger-actions">
        {groups.abort && (
          <button className="btn" onClick={() => actions.debuggerAbort(dbg.thread)} title="Stop, and go back to where you were (q)">
            <Icon name="stop" size={11} /> {groups.abort.label} <kbd>q</kbd>
          </button>
        )}
        {groups.main.map((r) => (
          <button
            key={r.index}
            className={`btn ${asking === r ? "active" : ""}`}
            onClick={() => (r.prompt ? setAsking(asking === r ? null : r) : actions.invokeRestart(dbg.thread, dbg.level, r.index))}
            title={r.prompt ?? r.label}
          >
            <Code text={r.label} /> <kbd>{r.index}</kbd>
          </button>
        ))}
        {groups.more.length > 0 && (
          <details className="dbg-more">
            <summary>More</summary>
            {groups.more.map((r) => (
              <button key={r.index} className="restart" onClick={() => actions.invokeRestart(dbg.thread, dbg.level, r.index)}>
                <span className="n">{r.index}</span>
                <span className="desc">{r.label}</span>
              </button>
            ))}
          </details>
        )}
      </div>
      {asking && <AskValue dbg={dbg} restart={asking} onDone={() => setAsking(null)} />}
    </>
  );
}

/** Asks for the value a restart such as USE-VALUE takes, in the panel. */
function AskValue({ dbg, restart, onDone }: { dbg: Dbg; restart: SummaryRestart; onDone: () => void }) {
  const [form, setForm] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="dbg-ask"
      data-testid="debugger-ask"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!form.trim()) return;
        const why = await actions.invokeRestartWithValue(dbg, restart.index, form);
        if (why) setError(why);
      }}
    >
      <label>
        <Code text={restart.prompt ?? "A value"} />
        <input autoFocus value={form} placeholder="A Lisp form, such as 42 or (list 1 2)" onChange={(e) => (setForm(e.target.value), setError(null))} onKeyDown={(e) => e.key === "Escape" && onDone()} />
      </label>
      <button className="btn primary" type="submit" disabled={!form.trim()}>
        Use
      </button>
      {error && <div className="dbg-ask-error">{error}</div>}
    </form>
  );
}
