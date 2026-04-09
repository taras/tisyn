/**
 * Claude Code ACP transport binding module.
 *
 * Exports `createBinding()` returning a `LocalAgentBinding` that connects
 * to a Claude Code ACP stdio process and translates between Tisyn protocol
 * and ACP protocol messages.
 *
 * Usage in config descriptor:
 * ```typescript
 * // claude-code-binding.ts (project-local wrapper)
 * export { createBinding } from "@tisyn/transport/claude-code";
 *
 * // tisyn.config.ts
 * agent("claude-code", transport.local("./claude-code-binding.ts"))
 * ```
 */

import { resource } from "effection";
import type { LocalAgentBinding, HostMessage } from "../../transport.js";
import { createAcpAdapter } from "./acp-adapter.js";
import type { AcpAdapterConfig } from "./acp-adapter.js";

export type { SessionHandle, PlanResult, ForkData } from "./types.js";
export type { AcpAdapterConfig } from "./acp-adapter.js";

/**
 * Create a LocalAgentBinding for the Claude Code ACP transport.
 *
 * The binding connects to an ACP stdio process (spawned or pre-existing)
 * and translates between Tisyn and ACP protocol messages.
 *
 * The ACP process is transport-external — when the transport scope exits,
 * only the logical connection is closed. The process is not terminated.
 */
export function createBinding(config?: AcpAdapterConfig): LocalAgentBinding {
  return {
    transport: () =>
      resource(function* (provide) {
        const adapter = yield* createAcpAdapter(config);

        yield* provide({
          *send(message: HostMessage) {
            yield* adapter.sendTisynMessage(message);
          },
          receive: adapter.tisynMessages,
        });
      }),
  };
}
