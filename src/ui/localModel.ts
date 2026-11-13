import * as actions from "../actions";
import type { AssistantConfig } from "../protocol/AssistantConfig";
import type { AssistantStatus } from "../protocol/AssistantStatus";

/**
 * Saves the local server's address and answers the new status. When no model
 * is chosen yet, the first one the server lists is chosen.
 */
export async function connectLocal(config: AssistantConfig, localUrl: string): Promise<AssistantStatus | null> {
  const r = await actions.request({ type: "assistantConfigure", config: { ...config, localUrl: localUrl.trim() } });
  if (r.type !== "assistant") return null;
  const first = r.local.models[0];
  if (r.config.localModel || !first) return r;
  const chosen = await actions.request({ type: "assistantConfigure", config: { ...r.config, localModel: first } });
  return chosen.type === "assistant" ? chosen : r;
}

/** What the chat calls a local model: its name, once one is chosen. */
export const localName = (config: AssistantConfig) => config.localModel || "the local model";
