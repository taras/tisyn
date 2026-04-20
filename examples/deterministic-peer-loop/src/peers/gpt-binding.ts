import { call } from "effection";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import { GptAgent } from "./agents.js";
import { buildPeerPrompt, parsePeerResult } from "./parse-peer-result.js";
import type { PeerTurnResult } from "../schemas.js";

export interface GptBindingConfig {
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approval?: "on-request" | "never";
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * GPT peer binding — one fresh @openai/codex-sdk thread per turn.
 *
 * Live posture (M2-CAP-1): `sandbox: "read-only"`, `approval: "never"`.
 */
export function createBinding(config?: Record<string, unknown>): LocalAgentBinding {
  const opts: GptBindingConfig = {
    model: config?.model as string | undefined,
    sandbox: (config?.sandbox as GptBindingConfig["sandbox"]) ?? "read-only",
    approval: (config?.approval as GptBindingConfig["approval"]) ?? "never",
    cwd: config?.cwd as string | undefined,
    env: config?.env as Record<string, string> | undefined,
  };

  return {
    transport: inprocessTransport(GptAgent(), {
      *takeTurn(input) {
        const response = yield* call(async () => {
          const sdk = (await import("@openai/codex-sdk")) as {
            Codex: new (config?: Record<string, unknown>) => {
              startThread(options?: Record<string, unknown>): {
                runStreamed(
                  prompt: string,
                ): Promise<{ events: AsyncGenerator<Record<string, unknown>> }>;
              };
            };
          };
          const codex = new sdk.Codex({ env: opts.env });
          const thread = codex.startThread({
            model: opts.model,
            sandboxMode: opts.sandbox,
            workingDirectory: opts.cwd,
            approvalPolicy: opts.approval,
          });
          const prompt = buildPeerPrompt({
            transcript: input.transcript,
            tarasMode: input.tarasMode,
            peerName: "gpt",
          });
          const streamed = await thread.runStreamed(prompt);
          let result = "";
          for (;;) {
            const { value: event, done } = await streamed.events.next();
            if (done) {
              break;
            }
            if (event.type === "turn.failed") {
              throw new Error(
                `Codex turn failed: ${(event as { error?: { message: string } }).error?.message ?? "unknown"}`,
              );
            }
            if (
              event.type === "item.completed" &&
              (event.item as Record<string, unknown>)?.type === "agent_message"
            ) {
              result = (event.item as Record<string, unknown>).text as string;
            }
          }
          return result;
        });
        const parsed: PeerTurnResult = parsePeerResult(response);
        return parsed;
      },
    }),
  };
}
