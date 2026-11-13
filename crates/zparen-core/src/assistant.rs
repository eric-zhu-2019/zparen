use crate::agent::{self, Agent};
use crate::sexp::Sexp;
use crate::swank::{SENT, Thread};
use crate::tools;
use crate::workbench::Workbench;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Weak};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use ts_rs::TS;

/// The models offered for each provider, the default first. Any other name can be typed in.
const CLAUDE_MODELS: [&str; 4] = ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5"];
const OPENAI_MODELS: [&str; 4] = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-luna"];
/// For Claude Code and Codex, `default` leaves the model to the agent's own settings.
const DEFAULT_MODEL: &str = "default";
const API_VERSION: &str = "2026-10-21";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const MAX_TOKENS: u32 = 64000;
const MAX_TOOL_ROUNDS: usize = 40;

const SYSTEM: &str = "You are the assistant inside ZParen, a Common Lisp IDE on SBCL. You work in the user's \
running Lisp image through tools, while the user watches and edits the same image. Inspect before you change: read \
files, describe symbols and evaluate small experiments to ground your answers. Define or fix code with compile_form, \
so compiler notes come back to you. When the debugger opens, read it with debugger_state and choose a restart with \
invoke_restart rather than leaving it open. To fix code in the user's files, change the file with edit_file, then \
compile the changed form with compile_form so its notes come back to you. When you only propose code, put it in a \
fenced ```lisp block, starting with a comment line naming the file, so the user can insert it. In a ```lisp block, \
leave the code itself uncommented, so the user can evaluate it. Comment only the lines that show what the code \
returns, prints or expands to: start each of those lines with ;; (as in ;; => 42). Put explanations in prose \
outside the block. Keep answers short and concrete.";

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum AssistantEvent {
    TurnStarted,
    #[serde(rename_all = "camelCase")]
    Text { text: String },
    #[serde(rename_all = "camelCase")]
    Thinking { text: String },
    #[serde(rename_all = "camelCase")]
    ToolStarted { id: String, name: String, input: String },
    #[serde(rename_all = "camelCase")]
    ToolFinished { id: String, ok: bool, output: String },
    #[serde(rename_all = "camelCase")]
    Error { message: String },
    #[serde(rename_all = "camelCase")]
    TurnFinished { stop_reason: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditorContext {
    pub file: Option<String>,
    pub package: Option<String>,
    pub form: Option<String>,
    /// What `form` is, such as "The selection" or "A REPL result". Left out, it is the form at the cursor.
    #[serde(default)]
    #[ts(optional)]
    pub form_label: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Provider {
    Claude,
    OpenAI,
    /// The user's Claude Code, with its own login.
    #[serde(rename = "claudeCode")]
    ClaudeCode,
    /// The user's Codex, with its own login.
    Codex,
    /// A server the user names, such as Ollama or LM Studio, through its OpenAI-compatible chat API.
    Local,
}

impl Provider {
    fn agent(self) -> Option<Agent> {
        match self {
            Provider::ClaudeCode => Some(Agent::ClaudeCode),
            Provider::Codex => Some(Agent::Codex),
            Provider::Claude | Provider::OpenAI | Provider::Local => None,
        }
    }
}

/// Which provider answers, and the model chosen for each. Kept in `assistant.json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AssistantConfig {
    pub provider: Provider,
    pub claude_model: String,
    pub openai_model: String,
    pub claude_code_model: String,
    pub codex_model: String,
    /// The local server's address, such as `localhost:11434`. Empty until the user sets one.
    pub local_url: String,
    pub local_model: String,
}

impl Default for AssistantConfig {
    fn default() -> Self {
        AssistantConfig {
            provider: Provider::Claude,
            claude_model: CLAUDE_MODELS[0].into(),
            openai_model: OPENAI_MODELS[0].into(),
            claude_code_model: DEFAULT_MODEL.into(),
            codex_model: DEFAULT_MODEL.into(),
            local_url: String::new(),
            local_model: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderStatus {
    pub configured: bool,
    pub source: Option<CredentialSource>,
    pub models: Vec<String>,
    /// What to do before the provider can answer, when it cannot.
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AssistantStatus {
    pub busy: bool,
    pub config: AssistantConfig,
    pub claude: ProviderStatus,
    pub openai: ProviderStatus,
    pub claude_code: ProviderStatus,
    pub codex: ProviderStatus,
    pub local: ProviderStatus,
}

#[derive(Debug, Clone, Copy, Serialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CredentialSource {
    Settings,
    Environment,
    Ant,
    /// The agent's own login.
    Login,
}

#[derive(Debug, Clone)]
enum Credential {
    ApiKey(String),
    OAuth(String),
}

/// The turn being answered, and the Lisp requests its tools have sent.
struct Running {
    /// Names the turn in the MCP requests of an agent answering it.
    turn: String,
    task: JoinHandle<()>,
    sent: Arc<std::sync::Mutex<Vec<u64>>>,
    wb: Weak<Workbench>,
}

pub struct Assistant {
    http: reqwest::Client,
    data_dir: PathBuf,
    base_url: String,
    openai_url: String,
    history: Mutex<Vec<Value>>,
    running: Mutex<Option<Running>>,
    /// Where conversations are kept, one JSON file each, so they outlive the app.
    sessions_dir: PathBuf,
    /// The id of the conversation `history` belongs to.
    session: Mutex<String>,
    /// The agents' own conversations that continue this one.
    threads: Mutex<BTreeMap<Provider, AgentThread>>,
}

/// An agent's own conversation, and how much of the history it has seen.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentThread {
    id: String,
    seen: usize,
}

/// A saved conversation, as the history menu lists it.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionInfo {
    pub id: String,
    /// The start of its first message.
    pub title: String,
    /// The root of the project it was in, if one was open.
    pub project: Option<String>,
    /// When it last changed, in seconds since 1970.
    pub updated: u64,
}

#[derive(Serialize, Deserialize)]
struct SavedSession {
    #[serde(flatten)]
    info: SessionInfo,
    messages: Vec<Value>,
    #[serde(default)]
    threads: BTreeMap<Provider, AgentThread>,
}

fn new_session_id() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("{}", now.as_millis())
}

/// The words of a user message, without the editor context sent before them.
fn message_text(message: &Value) -> Option<String> {
    let content = message.get("content")?.as_array()?;
    if content.iter().any(|b| b.get("type").and_then(Value::as_str) == Some("tool_result")) {
        return None;
    }
    content.iter().rev().find_map(|b| b.get("text").and_then(Value::as_str)).map(String::from)
}

type Emit = Arc<dyn Fn(AssistantEvent) + Send + Sync>;

impl Assistant {
    pub fn new(data_dir: &Path) -> Assistant {
        Assistant {
            http: reqwest::Client::new(),
            data_dir: data_dir.into(),
            base_url: std::env::var("ANTHROPIC_BASE_URL").unwrap_or_else(|_| "https://api.anthropic.com".into()),
            openai_url: std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".into()),
            history: Mutex::new(Vec::new()),
            running: Mutex::new(None),
            sessions_dir: data_dir.join("assistant-sessions"),
            session: Mutex::new(new_session_id()),
            threads: Mutex::default(),
        }
    }

    /// Writes the current conversation, when it has a message, for the history menu to reopen.
    async fn save(&self, project: Option<String>) {
        let messages = self.history.lock().await.clone();
        let Some(title) = messages.iter().find(|m| m.get("role").and_then(Value::as_str) == Some("user")).and_then(message_text) else {
            return;
        };
        let title: String = title.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
        let id = self.session.lock().await.clone();
        let updated = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or_default();
        let threads = self.threads.lock().await.clone();
        let saved = SavedSession { info: SessionInfo { id: id.clone(), title, project, updated }, messages, threads };
        let _ = std::fs::create_dir_all(&self.sessions_dir);
        if let Ok(json) = serde_json::to_vec(&saved) {
            let _ = std::fs::write(self.sessions_dir.join(format!("{id}.json")), json);
        }
    }

    /// Saved conversations, the latest first.
    pub fn sessions(&self) -> Vec<SessionInfo> {
        let mut out: Vec<SessionInfo> = std::fs::read_dir(&self.sessions_dir)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| serde_json::from_slice::<SavedSession>(&std::fs::read(e.path()).ok()?).ok())
            .map(|s| s.info)
            .collect();
        out.sort_by(|a, b| b.updated.cmp(&a.updated));
        out
    }

    /// Continues a saved conversation: its messages become the history the next turn sends.
    pub async fn open_session(&self, id: &str) -> Result<Vec<Value>, String> {
        self.cancel().await;
        let bytes = std::fs::read(self.sessions_dir.join(format!("{id}.json"))).map_err(|_| "That conversation is gone.".to_string())?;
        let saved: SavedSession = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        *self.history.lock().await = saved.messages.clone();
        *self.threads.lock().await = saved.threads;
        *self.session.lock().await = saved.info.id;
        Ok(saved.messages)
    }

    pub async fn delete_session(&self, id: &str) {
        let _ = std::fs::remove_file(self.sessions_dir.join(format!("{id}.json")));
        if *self.session.lock().await == id {
            self.history.lock().await.clear();
            self.threads.lock().await.clear();
            *self.session.lock().await = new_session_id();
        }
    }

    fn key_file(&self, provider: Provider) -> Option<PathBuf> {
        Some(self.data_dir.join(match provider {
            Provider::Claude => "anthropic-api-key",
            Provider::OpenAI => "openai-api-key",
            Provider::Local => "local-api-key",
            Provider::ClaudeCode | Provider::Codex => return None,
        }))
    }

    pub fn config(&self) -> AssistantConfig {
        std::fs::read(self.data_dir.join("assistant.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub fn configure(&self, config: &AssistantConfig) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.data_dir)?;
        std::fs::write(self.data_dir.join("assistant.json"), serde_json::to_vec(config)?)
    }

    async fn credential(&self, provider: Provider) -> Option<(Credential, CredentialSource)> {
        let file = self.key_file(provider)?;
        if let Ok(k) = std::fs::read_to_string(file) {
            if !k.trim().is_empty() {
                return Some((Credential::ApiKey(k.trim().into()), CredentialSource::Settings));
            }
        }
        if provider == Provider::Local {
            return None;
        }
        let env = if provider == Provider::Claude { "ANTHROPIC_API_KEY" } else { "OPENAI_API_KEY" };
        if let Ok(k) = std::env::var(env) {
            if !k.is_empty() {
                return Some((Credential::ApiKey(k), CredentialSource::Environment));
            }
        }
        if provider == Provider::OpenAI {
            return None;
        }
        if let Ok(t) = std::env::var("ANTHROPIC_AUTH_TOKEN") {
            if !t.is_empty() {
                return Some((Credential::OAuth(t), CredentialSource::Environment));
            }
        }
        let out = tokio::process::Command::new("ant")
            .args(["auth", "print-credentials", "--access-token"])
            .output()
            .await
            .ok()?;
        let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (out.status.success() && !token.is_empty()).then_some((Credential::OAuth(token), CredentialSource::Ant))
    }

    pub async fn status(&self) -> AssistantStatus {
        let config = self.config();
        let (claude, openai, claude_code, codex, local) = tokio::join!(
            self.provider_status(Provider::Claude, &CLAUDE_MODELS),
            self.provider_status(Provider::OpenAI, &OPENAI_MODELS),
            self.provider_status(Provider::ClaudeCode, &CLAUDE_MODELS),
            self.provider_status(Provider::Codex, &OPENAI_MODELS),
            self.local_status(&config.local_url),
        );
        AssistantStatus {
            busy: self.running.lock().await.as_ref().is_some_and(|r| !r.task.is_finished()),
            config,
            claude,
            openai,
            claude_code,
            codex,
            local,
        }
    }

    async fn provider_status(&self, provider: Provider, models: &[&str]) -> ProviderStatus {
        if let Some(agent) = provider.agent() {
            let note = agent.problem().await;
            let models = std::iter::once(DEFAULT_MODEL).chain(models.iter().copied()).map(String::from).collect();
            return ProviderStatus { configured: note.is_none(), source: note.is_none().then_some(CredentialSource::Login), models, note };
        }
        let source = self.credential(provider).await.map(|(_, s)| s);
        ProviderStatus { configured: source.is_some(), source, models: models.iter().map(|m| m.to_string()).collect(), note: None }
    }

    /// Whether the local server answers, and the models it offers.
    async fn local_status(&self, url: &str) -> ProviderStatus {
        let source = self.credential(Provider::Local).await.map(|(_, s)| s);
        let Some(base) = local_base(url) else {
            let note = if url.trim().is_empty() {
                "Add the address of a server with an OpenAI-compatible API, such as Ollama (localhost:11434) or LM Studio (localhost:1234)."
            } else {
                "The server address must be a host and port, such as localhost:11434, or an http:// or https:// URL."
            };
            return ProviderStatus { configured: false, source, models: Vec::new(), note: Some(note.into()) };
        };
        match self.local_models(&base).await {
            Ok(models) if models.is_empty() => ProviderStatus {
                configured: true,
                source,
                models,
                note: Some(format!("The server at {base} lists no models. Load or pull a model there first.")),
            },
            Ok(models) => ProviderStatus { configured: true, source, models, note: None },
            Err(e) => ProviderStatus { configured: false, source, models: Vec::new(), note: Some(format!("Could not reach {base}: {e}")) },
        }
    }

    /// The model names the local server lists at `/models`.
    async fn local_models(&self, base: &str) -> Result<Vec<String>, String> {
        let mut req = local_client(&self.http, base).get(format!("{base}/models")).timeout(std::time::Duration::from_secs(3));
        if let Some((Credential::ApiKey(k) | Credential::OAuth(k), _)) = self.credential(Provider::Local).await {
            req = req.bearer_auth(k);
        }
        let resp = req.send().await.map_err(|e| without_url(&e))?;
        if !resp.status().is_success() {
            return Err(format!("the server answered {}", resp.status()));
        }
        let body: Value = resp.json().await.map_err(|_| "the server did not answer with a model list".to_string())?;
        let mut models: Vec<String> = body["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(String::from)).collect();
        models.sort();
        Ok(models)
    }

    pub fn set_key(&self, provider: Provider, key: &str) -> std::io::Result<()> {
        let file = self.key_file(provider).ok_or_else(|| std::io::Error::other("this provider uses its own login, not a key"))?;
        std::fs::create_dir_all(&self.data_dir)?;
        std::fs::write(&file, key.trim())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    }

    /// Starts a new conversation; the one before stays saved.
    pub async fn reset(&self) {
        self.cancel().await;
        self.history.lock().await.clear();
        self.threads.lock().await.clear();
        *self.session.lock().await = new_session_id();
    }

    /// The requests the running turn named `turn` has sent, for an agent's MCP tool call to add to.
    pub async fn turn_requests(&self, turn: &str) -> Option<Arc<std::sync::Mutex<Vec<u64>>>> {
        let running = self.running.lock().await;
        running.as_ref().filter(|r| r.turn == turn && !r.task.is_finished()).map(|r| r.sent.clone())
    }

    /// Stops the turn being answered, and the Lisp work its tools started.
    pub async fn cancel(&self) {
        let Some(run) = self.running.lock().await.take() else { return };
        run.task.abort();
        let _ = run.task.await;
        let sent = std::mem::take(&mut *run.sent.lock().unwrap());
        if let Some(wb) = run.wb.upgrade()
            && let Ok(session) = wb.session().await
        {
            let ids = session.conn.unanswered(&sent).await;
            if !ids.is_empty() {
                let ids = Sexp::list(std::iter::once(Sexp::sym("cl:list")).chain(ids.into_iter().map(|id| Sexp::Int(id as i64))));
                let _ = session.conn.rex(Sexp::list([Sexp::sym("zparen::abort-requests"), ids]), "COMMON-LISP-USER", Thread::T).await;
            }
        }
        close_tool_calls(&mut *self.history.lock().await);
    }

    /// Starts a turn in the background. Events stream through `emit`.
    pub async fn send(
        self: &Arc<Self>,
        wb: Arc<Workbench>,
        text: String,
        context: Option<EditorContext>,
        project: Option<String>,
        emit: Emit,
    ) -> Result<(), String> {
        let mut running = self.running.lock().await;
        if running.as_ref().is_some_and(|r| !r.task.is_finished()) {
            return Err("the assistant is still answering".into());
        }
        let me = self.clone();
        let sent = Arc::default();
        let weak = Arc::downgrade(&wb);
        let turn = new_session_id();
        let id = turn.clone();
        let task = tokio::spawn(SENT.scope(Arc::clone(&sent), async move {
            emit(AssistantEvent::TurnStarted);
            let stop_reason = match me.turn(&wb, &id, user_message(&text, context.as_ref()), &emit).await {
                Ok(reason) => reason,
                Err(message) => {
                    emit(AssistantEvent::Error { message });
                    "error".into()
                }
            };
            me.save(project).await;
            emit(AssistantEvent::TurnFinished { stop_reason });
        }));
        *running = Some(Running { turn, task, sent, wb: weak });
        Ok(())
    }

    async fn turn(&self, wb: &Arc<Workbench>, turn: &str, user: Value, emit: &Emit) -> Result<String, String> {
        let config = self.config();
        if let Some(agent) = config.provider.agent() {
            return self.agent_turn(wb, agent, config.provider, turn, user, emit).await;
        }
        if config.provider == Provider::Local {
            return self.local_turn(wb, &config, user, emit).await;
        }
        let (cred, _) = self.credential(config.provider).await.ok_or(if config.provider == Provider::Claude {
            "No Anthropic credentials. Add an API key in the assistant settings, set ANTHROPIC_API_KEY, or run `ant auth login`."
        } else {
            "No OpenAI API key. Add one in the assistant settings or set OPENAI_API_KEY."
        })?;
        // History only grows: we append the user's message and each response
        // whole, thinking blocks included, so cached prefixes stay valid.
        self.history.lock().await.push(user);
        for _ in 0..MAX_TOOL_ROUNDS {
            let messages = self.history.lock().await.clone();
            let reply = if config.provider == Provider::Claude {
                self.stream_message(&cred, &config.claude_model, &claude_messages(&messages), emit).await?
            } else {
                self.stream_openai(&cred, &config.openai_model, &messages, emit).await?
            };
            match reply.stop_reason.as_str() {
                // A declined turn may stop mid-output, so its partial content is dropped.
                "refusal" => return Err(format!("The model declined this request{}", reply.refusal_note())),
                _ => self.history.lock().await.push(json!({ "role": "assistant", "content": reply.content })),
            }
            let calls = reply.tool_uses();
            if calls.is_empty() {
                return Ok(reply.stop_reason);
            }
            let truncated = reply.stop_reason == "max_tokens";
            let results = futures::future::join_all(calls.into_iter().map(|call| run_tool(wb, call, truncated, emit))).await;
            self.history.lock().await.push(json!({ "role": "user", "content": results }));
            if truncated {
                return Err("The response hit the output limit in the middle of a tool call.".into());
            }
        }
        Err(format!("Stopped after {MAX_TOOL_ROUNDS} rounds of tool calls."))
    }

    /// A turn answered by Claude Code or Codex. The agent keeps its own
    /// conversation; what other providers said since it last answered is
    /// sent along with the user's message.
    async fn agent_turn(&self, wb: &Arc<Workbench>, agent: Agent, provider: Provider, turn: &str, user: Value, emit: &Emit) -> Result<String, String> {
        if let Some(problem) = agent.problem().await {
            return Err(problem);
        }
        let program = agent.program().ok_or_else(|| format!("{} is not installed.", agent.name()))?;
        let mcp_url = wb
            .mcp_url()
            .ok_or_else(|| format!("ZParen's MCP server is not running, and {} reaches your Lisp through it.", agent.name()))?;
        let token = crate::mcp::load_or_create_token(wb.data_dir()).map_err(|e| e.to_string())?;
        let thread = self.threads.lock().await.get(&provider).cloned();
        let mut prompt = String::new();
        {
            let mut history = self.history.lock().await;
            let earlier = agent::transcript(&history[thread.as_ref().map_or(0, |t| t.seen.min(history.len()))..]);
            if !earlier.is_empty() {
                prompt.push_str(&format!("Earlier in this conversation:\n\n{earlier}---\n\n"));
            }
            prompt.push_str(&user["content"].as_array().into_iter().flatten().filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n\n"));
            history.push(user);
        }
        let cwd = wb.status().await.project.map(|p| PathBuf::from(p.root)).unwrap_or_else(crate::project::home);
        let model = match provider {
            Provider::ClaudeCode => self.config().claude_code_model,
            _ => self.config().codex_model,
        };
        let model = model.trim();
        let run = agent::Run {
            program: &program,
            model: (!model.is_empty() && model != DEFAULT_MODEL).then_some(model),
            resume: thread.as_ref().map(|t| t.id.as_str()),
            system: SYSTEM,
            cwd: &cwd,
            mcp_url: &mcp_url,
            token: &token,
            turn,
            mcp_file: &self.data_dir.join("agent-mcp.json"),
        };
        let mut child = agent
            .command(&run)
            .map_err(|e| e.to_string())?
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", agent.name()))?;
        let mut stdin = child.stdin.take().expect("piped");
        tokio::io::AsyncWriteExt::write_all(&mut stdin, prompt.as_bytes()).await.map_err(|e| e.to_string())?;
        drop(stdin);
        let stderr = child.stderr.take().expect("piped");
        let errors = tokio::spawn(async move {
            let mut text = String::new();
            let _ = tokio::io::AsyncReadExt::read_to_string(&mut tokio::io::BufReader::new(stderr), &mut text).await;
            text
        });
        let mut lines = tokio::io::AsyncBufReadExt::lines(tokio::io::BufReader::new(child.stdout.take().expect("piped")));
        let mut stream = agent::Stream::new(turn);
        while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            let mut history = self.history.lock().await;
            match agent {
                Agent::ClaudeCode => stream.claude(&v, emit, &mut history),
                Agent::Codex => stream.codex(&v, emit, &mut history),
            }
        }
        let status = child.wait().await.map_err(|e| e.to_string())?;
        if let Some(id) = stream.session.take() {
            let seen = self.history.lock().await.len();
            self.threads.lock().await.insert(provider, AgentThread { id, seen });
        }
        if let Some(outcome) = stream.outcome {
            return outcome;
        }
        let errors = errors.await.unwrap_or_default();
        Err(match errors.lines().filter(|l| !l.trim().is_empty()).last() {
            Some(last) => format!("{} stopped: {last}", agent.name()),
            None => format!("{} stopped ({status}) before it finished the reply.", agent.name()),
        })
    }

    /// A turn answered by the local server: the same tool loop as the APIs, through its chat API.
    async fn local_turn(&self, wb: &Arc<Workbench>, config: &AssistantConfig, user: Value, emit: &Emit) -> Result<String, String> {
        let base = local_base(&config.local_url).ok_or("Add the local server's address in the assistant settings.")?;
        let key = self.credential(Provider::Local).await.map(|(Credential::ApiKey(k) | Credential::OAuth(k), _)| k);
        let model = match config.local_model.trim() {
            "" => self.local_models(&base).await?.into_iter().next().ok_or(format!("The server at {base} lists no models. Load or pull a model there first."))?,
            m => m.to_string(),
        };
        self.history.lock().await.push(user);
        let mut tools = true;
        for _ in 0..MAX_TOOL_ROUNDS {
            let messages = self.history.lock().await.clone();
            let reply = match self.stream_local(&base, key.as_deref(), &model, &messages, tools, emit).await {
                Err(LocalError::NoTools(_)) if tools => {
                    tools = false;
                    emit(AssistantEvent::Text { text: format!("_{model} cannot call tools, so it answers without running code in your Lisp._\n\n") });
                    self.stream_local(&base, key.as_deref(), &model, &messages, false, emit).await
                }
                other => other,
            }
            .map_err(LocalError::message)?;
            if reply.stop_reason == "refusal" {
                return Err(format!("The model declined this request{}", reply.refusal_note()));
            }
            self.history.lock().await.push(json!({ "role": "assistant", "content": reply.content }));
            let calls = reply.tool_uses();
            if calls.is_empty() {
                return Ok(reply.stop_reason);
            }
            let truncated = reply.stop_reason == "max_tokens";
            let results = futures::future::join_all(calls.into_iter().map(|call| run_tool(wb, call, truncated, emit))).await;
            self.history.lock().await.push(json!({ "role": "user", "content": results }));
            if truncated {
                return Err("The response hit the output limit in the middle of a tool call.".into());
            }
        }
        Err(format!("Stopped after {MAX_TOOL_ROUNDS} rounds of tool calls."))
    }

    /// One streamed chat completion from the local server.
    async fn stream_local(&self, base: &str, key: Option<&str>, model: &str, messages: &[Value], tools: bool, emit: &Emit) -> Result<Reply, LocalError> {
        let mut body = json!({ "model": model, "messages": chat_messages(messages), "stream": true });
        if tools {
            body["tools"] = tools::specs()
                .into_iter()
                .map(|t| json!({ "type": "function", "function": { "name": t.name, "description": t.description, "parameters": t.input_schema } }))
                .collect();
        }
        let mut req = local_client(&self.http, base).post(format!("{base}/chat/completions")).json(&body);
        if let Some(k) = key {
            req = req.bearer_auth(k);
        }
        let resp = req.send().await.map_err(|e| LocalError::Other(format!("could not reach {base}: {}", without_url(&e))))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let message = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v.pointer("/error/message").or_else(|| v.get("error")).and_then(Value::as_str).map(String::from))
                .unwrap_or(text);
            let message = format!("The local server answered {status}: {message}");
            // Ollama and llama.cpp refuse tools for a model that cannot call them.
            return Err(if tools && message.to_lowercase().contains("tool") { LocalError::NoTools(message) } else { LocalError::Other(message) });
        }
        let mut stream = resp.bytes_stream();
        let mut sse = SseBuffer::default();
        let mut chat = ChatReply::default();
        use futures::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| LocalError::Other(format!("stream interrupted: {e}")))?;
            for data in sse.push(&chunk) {
                if data.trim() == "[DONE]" {
                    return Ok(chat.finish());
                }
                let Ok(event) = serde_json::from_str::<Value>(&data) else { continue };
                chat.apply(&event, emit).map_err(LocalError::Other)?;
            }
        }
        Ok(chat.finish())
    }

    fn body(&self, model: &str, messages: &[Value]) -> Value {
        let tools: Vec<Value> = tools::specs()
            .into_iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                    "eager_input_streaming": true,
                })
            })
            .collect();
        json!({
            "model": model,
            "max_tokens": MAX_TOKENS,
            "stream": true,
            "system": [{ "type": "text", "text": SYSTEM, "cache_control": { "type": "ephemeral" } }],
            "tools": tools,
            "messages": messages,
            "thinking": { "type": "adaptive", "display": "summarized" },
            "output_config": { "effort": "high" },
            "fallbacks": "default",
            "cache_control": { "type": "ephemeral" },
        })
    }

    async fn stream_message(&self, cred: &Credential, model: &str, messages: &[Value], emit: &Emit) -> Result<Reply, String> {
        let mut betas = vec![FALLBACK_BETA];
        let mut req = self
            .http
            .post(format!("{}/v1/messages", self.base_url))
            .header("content-type", "application/json")
            .header("anthropic-version", API_VERSION);
        match cred {
            Credential::ApiKey(k) => req = req.header("x-api-key", k),
            Credential::OAuth(t) => {
                req = req.header("authorization", format!("Bearer {t}"));
                betas.push(OAUTH_BETA);
            }
        }
        let resp = req
            .header("anthropic-beta", betas.join(","))
            .json(&self.body(model, messages))
            .send()
            .await
            .map_err(|e| format!("could not reach the Anthropic API: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let message = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(String::from))
                .unwrap_or(body);
            return Err(format!("Anthropic API error {status}: {message}"));
        }
        let mut stream = resp.bytes_stream();
        let mut sse = SseBuffer::default();
        let mut reply = Reply::default();
        use futures::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("stream interrupted: {e}"))?;
            for data in sse.push(&chunk) {
                let Ok(event) = serde_json::from_str::<Value>(&data) else { continue };
                reply.apply(&event, emit)?;
            }
        }
        Ok(reply)
    }

    /// One OpenAI Responses call. Text streams to `emit`; the reply is read
    /// from the finished response, its output items kept whole for the next call.
    async fn stream_openai(&self, cred: &Credential, model: &str, messages: &[Value], emit: &Emit) -> Result<Reply, String> {
        let (Credential::ApiKey(key) | Credential::OAuth(key)) = cred;
        let tools: Vec<Value> = tools::specs()
            .into_iter()
            .map(|t| json!({ "type": "function", "name": t.name, "description": t.description, "parameters": t.input_schema, "strict": false }))
            .collect();
        let body = json!({
            "model": model,
            "instructions": SYSTEM,
            "input": openai_input(messages),
            "tools": tools,
            "stream": true,
            "store": false,
            "include": ["reasoning.encrypted_content"],
            "reasoning": { "effort": "high" },
            "max_output_tokens": MAX_TOKENS,
        });
        let resp = self
            .http
            .post(format!("{}/responses", self.openai_url))
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("could not reach the OpenAI API: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let message = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(String::from))
                .unwrap_or(body);
            return Err(format!("OpenAI API error {status}: {message}"));
        }
        let mut stream = resp.bytes_stream();
        let mut sse = SseBuffer::default();
        use futures::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("stream interrupted: {e}"))?;
            for data in sse.push(&chunk) {
                let Ok(event) = serde_json::from_str::<Value>(&data) else { continue };
                match event["type"].as_str().unwrap_or_default() {
                    "response.output_text.delta" => emit(AssistantEvent::Text { text: event["delta"].as_str().unwrap_or_default().into() }),
                    "response.completed" | "response.incomplete" => return Ok(openai_reply(&event["response"])),
                    "response.failed" => return Err(event["response"]["error"]["message"].as_str().unwrap_or("the response failed").into()),
                    "error" => return Err(event["message"].as_str().unwrap_or("stream error").into()),
                    _ => {}
                }
            }
        }
        Err("The OpenAI stream ended before the response finished.".into())
    }
}

