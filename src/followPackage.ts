// With the setting on, the REPL follows the package of the file being edited,
// as SLIME users get with a hook on buffer switches.

import * as actions from "./actions";
import { packageAt } from "./lisp/forms";
import { useSettings } from "./settings";
import { get, type State, useStore } from "./store";

const LISP_FILE = /\.(lisp|lsp|cl|asd|ros)$/i;

/** The package the code of the file at PATH is in: its last in-package, or null. */
export function filePackage(path: string | null, text: string): string | null {
  return path && LISP_FILE.test(path) ? (packageAt(text, text.length)?.toUpperCase() ?? null) : null;
}

/**
 * What the REPL should switch to now: the active file's package, when Lisp
 * has it. `done` is the file and package already switched for since the file
 * was opened, so an in-package the user types holds until the next file switch.
 */
export function packageToFollow(s: Pick<State, "tabs" | "activeTab" | "packages" | "package">, done: string | null): { key: string; name: string | null } | null {
  const tab = s.tabs.find((t) => t.path === s.activeTab);
  const name = tab ? filePackage(tab.path, tab.text) : null;
  if (!tab || !name || !s.packages.some((p) => p.toUpperCase() === name)) return null;
  const key = `${tab.path}\n${name}`;
  if (key === done) return null;
  return { key, name: s.package.toUpperCase() === name ? null : name };
}

let done: string | null = null;

function check() {
  const s = get();
  if (!useSettings.getState().replFollowsFile || s.status.session.state !== "ready") return;
  const next = packageToFollow(s, done);
  if (!next) return;
  done = next.key;
  if (next.name) void actions.setPackage(next.name).catch(() => {});
}

/** Starts following: on a file switch, a new package list, a new session, or the setting turned on. */
export function followFilePackage() {
  useStore.subscribe((s, prev) => {
    // Each file switch, and each new Lisp, which starts in CL-USER, sets the file's package again.
    if (s.status.session.state !== "ready" || s.activeTab !== prev.activeTab) done = null;
    if (s.activeTab !== prev.activeTab || s.packages !== prev.packages || s.status.session.state !== prev.status.session.state) check();
  });
  useSettings.subscribe((s, prev) => {
    if (s.replFollowsFile === prev.replFollowsFile) return;
    done = null;
    check();
  });
}
