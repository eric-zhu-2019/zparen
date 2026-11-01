# Projects

## Open or create a project

Open a folder with **Open Project…** (⌘O), or create one with **New Project**
(⇧⌘N). Both are in the File menu, with Open Recent and Close Project, and in the
menu under the project's name in the title bar. Leaving a project with unsaved
files asks to save them first.

A new project has an ASDF system, a test system, and an executable build
target. Its language is Common Lisp or [Coalton](coalton.md). It takes its
dependencies from Quicklisp, or from ocicl with each version pinned in
`ocicl.csv`.
To use ocicl, run `brew install ocicl` and `ocicl setup` once.

## Dependencies

ZParen finds the dependency manager from the files in the project root:

| Found in the root | Manager | Dependencies come from |
| --- | --- | --- |
| `qlfile` | qlot | `.qlot/setup.lisp`, after **Install Dependencies** runs `qlot install` |
| `ocicl.csv` or `ocicl/` | ocicl | ocicl's runtime, which fetches missing systems as they load |
| `vendor/`, `lib/`, `third_party/`, or `deps/` holding `.asd` files | vendor | those directories, added to the ASDF source registry |
| none of the above | Quicklisp | `~/quicklisp`, `~/.quicklisp`, or Roswell's Quicklisp |

The **Packages** tab lists what the project's systems depend on, with each
one's version, where it comes from and whether it is loaded. It adds and
removes dependencies, updates one (with ocicl or qlot) or all of them, and with
ocicl pins a dependency to any version the registry offers.

qlot and ocicl replace the global Quicklisp, so a project with a `qlfile` or
`ocicl.csv` does not load it.

## Systems

The **Systems** sidebar lists every system in the project's `.asd` files. Each
has four buttons:

- **Run** loads the system and calls its `:entry-point` in the REPL, the way
  its built program would start.
- **Load** loads the system and fetches its dependencies.
- **Test** runs `asdf:test-system`.
- **Build** runs `asdf:make` in a separate SBCL and streams the output to the
  **Output** panel.

## Startup images

A startup image is an SBCL core saved with the project's systems loaded, so
Lisp starts with them instead of loading them again. It is built in a
separate SBCL, and the running Lisp is not touched.

- **Save startup image** in the title bar saves one. The button shows while
  the project has no image, and says **Startup image out of date** when the
  image no longer matches. Hover it to see why.
- When only the project's files changed, Lisp still starts from the old
  image, then compiles what changed. An image built on another version of
  ZParen or SBCL is not used.
- Settings ▸ Lisp ▸ **Startup image** saves, saves again or deletes the
  project's image.
- **Keep up to date** saves the image again after each load in a separate
  SBCL. Loading the project there runs its load-time code a second time.
- **Delete all startup images…** deletes every project's image and ZParen's
  cached base cores.
