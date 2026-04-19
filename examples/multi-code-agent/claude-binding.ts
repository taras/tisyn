import { createSdkBinding } from "@tisyn/claude-code";
import type { SdkAdapterConfig } from "@tisyn/claude-code";
import type { LocalAgentBinding } from "@tisyn/transport";

export function createBinding(config?: SdkAdapterConfig): LocalAgentBinding {
  return createSdkBinding({
    model: "claude-sonnet-4-6",
    ...config,
  });
}
