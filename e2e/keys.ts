// Keys as ZParen reads them where the tests run: ⌘ on macOS, Ctrl on Linux.
// Press "ControlOrMeta+…" for a Mod key. The keys here differ more than that,
// as the `linux` keys in src/keys.ts say.

export const MAC = process.platform === "darwin";

export const KEY = {
  compileFile: MAC ? "Meta+b" : "Control+Shift+B",
  back: MAC ? "Control+o" : "Alt+ArrowLeft",
  forward: MAC ? "Control+Shift+O" : "Alt+ArrowRight",
  test: MAC ? "Meta+u" : "Control+Shift+T",
  trace: MAC ? "Meta+Alt+t" : "Control+Alt+Shift+T",
  reindent: MAC ? "Meta+Alt+l" : "Control+Shift+I",
  /** The end of the document, which CodeMirror binds differently on each platform. */
  docEnd: MAC ? "Meta+ArrowDown" : "Control+End",
};

/** A key as the UI shows it: the macOS text, or the Linux one. */
export const shown = (mac: string, linux: string) => (MAC ? mac : linux);