/// Blocks in the history holding an OpenAI response's output items, replayed
/// to OpenAI as they came and left out for Claude.
const OPENAI_OUTPUT: &str = "openai_output";

/// The history as Claude takes it: without OpenAI's own items.
fn claude_messages(messages: &[Value]) -> Vec<Value> {
    messages
        .iter()
        .filter_map(|m| {
            let mut m = m.clone();
            if let Some(content) = m["content"].as_array_mut() {
                content.retain(|b| b["type"] != OPENAI_OUTPUT);
                if content.is_empty() {
                    return None;
                }
            }
            Some(m)
        })
        .collect()
}

/// The history as OpenAI Responses input items. Claude's thinking is left out.
fn openai_input(messages: &[Value]) -> Vec<Value> {
    let mut items = Vec::new();
    for m in messages {
        let content = m["content"].as_array().cloned().unwrap_or_default();
        if m["role"] == "user" {
            let mut texts = Vec::new();
            for b in &content {
                match b["type"].as_str() {
                    Some("tool_result") => {
                        let output = match &b["content"] {
                            Value::String(s) => s.clone(),
                            Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect(),
                            _ => String::new(),
                        };
                        items.push(json!({ "type": "function_call_output", "call_id": b["tool_use_id"], "output": output }));
                    }
                    Some("text") => texts.push(json!({ "type": "input_text", "text": b["text"] })),
                    _ => {}
                }
            }
            if !texts.is_empty() {
                items.push(json!({ "role": "user", "content": texts }));
            }
        } else if let Some(own) = content.iter().find(|b| b["type"] == OPENAI_OUTPUT) {
            items.extend(own["items"].as_array().cloned().unwrap_or_default());
        } else {
            for b in &content {
                match b["type"].as_str() {
                    Some("text") => items.push(json!({ "role": "assistant", "content": [{ "type": "output_text", "text": b["text"] }] })),
                    Some("tool_use") => items.push(json!({ "type": "function_call", "call_id": b["id"], "name": b["name"], "arguments": b["input"].to_string() })),
                    _ => {}
                }
            }
        }
    }
    items
}

