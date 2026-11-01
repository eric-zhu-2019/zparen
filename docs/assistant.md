# Assistant and MCP

## The assistant

Open the assistant with ⌘L. It answers with Claude or with OpenAI. The model
menu under the chat switches between them, even mid-conversation. Settings ▸
Assistant sets the model for each provider. The defaults are `claude-opus-5-5`
and `gpt-6.1-sol`, and you can type any other model name. **Stop** ends a reply
and any Lisp code the assistant was running for it.

Each provider needs an API key, which you can paste in the assistant. For
Claude, ZParen also uses `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or an
`ant auth login` profile. For OpenAI, it uses `OPENAI_API_KEY`. Set
`OPENAI_BASE_URL` to use another server that offers the Responses API.

Both providers use the same tools as the MCP server below. Code proposed in a
reply has **Insert** and **Eval** buttons.

![The assistant evaluates (* 6 7) in the live image and offers code with Copy, Insert and Eval](screenshots/assistant.png)

## Claude Code over MCP

To let Claude Code work in your image, register ZParen's MCP server once:

1. Open the assistant with ⌘L.
2. Click the gear icon at the top of the assistant panel.
3. Under **Use Claude Code with this image**, click **Copy command**.
4. Paste the command in a terminal and run it.

The command looks like this, with your token in place of `<token>`:

```sh
claude mcp add --transport http zparen http://127.0.0.1:7337/mcp --header "Authorization: Bearer <token>"
```

The token is a password that ZParen makes the first time its MCP server
starts. The server listens only on `127.0.0.1` and refuses any request
without the token, so other programs on your Mac cannot run code in your
image. The token stays the same each time ZParen starts, so you register only once.
It lives in `~/Library/Application Support/ZParen/mcp-token`, which only your
user can read. If you remove that file, ZParen makes a new token, and you
must register again. Keep the token out of chats and repositories.

The tools are `eval`, `compile_form`, `describe_symbol`, `apropos`,
`find_definitions`, `who_calls`, `macroexpand`, `list_packages`,
`project_info`, `load_system`, `run_tests`, `debugger_state`,
`invoke_restart`, `read_file`, `edit_file`, and `list_files`.

## Ask AI to fix

Every warning and error mark has an **Ask AI to fix** button. It shows in the
hover box and in the box that opens when the cursor reaches a mark. It sends
SBCL's message, the file, the line and the code to the assistant. The assistant
finds the cause and changes the file with `edit_file`. The
change shows in the editor at once, and one undo takes it back.

![Ask AI to fix: the assistant reads the warning and edits the file](screenshots/ask-ai-to-fix.png)
