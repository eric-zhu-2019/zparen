import type { AssistantConfig } from "../protocol/AssistantConfig";
import type { Provider } from "../protocol/Provider";

/**
 * A provider is two choices: which assistant, Claude or Codex, and how it
 * signs in. An API key calls the vendor's API and is billed per token. A
 * login runs the user's own claude or codex command, on their subscription.
 */
export type Family = "claude" | "codex";
export type Method = "api" | "login";

export const FAMILY_NAMES: Record<Family, string> = { claude: "Claude", codex: "Codex" };
export const METHOD_NAMES: Record<Method, string> = { api: "API key", login: "Login" };

const PROVIDERS: Record<Family, Record<Method, Provider>> = {
  claude: { api: "claude", login: "claudeCode" },
  codex: { api: "openai", login: "codex" },
};

export const providerOf = (family: Family, method: Method): Provider => PROVIDERS[family][method];
export const familyOf = (p: Provider): Family => (p === "claude" || p === "claudeCode" ? "claude" : "codex");
export const methodOf = (p: Provider): Method => (p === "claudeCode" || p === "codex" ? "login" : "api");

/** Claude Code and Codex answer with the user's own login, through the command they installed. */
export const isAgent = (p: Provider) => methodOf(p) === "login";

/** "Claude · API key", as the model menu groups the models. */
export const providerLabel = (p: Provider) => `${FAMILY_NAMES[familyOf(p)]} · ${METHOD_NAMES[methodOf(p)]}`;

/** Every provider, grouped by assistant. */
export const ALL_PROVIDERS: Provider[] = ["claude", "claudeCode", "openai", "codex"];

/** What each choice uses and who pays, for the hint under it. */
export const METHOD_HINTS: Record<Provider, string> = {
  claude: "Calls the Anthropic API with your key. Billed per token on your API account.",
  claudeCode: "Runs your claude command (Claude Code) with its login. Uses your Claude plan.",
  openai: "Calls the OpenAI API with your key. Billed per token on your API account.",
  codex: "Runs your codex command with its login. Uses your ChatGPT plan.",
};

/** The setting that holds each provider's model. */
export const MODEL_KEY = { claude: "claudeModel", openai: "openaiModel", claudeCode: "claudeCodeModel", codex: "codexModel" } as const satisfies Record<
  Provider,
  keyof AssistantConfig
>;
