import { Language, ParseContext, syntaxHighlighting } from "@codemirror/language";
import { type EditorState, type Extension, Facet } from "@codemirror/state";
import { type Input, Parser, type PartialParse, type Tree, type TreeFragment } from "@lezer/common";
import { buildDocument, buildTree, lispData, lispHighlighter, type Region } from "./lispSyntax";

/**
 * How a view's text divides into Lisp and other text. The REPL provides it,
 * so that a program's output never colors the input after it. Without it the
 * whole text is code.
 */
export const lispRegions = Facet.define<(state: EditorState) => Region[], ((state: EditorState) => Region[]) | null>({
  combine: (values) => values[0] ?? null,
});

/** Reads the text in one step. In an editor, the parts an edit did not touch are kept. */
class LispParse implements PartialParse {
  parsedPos = 0;
  stoppedAt: number | null = null;
  constructor(
    private readonly input: Input,
    private readonly fragments: readonly TreeFragment[],
  ) {}
  stopAt(pos: number) {
    this.stoppedAt = pos;
  }
  advance(): Tree {
    const text = this.input.read(0, this.input.length);
    const state = ParseContext.get()?.state;
    const regions = state?.facet(lispRegions)?.(state);
    this.parsedPos = this.input.length;
    return regions ? buildTree(text, regions) : buildDocument(text, this.fragments);
  }
}

class LispParser extends Parser {
  createParse(input: Input, fragments: readonly TreeFragment[]): PartialParse {
    return new LispParse(input, fragments);
  }
}

export const lispLanguage = new Language(lispData, new LispParser(), [], "lisp");

export function lisp(): Extension {
  return [lispLanguage, syntaxHighlighting(lispHighlighter)];
}