/// A finished Responses object as a reply in the history's own blocks.
fn openai_reply(response: &Value) -> Reply {
    let output = response["output"].as_array().cloned().unwrap_or_default();
    let mut reply = Reply::default();
    let mut refusal = None;
    for item in &output {
        match item["type"].as_str() {
            Some("message") => {
                for part in item["content"].as_array().into_iter().flatten() {
                    match part["type"].as_str() {
                        Some("output_text") if part["text"].as_str().is_some_and(|t| !t.is_empty()) => {
                            reply.content.push(json!({ "type": "text", "text": part["text"] }));
                            reply.partial_json.push(String::new());
                        }
                        Some("refusal") => refusal = Some(part["refusal"].clone()),
                        _ => {}
                    }
                }
            }
            Some("function_call") => {
                let raw = item["arguments"].as_str().unwrap_or_default().to_string();
                let input = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({}));
                reply.content.push(json!({ "type": "tool_use", "id": item["call_id"], "name": item["name"], "input": input }));
                reply.partial_json.push(raw);
            }
            _ => {}
        }
    }
    reply.content.push(json!({ "type": OPENAI_OUTPUT, "items": output }));
    reply.partial_json.push(String::new());
    let incomplete = response["incomplete_details"]["reason"].as_str();
    reply.stop_reason = if refusal.is_some() || incomplete == Some("content_filter") {
        reply.stop_details = refusal.map(|r| json!({ "explanation": r }));
        "refusal"
    } else if incomplete == Some("max_output_tokens") {
        "max_tokens"
    } else if reply.content.iter().any(|b| b["type"] == "tool_use") {
        "tool_use"
    } else {
        "end_turn"
    }
    .into();
    reply
}

