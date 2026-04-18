import { createSdkBinding } from "@tisyn/codex";
import type { CodexSdkConfig } from "@tisyn/codex";
import type { LocalAgentBinding } from "@tisyn/transport";

/**
 * Codex SDK binding for this example.
 *
 * Uses the @openai/codex-sdk which maintains per-thread
 * conversation history across prompts.
 *
 * Requires valid Codex CLI credentials.
 */
export function createBinding(config?: CodexSdkConfig): LocalAgentBinding {
  return createSdkBinding(config);
}
