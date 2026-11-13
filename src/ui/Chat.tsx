import { Marked, type Token, type Tokens } from "marked";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openExternal } from "../platform";
import * as actions from "../actions";
import { modelName } from "./modelName";
import { ALL_PROVIDERS, FAMILY_NAMES, familyOf, isAgent, METHOD_HINTS, MODEL_KEY, providerLabel } from "./providers";
import { toolInput } from "./toolInput";
import { connectLocal, localName } from "./localModel";
import { highlightLispHtml, looksLikeLisp } from "../editor/lispSyntax";
import { editorContext, insertAtCursor } from "../editor/commands";
import type { AssistantStatus } from "../protocol/AssistantStatus";
import type { Provider } from "../protocol/Provider";
import { set, useStore, type ChatItem } from "../store";
import { Icon } from "./Icon";
import { backToLesson, useLearn } from "../learn/learn";
import type { SessionInfo } from "../protocol/SessionInfo";

/** `code` and **bold** in a line of the setup notes. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i}>{p.slice(1, -1)}</code>
        ) : p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [done, setDone] = useState("");
  const lisp = /^(lisp|common-lisp|cl|)$/i.test(lang);
  // A block without a language is colored only when it reads as Lisp.
  const colored = /^(lisp|common-lisp|commonlisp|cl|coalton)$/i.test(lang) || (!lang && looksLikeLisp(code));
  const html = useMemo(() => (colored ? highlightLispHtml(code) : null), [colored, code]);
  const flash = (msg: string) => {
    setDone(msg);
    setTimeout(() => setDone(""), 1500);
  };
  return (
    <div className="chat-code">
      <div className="chat-code-bar">
        <span>{lang || "code"}</span>
        <span className="grow" />
        {done && <span className="chat-done">{done}</span>}
        <button className="btn" onClick={() => navigator.clipboard.writeText(code).then(() => flash("Copied"))}>
          Copy
        </button>
        {lisp && (
          <>
            <button className="btn" onClick={() => flash(insertAtCursor(code) ? "Inserted" : "Open a file first")}>
              Insert
            </button>
            <button className="btn" onClick={() => actions.replEval(code)}>
              <Icon name="play" size={10} /> Eval
            </button>
          </>
        )}
      </div>
      {html === null ? <pre>{code}</pre> : <pre dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// An answer's HTML shows as text and never runs, and its images show as their
// description, so an answer cannot load anything from the web.
const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escape(text),
    image: ({ href, text }) => `<span class="md-image">${escape(text || href)}</span>`,
    code: ({ text, lang }) =>
      LISP_FENCE.test(lang ?? "") || (!lang && looksLikeLisp(text)) ? `<pre><code class="language-lisp">${highlightLispHtml(text)}</code></pre>` : false,
  },
});

const LISP_FENCE = /^(lisp|common-lisp|commonlisp|cl|coalton)$/i;

/** An answer's parts in order: Markdown as HTML, and each top-level code block with its own buttons. */
export function answerParts(text: string): ({ html: string } | { lang: string; code: string })[] {
  const parts: ({ html: string } | { lang: string; code: string })[] = [];
  let prose: Token[] = [];
  const flush = () => {
    if (prose.length) parts.push({ html: markdown.parser(prose) });
    prose = [];
  };
  for (const token of markdown.lexer(text)) {
    if (token.type === "code") {
      flush();
      parts.push({ lang: (token as Tokens.Code).lang ?? "", code: (token as Tokens.Code).text });
    } else prose.push(token);
  }
  flush();
  return parts;
}

/** A link in an answer opens in the browser, never in the app's own page. */
function openLink(e: React.MouseEvent) {
  const link = e.target instanceof Element ? e.target.closest("a") : null;
  if (!link) return;
  e.preventDefault();
  const href = link.getAttribute("href") ?? "";
  if (/^(https?:|mailto:)/i.test(href)) void openExternal(href);
}

function Markdown({ text }: { text: string }) {
  const parts = useMemo(() => answerParts(text), [text]);
  return (
    <>
      {parts.map((part, i) =>
        "html" in part ? (
          <div key={i} className="chat-md" onClick={openLink} dangerouslySetInnerHTML={{ __html: part.html }} />
        ) : (
          <CodeBlock key={i} lang={part.lang} code={part.code} />
        ),
      )}
    </>
  );
}

