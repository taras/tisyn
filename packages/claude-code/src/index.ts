/**
 * Claude Code ACP transport binding module.
 *
 * Exports `createBinding()` returning a `LocalAgentBinding` that connects
 * to a Claude Code ACP stdio process and translates between Tisyn protocol
 * and ACP protocol messages.
 *
 * The binding handles the Tisyn initialize handshake internally — ACP
 * processes don't speak Tisyn protocol, so the binding synthesizes the
 * InitializeResponse that `createSession()` expects.
 */

import { resource, createChannel, spawn } from "effection";
import type { AgentMessage, LocalAgentBinding, HostMessage } from "@tisyn/transport";
import { initializeResponse } from "@tisyn/protocol";
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

        // Channel merges ACP process messages with synthetic protocol
        // responses (e.g. InitializeResponse). createSession() subscribes
        // to transport.receive and expects the first message to be an
        // InitializeResponse — we inject it here.
        const agentToHost = createChannel<AgentMessage, void>();

        // Forward ACP process messages into the channel
        yield* spawn(function* () {
          const sub = yield* adapter.tisynMessages;
          try {
            for (;;) {
              const { value, done } = yield* sub.next();
              if (done) break;
              yield* agentToHost.send(value);
            }
          } finally {
            yield* agentToHost.close();
          }
        });

        yield* provide({
          *send(message: HostMessage) {
            if (message.method === "initialize") {
              // Synthesize InitializeResponse — ACP processes don't speak
              // Tisyn protocol, so the binding handles the handshake.
              yield* agentToHost.send(
                initializeResponse(message.id, {
                  protocolVersion: "1.0",
                  sessionId: `acp-${Date.now()}`,
                }),
              );
              return;
            }
            yield* adapter.sendTisynMessage(message);
          },
          receive: agentToHost,
        });
      }),
  };
}
