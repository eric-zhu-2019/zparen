// The form a stopped debugger is at, marked in its source while that debugger
// lasts, with the frame's local values shown beside the names in its code.

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { isSymbolChar, listEnd, symbolAt, topLevelForms } from "../lisp/forms";

export type DebugValue = { name: string; value: string };

export const setDebugSpot = StateEffect.define<{ offset: number; values: DebugValue[] } | null>();

const line = Decoration.line({ class: "cm-debug-line" });
const form = Decoration.mark({ class: "cm-debug-form" });

const LIMIT = 40;

class ValueWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly value: string,
  ) {
    super();
  }
  eq(other: ValueWidget) {
    return other.name === this.name && other.value === this.value;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-debug-value";
    el.textContent = this.value.length > LIMIT ? `${this.value.slice(0, LIMIT - 1)}…` : this.value;
    el.title = `${this.name.replace(/^[^:]+::?/, "").toLowerCase()} = ${this.value}`;
    return el;
  }
}

/**
 * Where each local's value goes: after the first use of its name in the
 * top-level form around `at`, which for a function is its lambda list.
 * Compiler temporaries such as #:G2 have no name in the code.
 */
export function valuePlaces(text: string, at: number, values: DebugValue[]): { pos: number; value: DebugValue }[] {
  const around = topLevelForms(text).find((r) => r.from <= at && at <= r.to);
  if (!around) return [];
  const bare = (name: string) => name.replace(/^[^:]+::?/, "").toLowerCase();
  const wanted = new Map(values.filter((v) => !v.name.startsWith("#:")).map((v) => [bare(v.name), v]));
  const places: { pos: number; value: DebugValue }[] = [];
  let i = around.from;
  let inString = false;
  let inComment = false;
  while (i < around.to && wanted.size) {
    const ch = text[i];
    if (inComment) {
      if (ch === "\n") inComment = false;
      i++;
      continue;
    }
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === ";") inComment = true;
    else if (isSymbolChar(ch) && (i === 0 || !isSymbolChar(text[i - 1]))) {
      let end = i;
      while (end < around.to && isSymbolChar(text[end])) end++;
      const value = wanted.get(text.slice(i, end).toLowerCase());
      if (value) {
        places.push({ pos: end, value });
        wanted.delete(bare(value.name));
      }
      i = end;
      continue;
    }
    i++;
  }
  return places;
}

export const debugSpot = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    marks = marks.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setDebugSpot)) continue;
      if (e.value === null) return Decoration.none;
      const text = tr.state.doc.toString();
      const from = Math.min(e.value.offset, text.length);
      const to = text[from] === "(" ? (listEnd(text, from) ?? from + 1) : (symbolAt(text, from)?.to ?? from);
      const widgets = valuePlaces(text, from, e.value.values).map((p) =>
        Decoration.widget({ widget: new ValueWidget(p.value.name, p.value.value), side: 1 }).range(p.pos),
      );
      marks = Decoration.set([line.range(tr.state.doc.lineAt(from).from), ...(to > from ? [form.range(from, to)] : []), ...widgets], true);
    }
    return marks;
  },
  provide: (f) => EditorView.decorations.from(f),
});
