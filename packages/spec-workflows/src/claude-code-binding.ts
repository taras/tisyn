// Pilot-local Claude binding. Thin wrapper around `createSdkBinding`
// so the CLI descriptor can reference `./claude-code-binding.ts`
// uniformly with the filesystem and output bindings.
//
// The ACP subprocess binding is NOT used here — the pilot's live
// semantic gate runs through the in-process Claude Agent SDK.

import type { LocalAgentBinding } from "@tisyn/transport";
import { createSdkBinding } from "@tisyn/claude-code";

export function createBinding(): LocalAgentBinding {
  return createSdkBinding({ model: "claude-sonnet-4-6" });
}
