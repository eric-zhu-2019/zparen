import type { AssistantConfig } from "../protocol/AssistantConfig";
import type { Provider } from "../protocol/Provider";

export const PROVIDER_NAMES: Record<Provider, string> = { claude: "Claude", openai: "OpenAI", claudeCode: "Claude Code", codex: "Codex" };

/** The setting that holds each provider's model. */
export const MODEL_KEY = { claude: "claudeModel", openai: "openaiModel", claudeCode: "claudeCodeModel", codex: "codexModel" } as const satisfies Record<
  Provider,
  keyof AssistantConfig
>;

/** Claude Code and Codex answer with the user's own login, through the command they installed. */
export const isAgent = (p: Provider) => p === "claudeCode" || p === "codex";
