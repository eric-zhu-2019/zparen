import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { localRename, renameLocal } from "../lisp/rename";
import { showInline } from "./inline";

/** The symbol being renamed: where it is, and its text as written. */
type Target = { pos: number; from: number; to: number; text: string };

const open = StateEffect.define<Target | null>();

const target = StateField.define<Target | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(open)) return e.value;
    // Positions mean nothing once the text changes under the box.
    return tr.docChanged ? null : value;
  },
  provide: (field) => showTooltip.from(field, (t): Tooltip | null => (t ? { pos: t.from, above: false, create: (view) => renameBox(view, t) } : null)),
});

function close(view: EditorView) {
  view.dispatch({ effects: open.of(null) });
  view.focus();
}

function renameBox(view: EditorView, t: Target) {
  const dom = document.createElement("div");
  dom.className = "cm-rename";
  const input = document.createElement("input");
  input.value = t.text;
  input.spellcheck = false;
  input.setAttribute("aria-label", `Rename ${t.text}`);
  const error = document.createElement("div");
  error.className = "cm-rename-error";
  error.setAttribute("role", "alert");
  dom.append(input, error);
  input.addEventListener("keydown", (e) => {
    // The box owns its keys, so Vim and the window shortcuts never see them.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close(view);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = renameLocal(view.state.doc.toString(), t.pos, input.value.trim());
      if (!r.ok) {
        error.textContent = r.reason;
        return;
      }
      view.dispatch({ changes: r.edits, effects: open.of(null), userEvent: "rename", scrollIntoView: true });
      view.focus();
    }
  });
  input.addEventListener("input", () => (error.textContent = ""));
  input.addEventListener("blur", () => setTimeout(() => view.state.field(target) === t && close(view)));
  return {
    dom,
    mount() {
      input.focus();
      input.select();
    },
  };
}

/** Opens the rename box on the local variable or function at the cursor, or says why it cannot. */
export function renameAtCursor(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const text = view.state.doc.toString();
  const r = localRename(text, pos);
  if (!r.ok) {
    const line = view.state.doc.lineAt(pos);
    view.dispatch({ effects: showInline.of({ from: pos, to: Math.max(pos, Math.min(line.to, pos + 1)), kind: "error", text: r.reason }) });
    return true;
  }
  const at = r.uses.find((n) => n.start <= pos && pos <= n.to) ?? r.uses[0];
  view.dispatch({ effects: open.of({ pos, from: at.start, to: at.to, text: text.slice(at.start, at.to) }) });
  return true;
}

export const renameBoxField = [
  target,
  EditorView.baseTheme({
    ".cm-rename": { padding: "6px", display: "flex", flexDirection: "column", gap: "4px", maxWidth: "36em" },
    ".cm-rename input": { font: "inherit", fontFamily: "var(--mono)", minWidth: "16em" },
    ".cm-rename-error:empty": { display: "none" },
    ".cm-rename-error": { color: "var(--danger)", fontSize: "12px" },
  }),
];
