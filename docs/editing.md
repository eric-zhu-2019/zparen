# Edit code

## Keys

Press ⇧⌘/ for every shortcut, with a filter. The list comes from the same
table that defines the bindings, so it is always current.

![The shortcuts screen in the dark theme, with each command's key, Vim binding and Emacs sequence](screenshots/shortcuts-dark.png)

These are the ones you use most:

| Action | Shortcut | Vim |
| --- | --- | --- |
| Evaluate the form at the cursor | ⌘↩ | `,e` |
| Compile the form, with compiler notes | ⇧⌘↩ | `,c` |
| Compile and load the file | ⌘B | `,l` |
| Go to definition, find references | F12, ⇧F12 | `gd`, `gr` |
| Go back, go forward | ⌃O, ⌃⇧O | same in Vim |
| Slurp, barf | ⌃), ⌃} | `>)`, `<)` |
| Select a form | ⌃⇧⌘→ | `vaf` |
| Change the symbol at the cursor | | `cie` |
| Search in project | ⇧⌘F | |
| Command palette | ⇧⌘P | |

SLIME's Emacs sequences work too, in any Vim mode:

| Sequence | Action |
| --- | --- |
| `C-x C-e` | Evaluate the form before the cursor |
| `C-M-x` | Evaluate the top-level form |
| `C-c C-c` | Compile the top-level form |
| `C-c C-k` | Compile and load the file |
| `M-.`, `M-,` | Go to a definition, and back |
| `C-c C-z` | Switch to the REPL |

The status bar shows a prefix such as `C-c` while you type it, and `C-g`
cancels it. Plugin commands list their keys in the same ⇧⌘/ screen.

Turn off Vim keys, Emacs sequences, parinfer or checking as you type in
Settings (⌘,).

## Structure

Parinfer keeps parentheses balanced as you type, and typing `(` or `"` over
a selection wraps it. The structural commands move code by whole forms:
slurp, barf, raise, splice, kill, transpose, split, and join.

In Vim, these text objects work after an operator such as `d`, `c` or `y`,
and in Visual mode:

| Keys | Selects | Example |
| --- | --- | --- |
| `ie` | The symbol, string or list at the cursor, hyphens included | `cie` renames `skip-down-all` |
| `ae` | The same, with the space next to it | `dae` deletes an argument and its space |
| `if` | Everything inside the enclosing list's parentheses | `cif` rewrites the whole call |
| `af` | The enclosing list, with its parentheses | `daf` deletes the call |
| `iF`, `aF` | The same for the top-level form | `yaF` copies the whole `defun` |

Pressing `ie`, `af` or `if` again in Visual mode grows the selection to the
next list out.

## Checking as you type

Each file is compiled in the background, without loading it, and warnings
mark the exact symbol. Saving compiles only the top-level forms that changed
into the running Lisp. A loaded file changed by git or another editor is
compiled the same way.

The **Problems** panel lists compiler notes from every file. Every warning
and error mark has an **Ask AI to fix** button, described in
[Assistant and MCP](assistant.md#ask-ai-to-fix).

![Checking as you type: SBCL's warning marks the undefined variable, and the status bar shows the argument list](screenshots/live-check.png)

## Navigation and completion

`gd` goes to local bindings first, then to Lisp's own record of a definition,
then to definitions in code not loaded yet. ⌃O goes back.

Completion offers package and system names where code names them, such as
`(:use #:alexan`. ⌃N and ⌃P move through the list. `K` shows a symbol's
documentation in a popup.

## Files and search

The file tree creates, renames, and moves files to the Trash. When another
program changes an open file, ZParen reloads it if you have no unsaved
edits, and asks otherwise. It also asks before closing a file or quitting
with unsaved changes. Files outside the project are read-only and show a lock.
SBCL's own sources, which go to definition can open, are an example.

**Search** in the sidebar finds and replaces across the project, with the
same `.gitignore` rules as ripgrep. The trash button in the bottom panel
clears whichever tab is showing.

## The editor

- Split panes, side by side.
- A git gutter with inline diffs, and a Revert button on each change.
- Word wrap (⌥Z) and Markdown preview (⇧⌘V).
- A choice of editor and interface fonts.
- Solarized, Nord and Gruvbox themes, picked separately for light and dark.
  Your own themes are JSON files in the themes folder, which Settings opens.

![Two editor panes side by side, with main.lisp and package.lisp open](screenshots/split-panes.png)

![The git gutter and inline diff, with a Revert button on each change](screenshots/git-diff.png)
