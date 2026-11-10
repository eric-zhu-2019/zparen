// The platform's command key, and keys written the way the platform shows them.
// On macOS, Mod is ⌘. Elsewhere it is Ctrl, as CodeMirror reads it.

/** Tests set `mac` to check either platform. */
export const platform = { mac: typeof navigator !== "undefined" && /Mac/.test(navigator.platform) };

/** Whether a mouse or key event has the command key down: ⌘ on macOS, Ctrl elsewhere. */
export function modKey(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return platform.mac ? e.metaKey : e.ctrlKey;
}

const MAC: Record<string, string> = {
  Mod: "⌘",
  Cmd: "⌘",
  Meta: "⌘",
  Shift: "⇧",
  Alt: "⌥",
  Ctrl: "⌃",
  Enter: "↩",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backspace: "⌫",
  Escape: "⎋",
};

const OTHER: Record<string, string> = {
  Mod: "Ctrl",
  Cmd: "Super",
  Meta: "Super",
  Ctrl: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
};

/** Splits "Mod-Shift--" into ["Mod", "Shift", "-"]. */
export function keyParts(key: string): string[] {
  const parts = key.split("-");
  if (key.endsWith("--")) return [...parts.slice(0, -2), "-"];
  return parts;
}

/** "Mod-Shift-p" as the platform shows it: ⇧⌘P on macOS, Ctrl+Shift+P elsewhere. */
export function displayKey(key: string): string {
  const parts = keyParts(key);
  const last = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const names = platform.mac ? MAC : OTHER;
  const order = platform.mac ? ["Ctrl", "Alt", "Shift", "Mod", "Cmd", "Meta"] : ["Mod", "Ctrl", "Alt", "Shift", "Cmd", "Meta"];
  const shown = [...new Set(order.filter((m) => mods.includes(m)).map((m) => names[m]))];
  const base = names[last] ?? (last.length === 1 ? last.toUpperCase() : last);
  return platform.mac ? shown.join("") + base : [...shown, base].join("+");
}

/** Run the project's tests. Ctrl+U is Vim's half-page up, so Linux takes Ctrl+Shift+T. */
export const TEST_KEY = { mac: "Mod-u", linux: "Mod-Shift-t" };

/** The test key as this platform shows it, for text written outside the key table. */
export function testKeyText(): string {
  return displayKey(platform.mac ? TEST_KEY.mac : TEST_KEY.linux);
}

/** The text before a click that needs the command key: "⌘-click" or "Ctrl-click". */
export function modClick(): string {
  return platform.mac ? "⌘-click" : "Ctrl-click";
}
