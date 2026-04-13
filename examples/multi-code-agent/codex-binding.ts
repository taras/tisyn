import { createExecBinding } from "@tisyn/codex";
import type { CodexExecConfig } from "@tisyn/codex";
import type { LocalAgentBinding } from "@tisyn/transport";

/**
 * Codex exec binding for this example.
 *
 * Uses the non-conforming exec adapter which runs `codex exec --json`
 * as an independent subprocess per prompt. This is suitable for the
 * one-shot handoff demonstrated here, but does not preserve session
 * history across prompts.
 *
 * Requires the `codex` CLI to be installed and authenticated.
 */
export function createBinding(config?: CodexExecConfig): LocalAgentBinding {
  return createExecBinding(config);
}
