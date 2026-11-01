# Getting started

## Install

Download `ZParen_<version>_aarch64.dmg` from the
[latest release](https://github.com/eric-zhu-2019/zparen/releases/latest),
open it, and drag ZParen to Applications.

- ZParen needs a Mac with Apple silicon and macOS 13 or later.
- Releases are signed with a Developer ID and notarized by Apple, so they open
  with a double-click.
- Releases carry their own SBCL. When `sbcl` is installed, for example with
  Homebrew, ZParen uses that one instead.
- Releases from GitHub do not update themselves yet. To update, download the
  new disk image.

To build ZParen yourself, see [Develop and release](development.md).

## The first start

The first start builds an SBCL core with Swank preloaded and caches it in
`~/Library/Caches/ZParen`. That takes about two seconds. Later starts take
milliseconds, and the core rebuilds by itself when SBCL or the bundled Lisp
files change.

Open a folder with **Open Project…** (⌘O), or create one with **New Project**
(⇧⌘N). A new project has an ASDF system, a test system and a build target,
and its language is Common Lisp or Coalton. [Projects](projects.md) explains
the choices.

## The first keys to learn

| Key | Does |
| --- | --- |
| ⌘↩ | Evaluate the form at the cursor |
| ⌘B | Compile and load the file |
| ⌘J | Go to the REPL, and back to the editor |
| ⌘L | Open the assistant |
| ⇧⌘P | Open the command palette |
| ⇧⌘/ | List every shortcut, with a filter |
| ⌘, | Open Settings |

Vim keys are on from the start. In Vim, the same commands are on `,e`, `,l`
and the other keys in [Edit code](editing.md#keys). Settings turns off Vim
keys, Emacs sequences, parinfer and checking as you type.

## Where ZParen keeps its files

| Folder | Holds |
| --- | --- |
| `~/Library/Application Support/ZParen` | Lisp settings, assistant keys and conversations, the MCP token, your themes, and startup images |
| `~/.config/zparen/plugins` | Your plugins, or `$XDG_CONFIG_HOME/zparen/plugins` when that is set |
| `~/Library/Caches/ZParen` | The cached SBCL cores, which ZParen rebuilds when they are missing |

## Next

- [Run and debug](run-and-debug.md): the REPL, the inspector and the debugger.
- [Edit code](editing.md): keys, Vim text objects and structural editing.
- [Assistant and MCP](assistant.md): Claude or OpenAI in the app, and Claude
  Code in your image.
