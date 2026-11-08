import { create } from "zustand";

export type Settings = {
  vim: boolean;
  /** SLIME's key sequences such as C-x C-e and M-., alongside Vim or alone. */
  emacs: boolean;
  parinfer: boolean;
  /** Compile each file in the background as it is edited, for its warnings. */
  liveCheck: boolean;
  /** Saving compiles the top-level forms that changed into the running Lisp. */
  compileOnSave: boolean;
  /** A loaded file changed outside ZParen, by git or another editor, has its changed forms compiled. */
  compileOnChange: boolean;
  /** A project's next session loads again the systems its last session loaded. */
  reloadSystems: boolean;
  /** After a load, a missing or old startup image is saved again in the background. */
  autoImage: boolean;
  /** The Welcome screen offers the Lisp course: to start it, or to continue it until every lesson is finished. */
  learnOnWelcome: boolean;
  /** Heads of forms are colored by what the running Lisp knows of them: macro, function or special operator. */
  semanticColors: boolean;
  /** The closing parens that end a line, which parinfer moves, are dimmed. */
  dimParenTrails: boolean;
  /** Thin lines in the indentation, under the open paren of each form that spans lines. */
  indentGuides: boolean;
  fontSize: number;
  /** The text size of the Assistant and Learn Lisp panels. */
  panelFontSize: number;
  /** Long lines wrap at the editor's edge instead of scrolling sideways. */
  wordWrap: boolean;
  /** The debugger shows SBCL's own text: the whole condition, every restart and every frame. */
  debuggerDetails: boolean;
  /** Where warnings and errors show: at the end of their lines, or in a box when the cursor reaches them. */
  problems: "inline" | "box";
  /** The font family for code: the editor, the REPL and code in panels. Empty keeps SF Mono. */
  editorFont: string;
  /** The font family for everything else. Empty keeps the system font. */
  uiFont: string;
  theme: "system" | "light" | "dark";
  /** The themes for light and dark appearance, by id; see themes.ts. */
  lightTheme: string;
  darkTheme: string;
  /** Widths of the left sidebar and the right panel, set by dragging their edges. */
  sidebarWidth: number;
  rightWidth: number;
};

const KEY = "zparen.settings";

export const SIDEBAR_WIDTH = 240;
export const RIGHT_WIDTH = 360;

function load(): Settings {
  const defaults: Settings = { vim: true, emacs: true, parinfer: true, liveCheck: true, compileOnSave: true, compileOnChange: true, reloadSystems: true, autoImage: false, learnOnWelcome: true, semanticColors: true, dimParenTrails: false, indentGuides: true, fontSize: 13, panelFontSize: 13, wordWrap: false, debuggerDetails: false, problems: "inline", editorFont: "", uiFont: "", theme: "system", lightTheme: "zparen-light", darkTheme: "zparen-dark", sidebarWidth: SIDEBAR_WIDTH, rightWidth: RIGHT_WIDTH };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

export const useSettings = create<Settings>(load);

useSettings.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
  }
});

export const updateSettings = (patch: Partial<Settings>) => useSettings.setState(patch);