/// The base URL of the local server's OpenAI-compatible API, from what the
/// user typed: `localhost:11434`, `http://host:1234` or a full `.../v1` URL.
/// A bare host and port is reached over http, and an address without a path
/// gets `/v1`. A pasted `/chat/completions` or `/models` is dropped.
fn local_base(url: &str) -> Option<String> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }
    let url = if url.contains("://") { url.to_string() } else { format!("http://{url}") };
    let url = url.trim_end_matches('/');
    let parsed = reqwest::Url::parse(url).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none_or(str::is_empty) {
        return None;
    }
    let mut base = url.trim_end_matches('/').to_string();
    for tail in ["/chat/completions", "/models"] {
        if let Some(rest) = base.strip_suffix(tail) {
            base = rest.to_string();
        }
    }
    if parsed.path().trim_matches('/').is_empty() {
        base.push_str("/v1");
    }
    Some(base)
}

/// A server on this computer is reached directly, never through a proxy the system sets.
fn local_client(http: &reqwest::Client, base: &str) -> reqwest::Client {
    let host = reqwest::Url::parse(base).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
    let loopback = host == "localhost" || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback()) || host == "[::1]";
    if loopback {
        reqwest::Client::builder().no_proxy().build().unwrap_or_else(|_| http.clone())
    } else {
        http.clone()
    }
}

