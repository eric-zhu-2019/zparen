//! The assistant answered by a coding agent the user already has, Claude Code
//! or Codex, run as a command with the agent's own login. ZParen's tools reach
//! the agent through the MCP server. Each turn sends a header naming itself,
//! so Stop can end the Lisp work the turn's tool calls started.

use crate::assistant::AssistantEvent;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

/// The header an agent's MCP requests carry, naming the turn they belong to.
pub const TURN_HEADER: &str = "x-zparen-turn";

/// The environment variable that hands Codex the MCP token, so it is not on the command line.
const TOKEN_VAR: &str = "ZPAREN_MCP_TOKEN";

/// The name ZParen's MCP server goes by inside the agent. Claude Code prefixes its tools with `mcp__zparen__`.
const SERVER: &str = "zparen";

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Agent {
    ClaudeCode,
    Codex,
}

/// What a turn needs to start the agent.
pub struct Run<'a> {
    pub program: &'a Path,
    /// None leaves the model to the agent's own settings.
    pub model: Option<&'a str>,
    /// The agent's own conversation to continue.
    pub resume: Option<&'a str>,
    pub system: &'a str,
    pub cwd: &'a Path,
    pub mcp_url: &'a str,
    pub token: &'a str,
    pub turn: &'a str,
    /// Where Claude Code's MCP configuration is written, readable only by the user.
    pub mcp_file: &'a Path,
}

impl Agent {
    pub fn name(self) -> &'static str {
        match self {
            Agent::ClaudeCode => "Claude Code",
            Agent::Codex => "Codex",
        }
    }

    fn command_name(self) -> &'static str {
        match self {
            Agent::ClaudeCode => "claude",
            Agent::Codex => "codex",
        }
    }

    /// The agent's program: on the PATH, or where its installer puts it.
    pub fn program(self) -> Option<PathBuf> {
        let name = self.command_name();
        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
        let home = crate::project::home();
        dirs.extend([home.join(".local/bin"), home.join(".claude/local"), PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")]);
        dirs.into_iter().map(|d| d.join(name)).find(|p| p.is_file())
    }

    /// Why the agent cannot answer yet, or None when it is installed and logged in.
    pub async fn problem(self) -> Option<String> {
        let Some(program) = self.program() else {
            return Some(match self {
                Agent::ClaudeCode => "Claude Code is not installed. Install it from claude.com/code, then run `claude` once to log in.".into(),
                Agent::Codex => "Codex is not installed. Install it with `brew install codex`, then run `codex login`.".into(),
            });
        };
        let args: &[&str] = match self {
            Agent::ClaudeCode => &["auth", "status"],
            Agent::Codex => &["login", "status"],
        };
        let out = tokio::process::Command::new(&program).args(args).stdin(Stdio::null()).output().await;
        let logged_in = out.is_ok_and(|o| match self {
            Agent::ClaudeCode => serde_json::from_slice::<Value>(&o.stdout).ok().and_then(|v| v["loggedIn"].as_bool()).unwrap_or(o.status.success()),
            Agent::Codex => o.status.success(),
        });
        (!logged_in).then(|| match self {
            Agent::ClaudeCode => "Claude Code is not logged in. Run `claude` in a terminal and log in.".into(),
            Agent::Codex => "Codex is not logged in. Run `codex login` in a terminal.".into(),
        })
    }

    /// The command for one turn. The prompt goes in on standard input.
    pub fn command(self, run: &Run) -> std::io::Result<tokio::process::Command> {
        let mut cmd = tokio::process::Command::new(run.program);
        cmd.current_dir(run.cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        match self {
            Agent::ClaudeCode => {
                let config = json!({ "mcpServers": { SERVER: {
                    "type": "http",
                    "url": run.mcp_url,
                    "headers": { "Authorization": format!("Bearer {}", run.token), TURN_HEADER: run.turn },
                }}});
                write_private(run.mcp_file, &config.to_string())?;
                cmd.args(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]);
                // Only ZParen's tools, so the agent works in the image the way the API providers do.
                cmd.args(["--tools", "", "--strict-mcp-config", "--allowedTools", "mcp__zparen", "--mcp-config"]);
                cmd.arg(run.mcp_file).arg("--append-system-prompt").arg(run.system);
                if let Some(m) = run.model {
                    cmd.args(["--model", m]);
                }
                if let Some(id) = run.resume {
                    cmd.args(["--resume", id]);
                }
            }
            Agent::Codex => {
                cmd.env(TOKEN_VAR, run.token).args(["exec"]);
                if run.resume.is_some() {
                    cmd.arg("resume");
                }
                cmd.args(["--json", "--skip-git-repo-check"]);
                // The table replaces the user's own MCP servers for this run, so only ZParen's tools load.
                let server = format!(
                    "mcp_servers={{{SERVER}={{url={},bearer_token_env_var=\"{TOKEN_VAR}\",http_headers={{\"{TURN_HEADER}\"={}}}}}}}",
                    toml_string(run.mcp_url),
                    toml_string(run.turn)
                );
                for c in [server, "sandbox_mode=\"read-only\"".into(), format!("developer_instructions={}", toml_string(run.system))] {
                    cmd.arg("-c").arg(c);
                }
                if let Some(m) = run.model {
                    cmd.args(["-m", m]);
                }
                cmd.arg("--");
                if let Some(id) = run.resume {
                    cmd.arg(id);
                }
                cmd.arg("-");
            }
        }
        Ok(cmd)
    }
}

/// A TOML basic string. JSON's escapes are all valid in one.
fn toml_string(s: &str) -> String {
    Value::String(s.into()).to_string()
}

fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    std::fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    f.write_all(text.as_bytes())
}

