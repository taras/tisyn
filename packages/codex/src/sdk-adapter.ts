/**
 * Codex SDK adapter.
 *
 * Translates between Tisyn protocol messages and the
 * `@openai/codex-sdk` TypeScript API. Uses `startThread()` to create
 * a persistent thread per session and `runStreamed()` for prompt
 * execution with progress forwarding.
 */

import type { Operation, Task } from "effection";
import { resource, createChannel, spawn, call } from "effection";
import type { AgentMessage, LocalAgentBinding, HostMessage } from "@tisyn/transport";
import {
  initializeResponse,
  executeSuccess,
  executeApplicationError,
  progressNotification,
} from "@tisyn/protocol";
import type { Val } from "@tisyn/ir";
import type { CodexSdkConfig } from "./types.js";
import { validateApproval, validateSandbox, validateModel } from "./validate-config.js";

export function createSdkBinding(config?: CodexSdkConfig): LocalAgentBinding {
  validateApproval(config?.approval);
  validateSandbox(config?.sandbox);
  validateModel(config?.model);

  return {
    transport: () =>
      resource(function* (provide) {
        const agentToHost = createChannel<AgentMessage, void>();

        let handleCounter = 0;
        const threads = new Map<string, { codex: unknown; thread: unknown }>();
        const inflight = new Map<string, Task<void>>();

        yield* provide({
          *send(message: HostMessage) {
            if (message.method === "initialize") {
              yield* agentToHost.send(
                initializeResponse(message.id, {
                  protocolVersion: "1.0",
                  sessionId: `codex-sdk-${Date.now()}`,
                }),
              );
              return;
            }

            if (message.method === "shutdown") {
              threads.clear();
              inflight.clear();
              return;
            }

            if (message.method === "cancel") {
              const task = inflight.get(message.params.id);
              if (task) {
                inflight.delete(message.params.id);
                yield* task.halt();
              }
              return;
            }

            if (message.method === "execute") {
              const { id, params } = message;
              const opName = params.operation.includes(".")
                ? params.operation.split(".").pop()!
                : params.operation;
              const args = params.args[0] as Record<string, unknown> | undefined;
              const token = String(params.progressToken ?? id);

              const payload: Record<string, unknown> =
                (args as Record<string, unknown>) ?? {};

              const task = yield* spawn(function* () {
                try {
                  const result: Val = yield* handleOperation(opName, payload, token, agentToHost);
                  yield* agentToHost.send(executeSuccess(String(id), result));
                } catch (e) {
                  const err = e instanceof Error ? e : new Error(String(e));
                  yield* agentToHost.send(
                    executeApplicationError(String(id), {
                      message: err.message,
                      name: err.name,
                    }),
                  );
                }
                inflight.delete(String(id));
              });
              inflight.set(String(id), task);
              return;
            }
          },
          receive: agentToHost,
        });

        function* handleOperation(
          opName: string,
          params: Record<string, unknown>,
          progressToken: string,
          channel: { send(msg: AgentMessage): Operation<void> },
        ): Operation<Val> {
          switch (opName) {
            case "newSession": {
              const sdk = yield* call(() => import("@openai/codex-sdk"));
              const codex = new sdk.Codex({
                env: config?.env,
              });
              const thread = codex.startThread({
                model: config?.model ?? (params.model as string | undefined),
                sandboxMode: config?.sandbox as
                  | "read-only"
                  | "workspace-write"
                  | "danger-full-access"
                  | undefined,
                workingDirectory: config?.cwd,
                approvalPolicy: config?.approval as "on-request" | "never" | undefined,
              });
              const handle = `cx-${++handleCounter}`;
              threads.set(handle, { codex, thread });
              return { sessionId: handle } as unknown as Val;
            }

            case "closeSession": {
              // Stale-handle tolerance (base contract §9.1, O-CX-3):
              // return null without error regardless.
              const sessionHandle =
                (params.sessionId as string) ??
                ((params as Record<string, unknown>).sessionId as string);
              if (sessionHandle) {
                threads.delete(sessionHandle);
              }
              return null as unknown as Val;
            }

            case "prompt": {
              // Stale-handle strict (base contract §9.2, O-CX-4)
              const sessionHandle = (params.session as Record<string, unknown>)
                ?.sessionId as string;
              if (!sessionHandle || !threads.has(sessionHandle)) {
                const err = new Error(`Unknown session handle: ${sessionHandle ?? "undefined"}`);
                err.name = "SessionNotFound";
                throw err;
              }
              const { thread } = threads.get(sessionHandle)!;
              const prompt = params.prompt as string;
              if (!prompt) {
                throw new Error("prompt operation requires a prompt parameter");
              }

              const streamedTurn = yield* call(() =>
                (
                  thread as {
                    runStreamed(
                      input: string,
                    ): Promise<{ events: AsyncGenerator<Record<string, unknown>> }>;
                  }
                ).runStreamed(prompt),
              );
              let responseText = "";

              for (;;) {
                const { value: event, done } = yield* call(() => streamedTurn.events.next());
                if (done) {
                  break;
                }

                if (event.type === "turn.failed") {
                  const failedEvent = event as { error: { message: string } };
                  throw new Error(`Codex turn failed: ${failedEvent.error.message}`);
                }
                if (
                  event.type === "item.completed" &&
                  (event.item as Record<string, unknown>)?.type === "agent_message"
                ) {
                  responseText = (event.item as Record<string, unknown>).text as string;
                }
                yield* channel.send(progressNotification(progressToken, event as unknown as Val));
              }

              return { response: responseText } as unknown as Val;
            }

            case "fork": {
              const err = new Error("fork is not supported by the Codex adapter.");
              err.name = "NotSupported";
              throw err;
            }

            case "openFork": {
              const err = new Error("openFork is not supported by the Codex adapter.");
              err.name = "NotSupported";
              throw err;
            }

            default:
              throw new Error(
                `Unknown operation: ${opName}. ` +
                  `Supported operations: newSession, closeSession, prompt, fork, openFork.`,
              );
          }
        }
      }),
  };
}