/// Why a request failed, without the URL, which the message already names.
fn without_url(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return "the server did not answer in time".into();
    }
    let mut cause: &dyn std::error::Error = e;
    while let Some(next) = cause.source() {
        cause = next;
    }
    cause.to_string()
}

enum LocalError {
    /// The server will not take tools for this model.
    NoTools(String),
    Other(String),
}

impl LocalError {
    fn message(self) -> String {
        match self {
            LocalError::NoTools(m) | LocalError::Other(m) => m,
        }
    }
}

/// The history as chat completion messages, with the system prompt first.
/// Thinking and OpenAI's own items are left out; tool calls and their results
/// keep their ids, so any provider's turns read the same.
fn chat_messages(messages: &[Value]) -> Vec<Value> {
    let mut out = vec![json!({ "role": "system", "content": SYSTEM })];
    for m in messages {
        let content = m["content"].as_array().cloned().unwrap_or_default();
        let texts: Vec<&str> = content.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect();
        if m["role"] == "user" {
            for b in content.iter().filter(|b| b["type"] == "tool_result") {
                let output = match &b["content"] {
                    Value::String(s) => s.clone(),
                    Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect(),
                    _ => String::new(),
                };
                out.push(json!({ "role": "tool", "tool_call_id": b["tool_use_id"], "content": output }));
            }
            if !texts.is_empty() {
                out.push(json!({ "role": "user", "content": texts.join("\n\n") }));
            }
        } else {
            let calls: Vec<Value> = content
                .iter()
                .filter(|b| b["type"] == "tool_use")
                .map(|b| json!({ "id": b["id"], "type": "function", "function": { "name": b["name"], "arguments": b["input"].to_string() } }))
                .collect();
            if texts.is_empty() && calls.is_empty() {
                continue;
            }
            let mut message = json!({ "role": "assistant", "content": texts.join("") });
            if !calls.is_empty() {
                message["tool_calls"] = Value::Array(calls);
            }
            out.push(message);
        }
    }
    out
}

