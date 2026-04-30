import { call } from "effection";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import { OpusAgent } from "./agents.js";
import { buildPeerPrompt, parsePeerResult } from "./parse-peer-result.js";
import type { PeerTurnResult } from "../schemas.js";

export interface OpusBindingConfig {
  /** Model id passed to @anthropic-ai/claude-agent-sdk. */
  model?: string;
  /** Permission mode forwarded to the SDK (most restrictive available). */
  permissionMode?: string;
}

/**
 * Opus peer binding — one fresh SDK session per turn.
 *
 * Live posture: `permissionMode: "plan"` (the most restrictive non-mutating
 * mode the adapter surface exposes today). Callers can override via config.
 */
export function createBinding(config?: Record<string, unknown>): LocalAgentBinding {
  const opts: OpusBindingConfig = {
    model: (config?.model as string) ?? "claude-sonnet-4-6",
    permissionMode: (config?.permissionMode as string) ?? "plan",
  };

  return {
    transport: inprocessTransport(OpusAgent(), {
      *takeTurn(input) {
        const response = yield* call(async () => {
          const sdk = await import("@anthropic-ai/claude-agent-sdk");
          const session = sdk.unstable_v2_createSession({
            model: opts.model!,
            ...(opts.permissionMode ? { permissionMode: opts.permissionMode as any } : {}),
          });
          try {
            await session.send(
              buildPeerPrompt({
                transcript: input.transcript,
                tarasMode: input.tarasMode,
                peerName: "opus",
              }),
            );
            let result = "";
            for await (const msg of session.stream()) {
              const m = msg as Record<string, unknown>;
              if (m.type === "result" && m.subtype === "success") {
                result = m.result as string;
              }
            }
            return result;
          } finally {
            session.close();
          }
        });
        const parsed: PeerTurnResult = parsePeerResult(response);
        return parsed;
      },
    }),
  };
}
