# Built with Claude Code in a weekend

I subscribe to Claude Code, so I used it to build ZParen from scratch.

I used pstack and told Claude Code to "create an IDE to edit, debug and manage
Common Lisp projects". That is a shorter version of what I wrote.

After some experiments, I also chose Rust and Tauri for the app.
Some people may ask why I did not write all of it in Lisp. In my opinion, it is
better to use the right tool for each job.

## Skills and agents involved

With pstack's `/pstack:poteto-mode`, Claude Code kept working while I slept.
It loaded these skills while it built ZParen:

| Skill | What it was used for |
| --- | --- |
| `pstack:poteto-mode` | The working mode: playbooks for features and bug fixes, and the principles below |
| `figure-it-out` | Planning the large multi-phase build-out |
| `feature` playbook | Each new feature, starting from its data shape |
| `show-me-your-work` | The decision trail kept during long autonomous runs |
| `technical-writing` | This README, the docs and the commit messages |
| `no-comments` | Keeping only comments that explain a non-obvious why |
| `claude-api` | The built-in assistant's Anthropic API client, model and streaming |
| Principles | `prove-it-works`, `foundational-thinking`, `model-the-domain`, `experience-first`, `exhaust-the-design-space`, `sequence-verifiable-units`, `laziness-protocol`, `build-the-lever`, `boundary-discipline`, `test-behavior-not-implementation`, `never-block-on-the-human` |


Subagents took on separate pieces. Each coding agent worked in its own git worktree:

| Agent | Work |
| --- | --- |
| `pstack:poteto-agent` | The SLIME-compatible indentation engine, paredit-style structural editing, the parinfer wasm crate, and the MCP server with its shared tool registry |
| `pstack:comment-sicko` | A pass that removed comments restating the code |
| `Explore` | Research into the UX of other Lisp IDEs |
| `general-purpose` | Side tasks, including an independent review of the decision trail |
