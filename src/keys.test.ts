import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindings, displayKey, EmacsChords, emacsKeyMatches, emacsNotation, keyOf, matches, noteOf } from "./keys";
import { platform } from "./os";

const realMac = platform.mac;
afterAll(() => {
  platform.mac = realMac;
});

const key = (init: Partial<KeyboardEvent>) =>
  ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, code: "", ...init }) as KeyboardEvent;

const ctrl = (letter: string) => key({ key: letter, code: `Key${letter.toUpperCase()}`, ctrlKey: true });

describe("Emacs key sequences", () => {
  it("reads keys by physical key, since ⌥ makes macOS type a composed character", () => {
    expect(emacsKeyMatches(key({ key: "≥", code: "Period", altKey: true }), "M-.")).toBe(true);
    expect(emacsKeyMatches(key({ key: "≈", code: "KeyX", altKey: true, ctrlKey: true }), "C-M-x")).toBe(true);
    expect(emacsKeyMatches(key({ key: "I", code: "KeyI", shiftKey: true }), "I")).toBe(true);
    expect(emacsKeyMatches(key({ key: "i", code: "KeyI" }), "I")).toBe(false);
    expect(emacsKeyMatches(key({ key: "Enter" }), "RET")).toBe(true);
    expect(emacsKeyMatches(ctrl("e"), "C-x")).toBe(false);
  });

  it("follows prefixes to the bound command", () => {
    const chords = new EmacsChords();
    expect(chords.feed(ctrl("x"))).toEqual({ kind: "pending", prefix: "C-x" });
    expect(chords.feed(key({ key: "Control" }))).toEqual({ kind: "pending", prefix: "C-x" });
    expect(chords.feed(ctrl("e"))).toMatchObject({ kind: "run", binding: { id: "eval-last" } });
    expect(chords.feed(ctrl("c"))).toEqual({ kind: "pending", prefix: "C-c" });
    expect(chords.feed(ctrl("d"))).toEqual({ kind: "pending", prefix: "C-c C-d" });
    expect(chords.feed(key({ key: "d", code: "KeyD" }))).toMatchObject({ kind: "run", binding: { id: "describe" } });
  });

  it("lets ordinary typing through, cancels on C-g, and swallows unknown sequences", () => {
    const chords = new EmacsChords();
    expect(chords.feed(key({ key: "a", code: "KeyA" }))).toEqual({ kind: "pass" });
    chords.feed(ctrl("c"));
    expect(chords.feed(ctrl("g"))).toEqual({ kind: "cancel" });
    expect(chords.feed(key({ key: "a", code: "KeyA" }))).toEqual({ kind: "pass" });
    chords.feed(ctrl("x"));
    expect(chords.feed(ctrl("q"))).toEqual({ kind: "undefined", sequence: "C-x C-q" });
  });

  it("names structural editing's keys in Emacs notation, and leaves them to the editor's keymap", () => {
    expect(emacsNotation("Ctrl-)")).toBe("C-)");
    expect(emacsNotation("Alt-r")).toBe("M-r");
    expect(emacsNotation("Alt-Shift-s")).toBe("M-S");
    expect(emacsNotation("Ctrl-Alt-ArrowLeft")).toBe("C-M-<left>");
    expect(emacsNotation("Ctrl-Shift-Cmd-ArrowRight")).toBeNull();
    const structure = bindings.filter((b) => b.category === "Structure");
    expect(structure.find((b) => b.label === "Next form")?.emacs).toBe("C-M-f");
    expect(structure.find((b) => b.label === "Raise")?.emacs).toBe("M-r");
    expect(structure.find((b) => b.label === "Expand selection")?.emacs).toBeUndefined();
    // The chord handler passes them on, so the structural keymap still runs them in Emacs mode.
    expect(new EmacsChords().feed(key({ key: "ƒ", code: "KeyF", ctrlKey: true, altKey: true }))).toEqual({ kind: "pass" });
    expect(new EmacsChords().feed(key({ key: "®", code: "KeyR", altKey: true }))).toEqual({ kind: "pass" });
  });

  it("never binds one sequence twice or as the prefix of another", () => {
    const seqs = bindings.flatMap((b) => (b.emacs ? [b.emacs] : []));
    expect(new Set(seqs).size).toBe(seqs.length);
    for (const a of seqs) for (const b of seqs) if (a !== b) expect(b.startsWith(`${a} `), `${a} hides ${b}`).toBe(false);
  });
});