function ToolChip({ item }: { item: Extract<ChatItem, { role: "tool" }> }) {
  const [open, setOpen] = useState(false);
  let summary = item.input;
  try {
    const args = JSON.parse(item.input);
    summary = Object.values(args).map(String).join(" ").slice(0, 90);
  } catch {
  }
  return (
    <div className={`chat-tool ${item.ok === false ? "failed" : ""}`}>
      <div className="chat-tool-head" onClick={() => setOpen(!open)}>
        <span className={`dot ${item.ok === null ? "starting" : item.ok ? "ready" : "failed"}`} />
        <span className="chat-tool-name">{item.name.replace(/_/g, " ")}</span>
        <span className="chat-tool-args">{summary}</span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="chat-tool-body">
          <div className="label">Input</div>
          <pre>{toolInput(item.input)}</pre>
          {item.output !== null && (
            <>
              <div className="label">Result</div>
              <pre>{item.output}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Message({ item }: { item: ChatItem }) {
  switch (item.role) {
    case "user":
      return <div className="chat-user">{item.text}</div>;
    case "assistant":
      return (
        <div className="chat-assistant">
          {item.thinking && (
            <details className="chat-thinking">
              <summary>Thought process</summary>
              <div>{item.thinking}</div>
            </details>
          )}
          <Markdown text={item.text} />
        </div>
      );
    case "tool":
      return <ToolChip item={item} />;
    case "error":
      return <div className="chat-error">{item.text}</div>;
  }
}

/** The active provider's model, chosen among every provider's models. */
function ModelMenu({ status, onChange }: { status: AssistantStatus; onChange: (s: AssistantStatus) => void }) {
  const { config } = status;
  const models = (p: Provider) => {
    const chosen = config[MODEL_KEY[p]];
    return (status[p].models.includes(chosen) ? status[p].models : [chosen, ...status[p].models]).filter(Boolean);
  };
  return (
    <select
      className="select chat-model"
      aria-label="Model"
      value={`${config.provider}:${config[MODEL_KEY[config.provider]]}`}
      onChange={(e) => {
        const [provider, model] = e.target.value.split(/:(.*)/) as [Provider, string];
        const next = { ...config, provider, [MODEL_KEY[provider]]: model };
        actions.request({ type: "assistantConfigure", config: next }).then((r) => r.type === "assistant" && onChange(r));
      }}
    >
      {/* A local model shows once a server is set. */}
      {ALL_PROVIDERS.filter((p) => models(p).length > 0).map((p) => (
        <optgroup key={p} label={providerLabel(p)}>
          {models(p).map((m) => (
            <option key={m} value={`${p}:${m}`} title={m}>
              {modelName(m)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Where the local server is, when it does not answer yet. */
function LocalSetup({ status, onSaved }: { status: AssistantStatus; onSaved: () => void }) {
  const [url, setUrl] = useState(status.config.localUrl);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await connectLocal(status.config, url);
        onSaved();
      }}
    >
      <h3>Connect a local model</h3>
      <p>
        <Inline text={status.local.note ?? ""} />
      </p>
      <p>
        ZParen talks to the server through its OpenAI-compatible API, with the same tools in your Lisp as the other assistants. Ollama
        listens on <code>localhost:11434</code>, LM Studio on <code>localhost:1234</code>.
      </p>
      <input aria-label="Server address" placeholder="localhost:11434" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} />
      <button className="btn primary" disabled={!url.trim()}>
        Connect
      </button>
    </form>
  );
}

function Setup({ status, onSaved }: { status: AssistantStatus | null; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const provider = status?.config.provider ?? "claude";
  const name = FAMILY_NAMES[familyOf(provider)];
  if (status && provider === "local") return <div className="chat-setup">{!status.local.configured && <LocalSetup status={status} onSaved={onSaved} />}</div>;
  return (
    <div className="chat-setup">
      {status && !status[provider].configured && isAgent(provider) && (
        <div>
          <h3>Connect {name} with your login</h3>
          <p>
            <Inline text={status[provider].note ?? ""} />
          </p>
          <p>{METHOD_HINTS[provider]} It gets the same tools in your Lisp as with an API key.</p>
          <button className="btn primary" onClick={onSaved}>
            Check Again
          </button>
        </div>
      )}
      {status && !status[provider].configured && !isAgent(provider) && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await actions.request({ type: "assistantSetKey", provider, key });
            setKey("");
            onSaved();
          }}
        >
          <h3>Connect {name} with an API key</h3>
          {provider === "claude" ? (
            <p>
              Paste an Anthropic API key. ZParen also uses <code>ANTHROPIC_API_KEY</code> or an <code>ant auth login</code> profile
              when present. The key is stored only on this Mac.
            </p>
          ) : (
            <p>
              Codex with an API key calls the OpenAI API. Paste an OpenAI API key. ZParen also uses <code>OPENAI_API_KEY</code> when present. The key is stored only on this Mac.
            </p>
          )}
          <input type="password" placeholder={provider === "claude" ? "sk-ant-…" : "sk-…"} value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn primary" disabled={!key.trim()}>
            Save key
          </button>
        </form>
      )}
    </div>
  );
}

let restored = false;

/** Opening the assistant the first time reopens the project's latest conversation, if the chat is empty. */
async function restoreLatest() {
  if (restored) return;
  restored = true;
  if (useStore.getState().chat.length || useStore.getState().chatBusy) return;
  const root = useStore.getState().status.project?.root ?? null;
  const latest = (await actions.assistantSessions()).find((s) => s.project === root);
  if (latest && useStore.getState().chat.length === 0) await actions.openAssistantSession(latest.id);
}

function ago(seconds: number) {
  const d = Date.now() / 1000 - seconds;
  if (d < 90) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(seconds * 1000).toLocaleDateString();
}

/** Saved conversations, the latest first, to continue or delete. */
function SessionList({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const root = useStore((s) => s.status.project?.root ?? null);
  const load = () => actions.assistantSessions().then(setSessions);
  useEffect(() => void load(), []);
  return (
    <div className="session-list" role="menu" aria-label="Earlier conversations">
      {sessions === null ? (
        <div className="session-note">Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="session-note">No earlier conversations yet.</div>
      ) : (
        sessions.map((s) => (
          <div key={s.id} className="session">
            <button role="menuitem" className="session-open" title={s.title} onClick={() => void actions.openAssistantSession(s.id).then(onClose)}>
              <span className="session-title">{s.title}</span>
              <span className="session-meta">
                {s.project && s.project !== root ? `${s.project.split("/").pop()} · ` : ""}
                {ago(s.updated)}
              </span>
            </button>
            <button className="icon-btn" title="Delete this conversation" onClick={() => void actions.deleteAssistantSession(s.id).then(load)}>
              <Icon name="x" size={10} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export function Chat() {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.chatBusy);
  const askedFrom = useLearn((s) => s.askedFrom);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [text, setText] = useState("");
  const [withContext, setWithContext] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const about = useStore((s) => s.chatAbout);

  const settingsOpen = useStore((s) => s.settingsOpen);
  const refresh = () => actions.request({ type: "assistantStatus" }).then((r) => r.type === "assistant" && setStatus(r));
  useEffect(() => void restoreLatest(), []);
  // Settings may have changed the model or a key.
  useEffect(() => {
    if (!settingsOpen) void refresh();
  }, [settingsOpen]);
  // A hidden panel cannot scroll, so the newest message shows when the tab does.
  const shown = useStore((s) => s.right === "assistant");
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [chat, shown]);
  // Code chosen to ask about waits for the question, so the cursor goes to it.
  useEffect(() => {
    if (about && shown) input.current?.focus();
  }, [about, shown]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    set({ chatAbout: null });
    await actions.askAssistant(t, about ? about.context : withContext ? editorContext() : null);
  };

  const needsSetup = status !== null && !status[status.config.provider].configured;
  const provider = status?.config.provider ?? "claude";
  const name = status && provider === "local" ? localName(status.config) : FAMILY_NAMES[familyOf(provider)];

  return (
    <>
      <div className="right-header">
        {askedFrom ? (
          <button className="learn-back" title="Back to the lesson you asked about" onClick={backToLesson}>
            ‹ Back to Lesson
          </button>
        ) : (
          <Icon name="sparkle" />
        )}
        <span className="title">Assistant</span>
        <button className="icon-btn" title="Earlier conversations" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
          <Icon name="history" size={13} />
        </button>
        <button className="icon-btn" title="New conversation" onClick={() => (actions.request({ type: "assistantReset" }), set({ chat: [] }), setShowHistory(false))}>
          <Icon name="plus" size={12} />
        </button>
        <button className="icon-btn" title="Assistant settings" onClick={() => set({ settingsOpen: true, settingsSection: "assistant" })}>
          <Icon name="gear" size={13} />
        </button>
        <button className="icon-btn" title="Close" onClick={() => set({ right: null })}>
          <Icon name="x" size={12} />
        </button>
      </div>
      {showHistory && <SessionList onClose={() => setShowHistory(false)} />}
      <div className="chat-scroll" ref={scroller}>
        {needsSetup && <Setup status={status} onSaved={refresh} />}
        {!needsSetup && chat.length === 0 && (
          <div className="chat-empty">
            Ask about your code. The assistant works in your live image: it can evaluate, compile, read files, run tests and
            drive the debugger.
          </div>
        )}
        {chat.map((item) => (
          <Message key={item.id} item={item} />
        ))}
        {busy && <div className="chat-working">Working…</div>}
      </div>
      <div className="chat-input">
        {about && (
          <div className="chat-about" data-testid="chat-about">
            <Icon name="lambda" size={11} />
            <span className="grow">About {about.label}</span>
            <button className="icon-btn" title="Ask without this code" onClick={() => set({ chatAbout: null })}>
              <Icon name="x" size={10} />
            </button>
          </div>
        )}
        <textarea
          ref={input}
          rows={3}
          placeholder={needsSetup ? `Connect ${name} above to start` : `Ask ${name}…  ⏎ to send`}
          value={text}
          disabled={needsSetup}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="chat-input-bar">
          <label className="toggle" title="Send the current file and the form at the cursor">
            <input type="checkbox" checked={withContext} onChange={(e) => setWithContext(e.target.checked)} /> Include form
          </label>
          <span className="grow" />
          {status && <ModelMenu status={status} onChange={setStatus} />}
          {busy ? (
            <button className="btn danger" onClick={() => actions.request({ type: "assistantCancel" })}>
              <Icon name="stop" size={10} /> Stop
            </button>
          ) : (
            <button className="btn primary" disabled={!text.trim() || needsSetup} onClick={send}>
              Send
            </button>
          )}
        </div>
      </div>
    </>
  );
}