/// A streamed chat completion, folded chunk by chunk.
#[derive(Default)]
struct ChatReply {
    text: String,
    /// Tool calls by their index in the stream: id, name and the arguments so far.
    calls: BTreeMap<u64, (String, String, String)>,
    finish: Option<String>,
}

impl ChatReply {
    fn apply(&mut self, event: &Value, emit: &Emit) -> Result<(), String> {
        if let Some(e) = event.get("error") {
            return Err(e["message"].as_str().or(e.as_str()).unwrap_or("stream error").to_string());
        }
        let Some(choice) = event["choices"].get(0) else { return Ok(()) };
        let delta = &choice["delta"];
        // Ollama and LM Studio send a reasoning model's thinking apart from its answer.
        for field in ["reasoning_content", "reasoning"] {
            if let Some(t) = delta[field].as_str().filter(|t| !t.is_empty()) {
                emit(AssistantEvent::Thinking { text: t.into() });
            }
        }
        if let Some(t) = delta["content"].as_str().filter(|t| !t.is_empty()) {
            self.text.push_str(t);
            emit(AssistantEvent::Text { text: t.into() });
        }
        for (n, call) in delta["tool_calls"].as_array().into_iter().flatten().enumerate() {
            let index = call["index"].as_u64().unwrap_or(n as u64);
            let entry = self.calls.entry(index).or_default();
            if let Some(id) = call["id"].as_str().filter(|i| !i.is_empty()) {
                entry.0 = id.into();
            }
            if let Some(name) = call["function"]["name"].as_str() {
                entry.1.push_str(name);
            }
            match &call["function"]["arguments"] {
                Value::String(a) => entry.2.push_str(a),
                // Some servers send the arguments as an object, not as JSON text.
                v @ Value::Object(_) => entry.2 = v.to_string(),
                _ => {}
            }
        }
        if let Some(f) = choice["finish_reason"].as_str() {
            self.finish = Some(f.into());
        }
        Ok(())
    }

    /// The reply in the history's own blocks. A call without an id gets one,
    /// and ids keep only the characters every provider accepts.
    fn finish(self) -> Reply {
        let mut reply = Reply::default();
        if !self.text.is_empty() {
            reply.content.push(json!({ "type": "text", "text": self.text }));
            reply.partial_json.push(String::new());
        }
        let stamp = new_session_id();
        for (i, (id, name, raw)) in self.calls.into_values().enumerate() {
            let id: String = id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
            let id = if id.is_empty() { format!("call_{stamp}_{i}") } else { id };
            let input = serde_json::from_str::<Value>(&raw).ok().filter(Value::is_object).unwrap_or_else(|| json!({}));
            reply.content.push(json!({ "type": "tool_use", "id": id, "name": name, "input": input }));
            reply.partial_json.push(raw);
        }
        reply.stop_reason = match self.finish.as_deref() {
            Some("length") => "max_tokens",
            Some("content_filter") => "refusal",
            // Some servers finish with "stop" even after a tool call.
            _ if reply.content.iter().any(|b| b["type"] == "tool_use") => "tool_use",
            _ => "end_turn",
        }
        .into();
        reply
    }
}