describe("key registry", () => {
  beforeEach(() => {
    platform.mac = true;
  });

  it("shows keys the way macOS menus do", () => {
    expect(displayKey("Mod-Shift-p")).toBe("⇧⌘P");
    expect(displayKey("Ctrl-Shift--")).toBe("⌃⇧-");
    expect(displayKey("Mod-Enter")).toBe("⌘↩");
    expect(displayKey("F12")).toBe("F12");
  });

  it("matches keydown events exactly, by physical key for punctuation", () => {
    expect(matches(key({ key: "p", metaKey: true, shiftKey: true }), "Mod-Shift-p")).toBe(true);
    expect(matches(key({ key: "p", metaKey: true }), "Mod-Shift-p")).toBe(false);
    expect(matches(key({ key: "_", code: "Minus", ctrlKey: true, shiftKey: true }), "Ctrl-Shift--")).toBe(true);
    expect(matches(key({ key: "-", code: "Minus", ctrlKey: true }), "Ctrl-Shift--")).toBe(false);
  });

  it("never gives two editor, window or structure bindings the same key", () => {
    const seen = new Map<string, string>();
    for (const b of bindings) {
      if (!b.key || (b.scope === "elsewhere" && b.category !== "Structure")) continue;
      const id = b.key.replace(/\bCmd\b/, "Mod");
      expect(seen.get(id), `${b.id} and ${seen.get(id)} both use ${b.key}`).toBeUndefined();
      seen.set(id, b.id);
    }
  });
});

describe("keys on Linux", () => {
  beforeEach(() => {
    platform.mac = false;
  });

  /** A key as Linux reads it: Mod is Ctrl, and the modifiers in one order. */
  const linuxKey = (k: string) => {
    const parts = k.endsWith("--") ? [...k.slice(0, -2).split("-"), "-"] : k.split("-");
    const base = parts.pop()!.toLowerCase();
    return [...new Set(parts.map((m) => (m === "Mod" ? "Ctrl" : m)))].sort().concat(base).join("-");
  };

  it("shows keys with Ctrl, as Linux menus do", () => {
    expect(displayKey("Mod-Shift-p")).toBe("Ctrl+Shift+P");
    expect(displayKey("Mod-Enter")).toBe("Ctrl+Enter");
    expect(displayKey("Alt-ArrowLeft")).toBe("Alt+←");
    expect(displayKey("F12")).toBe("F12");
  });

  it("reads Mod as Ctrl", () => {
    expect(matches(key({ key: "p", ctrlKey: true, shiftKey: true }), "Mod-Shift-p")).toBe(true);
    expect(matches(key({ key: "p", metaKey: true, shiftKey: true }), "Mod-Shift-p")).toBe(false);
    expect(matches(key({ key: "o", ctrlKey: true }), "Ctrl-o")).toBe(true);
  });

  it("never gives two editor, window or structure bindings the same key, with Mod and Ctrl one key", () => {
    const seen = new Map<string, string>();
    for (const b of bindings) {
      const k = keyOf(b);
      if (!k || (b.scope === "elsewhere" && b.category !== "Structure")) continue;
      const id = linuxKey(k);
      expect(seen.get(id), `${b.id} and ${seen.get(id)} both use ${id}`).toBeUndefined();
      seen.set(id, b.id);
    }
  });

  it("leaves the desktop's keys and the Super key alone", () => {
    const desktop = ["Alt-Ctrl-t", "Alt-Ctrl-l", "Alt-Ctrl-delete", "Alt-tab", "Alt-f4"];
    for (const b of bindings) {
      const k = keyOf(b);
      if (!k) continue;
      expect(desktop, `${b.id} uses ${k}`).not.toContain(linuxKey(k));
      expect(/\b(Cmd|Meta)\b/.test(k), `${b.id} uses ${k}`).toBe(false);
    }
  });

  it("moves the keys that collide on Linux", () => {
    const of = (id: string) => keyOf(bindings.find((b) => b.id === id)!);
    expect(of("back")).toBe("Alt-ArrowLeft");
    expect(of("forward")).toBe("Alt-ArrowRight");
    expect(of("test")).toBe("Mod-Shift-t");
    expect(noteOf(bindings.find((b) => b.id === "forward")!)).toBeUndefined();
  });
});

describe("key registry against CodeMirror's built-in keymaps", () => {
  it("never claims a window shortcut that an editor built-in already uses", async () => {
    const commands = await import("@codemirror/commands");
    const { defaultKeymap, historyKeymap } = commands;
    const lint = await import("@codemirror/lint");
    const { searchKeymap } = await import("@codemirror/search");
    const { completionKeymap } = await import("@codemirror/autocomplete");
    const { lintKeymap } = await import("@codemirror/lint");
    const builtIn = new Set(
      [...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, ...lintKeymap].flatMap((b) => [b.key, b.mac].filter(Boolean)),
    );
    const runs = new Map(
      [...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, ...lintKeymap].flatMap((b) =>
        [b.key, b.mac].filter(Boolean).map((k) => [k!, b.run] as const),
      ),
    );
    for (const b of bindings) {
      if (b.scope !== "window" || !b.key) continue;
      if (b.overrides) {
        // Some commands are built anonymously, so they are compared as exported, not by name.
        const named = { ...commands, ...lint } as Record<string, unknown>;
        expect(runs.get(b.key), `${b.id} says it overrides ${b.overrides}`).toBe(named[b.overrides]);
        continue;
      }
      expect(builtIn.has(b.key), `${b.id} uses ${b.key}, which the editor also binds`).toBe(false);
    }
  });
});
