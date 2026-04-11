import { createSdkBinding } from "@tisyn/claude-code";
import type { SdkAdapterConfig } from "@tisyn/claude-code";
import type { LocalAgentBinding } from "@tisyn/transport";

/**
 * Claude Code SDK binding for this example.
 *
 * Uses @tisyn/claude-code's SDK adapter which calls the
 * @anthropic-ai/claude-agent-sdk TypeScript API directly.
 * Requires valid Claude credentials (`claude auth`).
 */
export function createBinding(config?: SdkAdapterConfig): LocalAgentBinding {
  return createSdkBinding({
    model: "claude-sonnet-4-6",
    ...config,
  });
}