fn user_message(text: &str, context: Option<&EditorContext>) -> Value {
    let mut content = Vec::new();
    if let Some(c) = context {
        let mut note = String::from("Editor context:");
        if let Some(f) = &c.file {
            note.push_str(&format!("\nFile: {f}"));
        }
        if let Some(p) = &c.package {
            note.push_str(&format!("\nPackage: {p}"));
        }
        if let Some(form) = &c.form {
            let label = c.form_label.as_deref().unwrap_or("Form at the cursor");
            note.push_str(&format!("\n{label}:\n```lisp\n{form}\n```"));
        }
        content.push(json!({ "type": "text", "text": note }));
    }
    content.push(json!({ "type": "text", "text": text }));
    json!({ "role": "user", "content": content })
}

/// A turn stopped while its tools ran leaves their calls without results,
/// which the next request may not; each gets one saying it was stopped.
fn close_tool_calls(history: &mut Vec<Value>) {
    let Some(last) = history.last().filter(|m| m["role"] == "assistant") else { return };
    let results: Vec<Value> = last["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|b| b["type"] == "tool_use")
        .map(|b| json!({ "type": "tool_result", "tool_use_id": b["id"], "content": "Stopped by the user before it finished.", "is_error": true }))
        .collect();
    if !results.is_empty() {
        history.push(json!({ "role": "user", "content": results }));
    }
}

async fn run_tool(wb: &Arc<Workbench>, call: ToolCall, truncated: bool, emit: &Emit) -> Value {
    emit(AssistantEvent::ToolStarted { id: call.id.clone(), name: call.name.clone(), input: call.raw.clone() });
    let result = if truncated {
        Err("The tool input was cut off by the output limit, so the tool did not run.".to_string())
    } else {
        match &call.input {
            Ok(args) => tools::call(wb, &call.name, args.clone()).await,
            Err(_) => Err(json!({ "INVALID_JSON": call.raw }).to_string()),
        }
    };
    let (ok, output) = match result {
        Ok(o) => (true, o),
        Err(e) => (false, e),
    };
    emit(AssistantEvent::ToolFinished { id: call.id.clone(), ok, output: output.clone() });
    json!({ "type": "tool_result", "tool_use_id": call.id, "content": output, "is_error": !ok })
}

struct ToolCall {
    id: String,
    name: String,
    raw: String,
    input: Result<Value, String>,
}

#[derive(Default)]
struct Reply {
    content: Vec<Value>,
    partial_json: Vec<String>,
    stop_reason: String,
    stop_details: Option<Value>,
}

impl Reply {
    /// Folds one SSE event in. An `error` event fails the stream; an event
    /// with an unknown shape is skipped, as the API may add new ones.
    fn apply(&mut self, event: &Value, emit: &Emit) -> Result<(), String> {
        if event["type"] == "error" {
            return Err(event["error"]["message"].as_str().unwrap_or("stream error").to_string());
        }
        self.fold(event, emit);
        Ok(())
    }

    fn fold(&mut self, event: &Value, emit: &Emit) -> Option<()> {
        match event["type"].as_str()? {
            "content_block_start" => {
                let i = event["index"].as_u64()? as usize;
                while self.content.len() <= i {
                    self.content.push(Value::Null);
                    self.partial_json.push(String::new());
                }
                self.content[i] = event["content_block"].clone();
            }
            "content_block_delta" => {
                let i = event["index"].as_u64()? as usize;
                let delta = &event["delta"];
                let block = self.content.get_mut(i)?;
                match delta["type"].as_str()? {
                    "text_delta" => {
                        let t = delta["text"].as_str().unwrap_or_default();
                        append(block, "text", t);
                        emit(AssistantEvent::Text { text: t.into() });
                    }
                    "thinking_delta" => {
                        let t = delta["thinking"].as_str().unwrap_or_default();
                        append(block, "thinking", t);
                        emit(AssistantEvent::Thinking { text: t.into() });
                    }
                    "signature_delta" => append(block, "signature", delta["signature"].as_str().unwrap_or_default()),
                    "input_json_delta" => self.partial_json[i].push_str(delta["partial_json"].as_str().unwrap_or_default()),
                    "citations_delta" => {
                        if let Some(list) = block.get_mut("citations").and_then(Value::as_array_mut) {
                            list.push(delta["citation"].clone());
                        } else {
                            block["citations"] = json!([delta["citation"].clone()]);
                        }
                    }
                    _ => {}
                }
            }
            "content_block_stop" => {
                let i = event["index"].as_u64()? as usize;
                let block = self.content.get_mut(i)?;
                if block["type"] == "tool_use" {
                    let raw = &self.partial_json[i];
                    block["input"] = if raw.trim().is_empty() {
                        json!({})
                    } else {
                        serde_json::from_str(raw).unwrap_or_else(|_| json!({}))
                    };
                }
            }
            "message_delta" => {
                if let Some(r) = event["delta"]["stop_reason"].as_str() {
                    self.stop_reason = r.into();
                }
                if !event["delta"]["stop_details"].is_null() {
                    self.stop_details = Some(event["delta"]["stop_details"].clone());
                }
            }
            _ => {}
        }
        Some(())
    }

    fn tool_uses(&self) -> Vec<ToolCall> {
        self.content
            .iter()
            .zip(&self.partial_json)
            .filter(|(b, _)| b["type"] == "tool_use")
            .map(|(b, raw)| {
                let raw = if raw.trim().is_empty() { "{}".to_string() } else { raw.clone() };
                ToolCall {
                    id: b["id"].as_str().unwrap_or_default().into(),
                    name: b["name"].as_str().unwrap_or_default().into(),
                    input: serde_json::from_str::<Value>(&raw).map_err(|e| e.to_string()).and_then(|v| {
                        if v.is_object() { Ok(v) } else { Err("tool input is not an object".into()) }
                    }),
                    raw,
                }
            })
            .collect()
    }

    fn refusal_note(&self) -> String {
        match self.stop_details.as_ref().and_then(|d| d["explanation"].as_str()) {
            Some(e) => format!(": {e}"),
            None => ".".into(),
        }
    }
}

fn append(block: &mut Value, field: &str, text: &str) {
    let current = block[field].as_str().unwrap_or_default().to_string();
    block[field] = Value::String(current + text);
}

#[derive(Default)]
struct SseBuffer {
    pending: String,
}

impl SseBuffer {
    fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.pending.push_str(&String::from_utf8_lossy(bytes).replace("\r\n", "\n"));
        let mut out = Vec::new();
        while let Some(end) = self.pending.find("\n\n") {
            let frame: String = self.pending.drain(..end + 2).collect();
            let data: Vec<&str> = frame.lines().filter_map(|l| l.strip_prefix("data:")).map(str::trim_start).collect();
            if !data.is_empty() {
                out.push(data.join("\n"));
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_code_sent_with_a_message() {
        let note = |label: Option<&str>| {
            let c = EditorContext { file: None, package: Some("CL-USER".into()), form: Some("42".into()), form_label: label.map(Into::into) };
            user_message("Explain", Some(&c))["content"][0]["text"].as_str().unwrap().to_string()
        };
        assert_eq!(note(None), "Editor context:\nPackage: CL-USER\nForm at the cursor:\n```lisp\n42\n```");
        assert!(note(Some("A REPL result")).contains("\nA REPL result:\n```lisp\n42"));
        let old: EditorContext = serde_json::from_str(r#"{"file":null,"package":null,"form":"x"}"#).unwrap();
        assert_eq!(old.form_label, None, "a context without the label still reads");
    }

    #[test]
    fn sse_frames_split_across_chunks() {
        let mut b = SseBuffer::default();
        assert!(b.push(b"event: a\ndata: {\"x\"").is_empty());
        assert_eq!(b.push(b":1}\n\nevent: b\ndata: 2\n\n"), vec!["{\"x\":1}".to_string(), "2".to_string()]);
    }

    #[test]
    fn accumulates_blocks_like_an_unstreamed_reply() {
        let emit: Emit = Arc::new(|_| {});
        let mut r = Reply::default();
        for e in [
            json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}),
            json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"eval","input":{}}}),
            json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"form\":"}}),
            json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"(+ 1 2)\"}"}}),
            json!({"type":"content_block_stop","index":1}),
            json!({"type":"message_delta","delta":{"stop_reason":"tool_use"}}),
        ] {
            assert!(r.apply(&e, &emit).is_ok());
        }
        assert_eq!(r.content[0], json!({"type":"thinking","thinking":"hmm","signature":"sig"}));
        assert_eq!(r.content[1]["input"], json!({"form":"(+ 1 2)"}));
        let calls = r.tool_uses();
        assert_eq!(calls[0].input, Ok(json!({"form":"(+ 1 2)"})));
    }

    #[test]
    fn reads_the_local_server_address_as_typed() {
        let base = |u: &str| local_base(u);
        assert_eq!(base("localhost:11434").as_deref(), Some("http://localhost:11434/v1"));
        assert_eq!(base(" http://127.0.0.1:1234/ ").as_deref(), Some("http://127.0.0.1:1234/v1"));
        assert_eq!(base("http://gpu-box:8000/v1").as_deref(), Some("http://gpu-box:8000/v1"));
        assert_eq!(base("http://localhost:8080/v1/chat/completions").as_deref(), Some("http://localhost:8080/v1"));
        assert_eq!(base("https://llm.example.com/openai/v1/models").as_deref(), Some("https://llm.example.com/openai/v1"));
        assert_eq!(base("[::1]:11434").as_deref(), Some("http://[::1]:11434/v1"));
        assert_eq!(base(""), None);
        assert_eq!(base("ftp://host:21"), None);
        assert_eq!(base("http://"), None);
    }

    #[test]
    fn the_history_becomes_chat_messages_with_tool_calls_and_results() {
        let history = vec![
            user_message("What is (+ 1 2)?", None),
            json!({"role":"assistant","content":[
                {"type":"thinking","thinking":"hmm","signature":"s"},
                {"type":"text","text":"Let me check."},
                {"type":"tool_use","id":"toolu_1","name":"eval","input":{"form":"(+ 1 2)"}},
                {"type":OPENAI_OUTPUT,"items":[]},
            ]}),
            json!({"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"3","is_error":false}]}),
            json!({"role":"assistant","content":[{"type":"text","text":"It is 3."}]}),
        ];
        let m = chat_messages(&history);
        assert_eq!(m[0]["role"], "system");
        assert_eq!(m[1], json!({"role":"user","content":"What is (+ 1 2)?"}));
        assert_eq!(
            m[2],
            json!({"role":"assistant","content":"Let me check.","tool_calls":[{"id":"toolu_1","type":"function","function":{"name":"eval","arguments":"{\"form\":\"(+ 1 2)\"}"}}]})
        );
        assert_eq!(m[3], json!({"role":"tool","tool_call_id":"toolu_1","content":"3"}));
        assert_eq!(m[4], json!({"role":"assistant","content":"It is 3."}));
        assert_eq!(m.len(), 5);
    }

    #[test]
    fn folds_a_streamed_chat_completion() {
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let log = seen.clone();
        let emit: Emit = Arc::new(move |e| log.lock().unwrap().push(e));
        let mut c = ChatReply::default();
        for e in [
            json!({"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"think"}}]}),
            json!({"choices":[{"index":0,"delta":{"content":"Checking. "}}]}),
            json!({"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call:1","type":"function","function":{"name":"eval","arguments":"{\"form\":"}}]}}]}),
            json!({"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"(+ 1 2)\"}"}}]}}]}),
            // Ollama sends a whole call at once, sometimes without an id.
            json!({"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"function":{"name":"describe_symbol","arguments":{"symbol":"car"}}}]}}]}),
            json!({"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}),
        ] {
            c.apply(&e, &emit).unwrap();
        }
        let r = c.finish();
        assert_eq!(r.content[0], json!({"type":"text","text":"Checking. "}));
        assert_eq!(r.content[1], json!({"type":"tool_use","id":"call_1","name":"eval","input":{"form":"(+ 1 2)"}}));
        assert_eq!(r.content[2]["input"], json!({"symbol":"car"}));
        assert!(r.content[2]["id"].as_str().unwrap().starts_with("call_"), "a call without an id gets one");
        assert_eq!(r.stop_reason, "tool_use", "a finish of stop after tool calls still runs them");
        assert_eq!(r.tool_uses()[0].input, Ok(json!({"form":"(+ 1 2)"})));
        {
            let events = seen.lock().unwrap();
            assert_eq!(events[0], AssistantEvent::Thinking { text: "think".into() });
            assert_eq!(events[1], AssistantEvent::Text { text: "Checking. ".into() });
        }

        let mut cut = ChatReply::default();
        cut.apply(&json!({"choices":[{"index":0,"delta":{"content":"Long"},"finish_reason":"length"}]}), &emit).unwrap();
        assert_eq!(cut.finish().stop_reason, "max_tokens");
        assert!(ChatReply::default().apply(&json!({"error":{"message":"model not found"}}), &emit).is_err());
    }

    #[test]
    fn invalid_tool_json_is_reported_not_run() {
        let emit: Emit = Arc::new(|_| {});
        let mut r = Reply::default();
        r.apply(&json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"eval","input":{}}}), &emit).unwrap();
        r.apply(&json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"form\": \"(a"}}), &emit).unwrap();
        assert!(r.tool_uses()[0].input.is_err());
    }
}
