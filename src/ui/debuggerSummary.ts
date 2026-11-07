// The debugger in plain words, as Lisp's zparen::debugger-summary gives it,
// and how the panel arranges it: restarts by what they do, and the user's own
// frames with the rest folded.

import type { Debugger } from "../protocol/Debugger";

export type SummaryRestart = {
  index: number;
  /** abort, retry, continue, value (asks for a value), other (the program's own), internal (Swank's). */
  role: "abort" | "retry" | "continue" | "value" | "other" | "internal";
  label: string;
  /** For a restart that takes a value, what to ask for. */
  prompt: string | null;
};

export type SummaryFrame = {
  index: number;
  /** The call, such as (greet "Lisp"). */
  call: string;
  /** yours: the project's code, or defined at the REPL. library: another file. system: SBCL, Swank and the evaluator. */
  owner: "yours" | "library" | "system";
  name: string;
  restartable: boolean;
  /** The function was defined again after this frame started. */
  stale: boolean;
  file: string | null;
  line: number | null;
  /** The function's argument names, for the user's frames. */
  args: string[];
};

export type Summary = {
  level: number;
  kind: "error" | "warning" | "signal" | "breakpoint" | "step" | "interrupt";
  /** One line, with `code` marked by backticks. */
  title: string;
  detail: string | null;
  /** Names that are defined, close to a name that is not. */
  suggestions: string[];
  /** A function name that is not defined, so Define it can write a stub. */
  define: string | null;
  restarts: SummaryRestart[];
  frames: SummaryFrame[];
};

export function parseSummary(text: string): Summary | null {
  try {
    const s = JSON.parse(text) as Summary;
    return typeof s.title === "string" && Array.isArray(s.frames) && Array.isArray(s.restarts) ? s : null;
  } catch {
    return null;
  }
}

/** Text with `code` marked, as pieces to show in a code font or not. */
export function codeParts(text: string): { text: string; code: boolean }[] {
  return text.split("`").flatMap((t, i) => (t ? [{ text: t, code: i % 2 === 1 }] : []));
}

const MAIN_ORDER: SummaryRestart["role"][] = ["continue", "value", "other", "retry"];

/**
 * The restarts to show as buttons, abort first and then the program's own in
 * their order, and the rest for a More menu: Swank's own restarts.
 */
export function restartGroups(restarts: SummaryRestart[]): { abort: SummaryRestart | null; main: SummaryRestart[]; more: SummaryRestart[] } {
  const main = restarts.filter((r) => MAIN_ORDER.includes(r.role));
  main.sort((a, b) => (a.role === "retry" ? 1 : 0) - (b.role === "retry" ? 1 : 0) || a.index - b.index);
  return { abort: restarts.find((r) => r.role === "abort") ?? null, main, more: restarts.filter((r) => r.role === "internal") };
}

export type FrameRow = { kind: "frame"; frame: SummaryFrame } | { kind: "fold"; key: string; frames: SummaryFrame[]; owner: "library" | "system" | "mixed" };

/**
 * The backtrace with the frames to skip folded. With frames of the user's own,
 * every other frame folds. With none, only the system's frames fold, so a
 * library's frames show. A fold the user opened shows its frames.
 */
export function frameRows(frames: SummaryFrame[], opened: ReadonlySet<string> = new Set()): FrameRow[] {
  const anyYours = frames.some((f) => f.owner === "yours");
  const anyLibrary = frames.some((f) => f.owner === "library");
  const shown = (f: SummaryFrame) => f.owner === "yours" || (!anyYours && (f.owner === "library" || !anyLibrary));
  const rows: FrameRow[] = [];
  let run: SummaryFrame[] = [];
  const flush = () => {
    if (!run.length) return;
    const key = `${run[0].index}-${run[run.length - 1].index}`;
    if (opened.has(key)) rows.push(...run.map((frame) => ({ kind: "frame" as const, frame })));
    else {
      const owners = new Set(run.map((f) => f.owner));
      rows.push({ kind: "fold", key, frames: run, owner: owners.size === 1 ? (run[0].owner as "library" | "system") : "mixed" });
    }
    run = [];
  };
  for (const f of frames) {
    if (shown(f)) {
      flush();
      rows.push({ kind: "frame", frame: f });
    } else run.push(f);
  }
  flush();
  return rows;
}

/** What a fold says: "3 SBCL frames", "2 library frames", or "5 frames". */
export function foldLabel(row: Extract<FrameRow, { kind: "fold" }>): string {
  const n = row.frames.length;
  const what = row.owner === "system" ? "SBCL and Swank" : row.owner === "library" ? "library" : "other";
  return `${n} ${what} frame${n === 1 ? "" : "s"}`;
}

/** The frame to open first: the user's innermost frame, if there is one. */
export function firstFrame(frames: SummaryFrame[]): SummaryFrame | null {
  return frames.find((f) => f.owner === "yours") ?? null;
}

/** The user's frames that run a definition from before the latest compile, and can run the new one. */
export function staleFrames(frames: SummaryFrame[]): SummaryFrame[] {
  return frames.filter((f) => f.stale && f.restartable && f.owner === "yours");
}

export type LocalKind = "arg" | "local" | "temp";

/** A local's name without the package Swank prints it with, such as N for ZEN-DEMO::N, in lower case. */
export function bareName(name: string): string {
  return (name.startsWith("#:") ? name : name.replace(/^[^:]+::?/, "")).toLowerCase();
}

/** Arguments by the frame's lambda list, compiler temporaries such as #:G2, and the rest. */
export function localKind(name: string, args: readonly string[]): LocalKind {
  if (name.startsWith("#:")) return "temp";
  return args.includes(bareName(name)) ? "arg" : "local";
}

/** A Lisp stub for an undefined function, and where its body is, selected to type over. */
export function defineStub(name: string): { text: string; from: number; to: number } {
  const text = `(defun ${name} ()\n  nil)`;
  return { text, from: text.length - 4, to: text.length - 1 };
}

/** What Explain this error asks the assistant. */
export function explainRequest(dbg: Debugger, summary: Summary | null, root: string | null = null): string {
  const shown = (file: string) => (root && file.startsWith(`${root.replace(/\/$/, "")}/`) ? file.slice(root.replace(/\/$/, "").length + 1) : file);
  const frames = (summary?.frames ?? []).filter((f) => f.owner === "yours").slice(0, 6);
  const lines = [
    "Explain this Lisp error in plain words and suggest a fix. Use the debugger tools to look at the frames if that helps.",
    "",
    summary ? summary.title.replace(/`/g, "") : dbg.condition.split("\n")[0],
    "",
    dbg.condition.trim(),
  ];
  if (frames.length) lines.push("", "My frames:", ...frames.map((f) => `- ${f.call}${f.file ? ` (${shown(f.file)}${f.line ? `:${f.line}` : ""})` : ""}`));
  return lines.join("\n");
}