type Emit = Arc<dyn Fn(AssistantEvent) + Send + Sync>;

/// One turn's output from the agent, read a JSON line at a time. Text and
/// tool calls stream to the chat; ZParen's tool calls and the replies go into
/// the history in the API's own blocks, so the conversation can continue
/// with any provider.
#[derive(Default)]
pub struct Stream {
    /// Makes the agent's tool call ids unique across turns, since Codex numbers its items per turn.
    pub turn: String,
    /// The agent's own conversation id.
    pub session: Option<String>,
    /// How the turn ended: its stop reason, or why it failed.
    pub outcome: Option<Result<String, String>>,
    /// Text streamed since the last whole message, so a message is not shown twice.
    streamed: bool,
    /// The chat already shows text in this reply, so the next message starts a new paragraph.
    texted: bool,
}

impl Stream {
    pub fn new(turn: &str) -> Stream {
        Stream { turn: turn.into(), ..Default::default() }
    }

    pub fn claude(&mut self, v: &Value, emit: &Emit, history: &mut Vec<Value>) {
        if let Some(id) = v["session_id"].as_str() {
            self.session = Some(id.into());
        }
        match v["type"].as_str().unwrap_or_default() {
            "stream_event" => {
                let delta = &v["event"]["delta"];
                match delta["type"].as_str() {
                    Some("text_delta") => {
                        self.streamed = true;
                        emit(AssistantEvent::Text { text: delta["text"].as_str().unwrap_or_default().into() });
                    }
                    Some("thinking_delta") => emit(AssistantEvent::Thinking { text: delta["thinking"].as_str().unwrap_or_default().into() }),
                    _ => {}
                }
            }
            "assistant" => {
                for b in v["message"]["content"].as_array().into_iter().flatten() {
                    match b["type"].as_str() {
                        Some("text") => {
                            let text = b["text"].as_str().unwrap_or_default();
                            if !self.streamed {
                                emit(AssistantEvent::Text { text: text.into() });
                            }
                            push(history, "assistant", json!({ "type": "text", "text": text }));
                        }
                        Some("tool_use") => {
                            let raw = b["name"].as_str().unwrap_or_default();
                            let name = raw.strip_prefix("mcp__zparen__").unwrap_or(raw);
                            let id = b["id"].as_str().unwrap_or_default();
                            emit(AssistantEvent::ToolStarted { id: id.into(), name: name.into(), input: b["input"].to_string() });
                            push(history, "assistant", json!({ "type": "tool_use", "id": id, "name": name, "input": b["input"] }));
                        }
                        _ => {}
                    }
                }
                self.streamed = false;
            }
            "user" => {
                for b in v["message"]["content"].as_array().into_iter().flatten().filter(|b| b["type"] == "tool_result") {
                    let output = match &b["content"] {
                        Value::String(s) => s.clone(),
                        Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n"),
                        _ => String::new(),
                    };
                    let failed = b["is_error"].as_bool().unwrap_or(false);
                    let id = b["tool_use_id"].as_str().unwrap_or_default();
                    emit(AssistantEvent::ToolFinished { id: id.into(), ok: !failed, output: output.clone() });
                    push(history, "user", json!({ "type": "tool_result", "tool_use_id": id, "content": output, "is_error": failed }));
                }
            }
            "result" => {
                self.outcome = Some(if v["is_error"].as_bool().unwrap_or(false) || v["subtype"] != "success" {
                    let errors = v["errors"].as_array().map(|e| e.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\n")).unwrap_or_default();
                    let why = v["result"].as_str().filter(|r| !r.is_empty()).map(String::from).unwrap_or(errors);
                    Err(if why.is_empty() { format!("Claude Code stopped: {}", v["subtype"].as_str().unwrap_or("error")) } else { why })
                } else {
                    Ok(v["stop_reason"].as_str().unwrap_or("end_turn").into())
                });
            }
            _ => {}
        }
    }

    pub fn codex(&mut self, v: &Value, emit: &Emit, history: &mut Vec<Value>) {
        let item = &v["item"];
        let id = format!("call_{}_{}", self.turn, item["id"].as_str().unwrap_or_default());
        let ours = item["server"] == SERVER;
        match (v["type"].as_str().unwrap_or_default(), item["type"].as_str().unwrap_or_default()) {
            ("thread.started", _) => self.session = v["thread_id"].as_str().map(String::from),
            ("item.started", "mcp_tool_call") => {
                let tool = item["tool"].as_str().unwrap_or_default();
                let name = if ours { tool.to_string() } else { format!("{}.{tool}", item["server"].as_str().unwrap_or_default()) };
                emit(AssistantEvent::ToolStarted { id: id.clone(), name: name.clone(), input: item["arguments"].to_string() });
                if ours {
                    push(history, "assistant", json!({ "type": "tool_use", "id": id, "name": name, "input": item["arguments"] }));
                }
                self.texted = false;
            }
            ("item.completed", "mcp_tool_call") => {
                let parts = item["result"]["content"].as_array().into_iter().flatten().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>();
                let error = item["error"]["message"].as_str().or(item["error"].as_str());
                let failed = error.is_some() || item["status"] != "completed" || item["result"]["is_error"] == true;
                let output = error.map(String::from).unwrap_or_else(|| parts.join("\n"));
                emit(AssistantEvent::ToolFinished { id: id.clone(), ok: !failed, output: output.clone() });
                if ours {
                    push(history, "user", json!({ "type": "tool_result", "tool_use_id": id, "content": output, "is_error": failed }));
                }
            }
            // Codex's own shell is shown, but kept out of the history: other providers do not have the tool.
            ("item.started", "command_execution") => {
                emit(AssistantEvent::ToolStarted { id, name: "shell".into(), input: json!({ "command": item["command"] }).to_string() });
                self.texted = false;
            }
            ("item.completed", "command_execution") => emit(AssistantEvent::ToolFinished {
                id,
                ok: item["exit_code"] == 0,
                output: item["aggregated_output"].as_str().unwrap_or_default().into(),
            }),
            ("item.completed", "agent_message") => {
                let text = item["text"].as_str().unwrap_or_default();
                emit(AssistantEvent::Text { text: if self.texted { format!("\n\n{text}") } else { text.into() } });
                self.texted = true;
                push(history, "assistant", json!({ "type": "text", "text": text }));
            }
            ("item.completed", "reasoning") => emit(AssistantEvent::Thinking { text: format!("{}\n", item["text"].as_str().unwrap_or_default()) }),
            ("turn.completed", _) => self.outcome = Some(Ok("end_turn".into())),
            ("turn.failed", _) => self.outcome = Some(Err(v["error"]["message"].as_str().unwrap_or("Codex could not finish the reply.").into())),
            ("error", _) => self.outcome = Some(Err(v["message"].as_str().unwrap_or("Codex reported an error.").into())),
            _ => {}
        }
    }
}

/// Adds a block to the history, in the last message when it has the same role:
/// one assistant message per reply, and one message for the tool results that follow it.
fn push(history: &mut Vec<Value>, role: &str, block: Value) {
    if let Some(last) = history.last_mut()
        && last["role"] == role
        && (role == "assistant" || last["content"].as_array().is_some_and(|c| c.iter().all(|b| b["type"] == "tool_result")))
        && let Some(content) = last["content"].as_array_mut()
    {
        content.push(block);
        return;
    }
    history.push(json!({ "role": role, "content": [block] }));
}

/// The words of `messages`, for an agent that joins a conversation another provider began.
pub fn transcript(messages: &[Value]) -> String {
    let mut out = String::new();
    for m in messages {
        let who = if m["role"] == "user" { "User" } else { "Assistant" };
        for b in m["content"].as_array().into_iter().flatten() {
            let line = match b["type"].as_str() {
                Some("text") => b["text"].as_str().unwrap_or_default().to_string(),
                Some("tool_use") => format!("(called {} with {})", b["name"].as_str().unwrap_or_default(), b["input"]),
                _ => continue,
            };
            out.push_str(&format!("{who}: {line}\n\n"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(lines: &str, codex: bool) -> (Vec<AssistantEvent>, Vec<Value>, Stream) {
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = events.clone();
        let emit: Emit = Arc::new(move |e| sink.lock().unwrap().push(e));
        let mut stream = Stream::new("7");
        let mut history = vec![json!({ "role": "user", "content": [{ "type": "text", "text": "go" }] })];
        for line in lines.lines().filter(|l| !l.trim().is_empty()) {
            let v: Value = serde_json::from_str(line).unwrap();
            if codex {
                stream.codex(&v, &emit, &mut history);
            } else {
                stream.claude(&v, &emit, &mut history);
            }
        }
        let events = events.lock().unwrap().clone();
        (events, history, stream)
    }

    #[test]
    fn a_claude_code_turn_becomes_chat_events_and_api_history() {
        // Lines as Claude Code 2.1 printed them for a turn that evaluated (+ 1 2), shortened.
        let lines = r#"
{"type":"system","subtype":"init","session_id":"s1","tools":["mcp__zparen__eval"]}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"mcp__zparen__eval","input":{"form":"(+ 1 2)"},"caller":{"type":"direct"}}]},"session_id":"s1"}
{"type":"user","message":{"content":[{"tool_use_id":"toolu_1","type":"tool_result","content":[{"type":"text","text":"Values:\n3"}]}]},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Thr"}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ee"}},"session_id":"s1"}
{"type":"assistant","message":{"content":[{"type":"text","text":"Three"}]},"session_id":"s1"}
{"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","result":"Three","session_id":"s1"}
"#;
        let (events, history, stream) = run(lines, false);
        assert_eq!(
            events,
            vec![
                AssistantEvent::ToolStarted { id: "toolu_1".into(), name: "eval".into(), input: r#"{"form":"(+ 1 2)"}"#.into() },
                AssistantEvent::ToolFinished { id: "toolu_1".into(), ok: true, output: "Values:\n3".into() },
                AssistantEvent::Text { text: "Thr".into() },
                AssistantEvent::Text { text: "ee".into() },
            ],
            "the text shows once, as it streamed"
        );
        assert_eq!(
            history[1..],
            [
                json!({ "role": "assistant", "content": [{ "type": "tool_use", "id": "toolu_1", "name": "eval", "input": { "form": "(+ 1 2)" } }] }),
                json!({ "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "toolu_1", "content": "Values:\n3", "is_error": false }] }),
                json!({ "role": "assistant", "content": [{ "type": "text", "text": "Three" }] }),
            ]
        );
        assert_eq!(stream.session.as_deref(), Some("s1"));
        assert_eq!(stream.outcome, Some(Ok("end_turn".into())));
    }

    #[test]
    fn a_claude_code_error_ends_the_turn_with_its_message() {
        let (events, _, stream) = run(
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Not logged in · Please run /login"}]}}
{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}"#,
            false,
        );
        assert_eq!(events, vec![AssistantEvent::Text { text: "Not logged in · Please run /login".into() }], "unstreamed text still shows");
        assert_eq!(stream.outcome, Some(Err("Not logged in · Please run /login".into())));
    }

    #[test]
    fn a_codex_turn_becomes_chat_events_and_api_history() {
        // Lines as Codex 0.164 printed them for a turn that evaluated (+ 1 2).
        let lines = r#"
{"type":"thread.started","thread_id":"t1"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Codex is ignoring 2 unrecognized configuration settings."}}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_3","type":"reasoning","text":"**Preparing to evaluate**"}}
{"type":"item.completed","item":{"id":"item_4","type":"agent_message","text":"Evaluating it."}}
{"type":"item.started","item":{"id":"item_6","type":"mcp_tool_call","server":"zparen","tool":"eval","arguments":{"form":"(+ 1 2)"},"result":null,"error":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_6","type":"mcp_tool_call","server":"zparen","tool":"eval","arguments":{"form":"(+ 1 2)"},"result":{"content":[{"type":"text","text":"Values:\n3"}],"structured_content":null},"error":null,"status":"completed"}}
{"type":"item.started","item":{"id":"item_7","type":"command_execution","command":"ls","status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_7","type":"command_execution","command":"ls","aggregated_output":"a.lisp\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_8","type":"agent_message","text":"Three"}}
{"type":"item.completed","item":{"id":"item_9","type":"agent_message","text":"Done."}}
{"type":"turn.completed","usage":{"input_tokens":1}}
"#;
        let (events, history, stream) = run(lines, true);
        assert_eq!(
            events,
            vec![
                AssistantEvent::Thinking { text: "**Preparing to evaluate**\n".into() },
                AssistantEvent::Text { text: "Evaluating it.".into() },
                AssistantEvent::ToolStarted { id: "call_7_item_6".into(), name: "eval".into(), input: r#"{"form":"(+ 1 2)"}"#.into() },
                AssistantEvent::ToolFinished { id: "call_7_item_6".into(), ok: true, output: "Values:\n3".into() },
                AssistantEvent::ToolStarted { id: "call_7_item_7".into(), name: "shell".into(), input: r#"{"command":"ls"}"#.into() },
                AssistantEvent::ToolFinished { id: "call_7_item_7".into(), ok: true, output: "a.lisp\n".into() },
                AssistantEvent::Text { text: "Three".into() },
                AssistantEvent::Text { text: "\n\nDone.".into() },
            ],
            "warnings are not shown, and a second message starts a new paragraph"
        );
        assert_eq!(
            history[1..],
            [
                json!({ "role": "assistant", "content": [
                    { "type": "text", "text": "Evaluating it." },
                    { "type": "tool_use", "id": "call_7_item_6", "name": "eval", "input": { "form": "(+ 1 2)" } },
                ] }),
                json!({ "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "call_7_item_6", "content": "Values:\n3", "is_error": false }] }),
                json!({ "role": "assistant", "content": [{ "type": "text", "text": "Three" }, { "type": "text", "text": "Done." }] }),
            ],
            "the shell call stays out of the history"
        );
        assert_eq!(stream.session.as_deref(), Some("t1"));
        assert_eq!(stream.outcome, Some(Ok("end_turn".into())));
    }

    #[test]
    fn a_failed_codex_tool_call_and_turn_are_reported() {
        let (events, _, stream) = run(
            r#"{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"zparen","tool":"eval","arguments":{},"result":null,"error":{"message":"tool call failed"},"status":"failed"}}
{"type":"turn.failed","error":{"message":"usage limit reached"}}"#,
            true,
        );
        assert_eq!(events, vec![AssistantEvent::ToolFinished { id: "call_7_item_1".into(), ok: false, output: "tool call failed".into() }]);
        assert_eq!(stream.outcome, Some(Err("usage limit reached".into())));
    }

    #[test]
    fn the_codex_command_keeps_the_token_off_the_command_line() {
        let dir = std::env::temp_dir().join(format!("zparen-agent-{}", std::process::id()));
        let run = Run {
            program: Path::new("/bin/echo"),
            model: Some("gpt-6.1-sol"),
            resume: Some("t1"),
            system: "Be \"short\".",
            cwd: Path::new("/"),
            mcp_url: "http://127.0.0.1:7337/mcp",
            token: "secret",
            turn: "42",
            mcp_file: &dir.join("mcp.json"),
        };
        let cmd = Agent::Codex.command(&run).unwrap();
        let args: Vec<String> = cmd.as_std().get_args().map(|a| a.to_string_lossy().into()).collect();
        assert!(!args.iter().any(|a| a.contains("secret")), "{args:?}");
        assert_eq!(args[..4], ["exec", "resume", "--json", "--skip-git-repo-check"]);
        assert!(args.contains(&r#"mcp_servers={zparen={url="http://127.0.0.1:7337/mcp",bearer_token_env_var="ZPAREN_MCP_TOKEN",http_headers={"x-zparen-turn"="42"}}}"#.to_string()), "{args:?}");
        assert!(args.contains(&r#"developer_instructions="Be \"short\".""#.to_string()));
        assert_eq!(args[args.len() - 3..], ["--", "t1", "-"]);

        let cmd = Agent::ClaudeCode.command(&run).unwrap();
        let args: Vec<String> = cmd.as_std().get_args().map(|a| a.to_string_lossy().into()).collect();
        assert!(!args.iter().any(|a| a.contains("secret")), "{args:?}");
        let config: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("mcp.json")).unwrap()).unwrap();
        assert_eq!(config["mcpServers"]["zparen"]["headers"]["Authorization"], "Bearer secret");
        assert_eq!(config["mcpServers"]["zparen"]["headers"][TURN_HEADER], "42");
        let mode = std::os::unix::fs::PermissionsExt::mode(&std::fs::metadata(dir.join("mcp.json")).unwrap().permissions());
        assert_eq!(mode & 0o777, 0o600);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
