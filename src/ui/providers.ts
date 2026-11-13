import type { AssistantConfig } from "../protocol/AssistantConfig";
import type { Provider } from "../protocol/Provider";

/**
 * A provider is two choices: which assistant, Claude or Codex, and how it
 * signs in. An API key calls the vendor's API and is billed per token. A
 * login runs the user's own claude or codex command, on their subscription.
 * A local model is a server the user names, such as Ollama, with no sign-in
 * choice.
 */
export type Family = "claude" | "codex" | "local";
export type Method = "api" | "login";

export const FAMILY_NAMES: Record<Family, string> = { claude: "Claude", codex: "Codex", local: "Local model" };
export const FAMILIES: Family[] = ["claude", "codex", "local"];
export const METHOD_NAMES: Record<Method, string> = { api: "API key", login: "Login" };

const PROVIDERS: Record<Family, Record<Method, Provider>> = {
  claude: { api: "claude", login: "claudeCode" },
  codex: { api: "openai", login: "codex" },
  local: { api: "local", login: "local" },
};

export const providerOf = (family: Family, method: Method): Provider => PROVIDERS[family][method];
export const familyOf = (p: Provider): Family => (p === "local" ? "local" : p === "claude" || p === "claudeCode" ? "claude" : "codex");
export const methodOf = (p: Provider): Method => (p === "claudeCode" || p === "codex" ? "login" : "api");

/** Claude Code and Codex answer with the user's own login, through the command they installed. */
export const isAgent = (p: Provider) => methodOf(p) === "login";

/** "Claude · API key", as the model menu groups the models. */
export const providerLabel = (p: Provider) => (p === "local" ? FAMILY_NAMES.local : `${FAMILY_NAMES[familyOf(p)]} · ${METHOD_NAMES[methodOf(p)]}`);

/** Every provider, grouped by assistant. */
export const ALL_PROVIDERS: Provider[] = ["claude", "claudeCode", "openai", "codex", "local"];

/** What each choice uses and who pays, for the hint under it. */
export const METHOD_HINTS: Record<Provider, string> = {
  claude: "Calls the Anthropic API with your key. Billed per token on your API account.",
  claudeCode: "Runs your claude command (Claude Code) with its login. Uses your Claude plan.",
  openai: "Calls the OpenAI API with your key. Billed per token on your API account.",
  codex: "Runs your codex command with its login. Uses your ChatGPT plan.",
  local: "Calls the server at the address you set, such as Ollama or LM Studio, through its OpenAI-compatible API.",
};

/** The setting that holds each provider's model. */
export const MODEL_KEY = { claude: "claudeModel", openai: "openaiModel", claudeCode: "claudeCodeModel", codex: "codexModel", local: "localModel" } as const satisfies Record<
  Provider,
  keyof AssistantConfig
>;
