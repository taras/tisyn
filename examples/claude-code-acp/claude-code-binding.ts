import { createBinding as createAcpBinding } from "@tisyn/claude-code";
import type { AcpAdapterConfig } from "@tisyn/claude-code";
import type { LocalAgentBinding } from "@tisyn/transport";

/**
 * Claude Code ACP binding for this example.
 *
 * Wraps @tisyn/claude-code's createBinding() with defaults that use
 * the repo-local Claude CLI installed through @anthropic-ai/claude-code,
 * so the example is reproducible from the workspace without a globally
 * installed `claude` binary.
 */
export function createBinding(config?: AcpAdapterConfig): LocalAgentBinding {
  return createAcpBinding({
    command: "pnpm",
    arguments: ["exec", "claude", "--acp"],
    cwd: import.meta.dirname,
    ...config,
  });
}
