/**
 * Claude Code SDK adapter.
 *
 * Translates between Tisyn protocol messages and the
 * `@anthropic-ai/claude-agent-sdk` TypeScript API. Uses
 * `unstable_v2_createSession()` to keep a single subprocess alive
 * across multiple `plan` calls within a session.
 *
 * Unlike the ACP adapter this does not spawn a subprocess directly —
 * the SDK manages Claude Code subprocess lifecycle internally.
 */

import type { Operation } from "effection";
import { resource, createChannel, spawn, call } from "effection";
import type { AgentMessage, LocalAgentBinding, HostMessage } from "@tisyn/transport";
import {
  initializeResponse,
  executeSuccess,
  executeApplicationError,
  progressNotification,
} from "@tisyn/protocol";
import type { Val } from "@tisyn/ir";

export interface SdkAdapterConfig {
  /** Model to use (e.g. "claude-sonnet-4-6"). Defaults to "claude-sonnet-4-6". */
  model?: string;
  /** Permission mode (e.g. "default", "plan"). Defaults to SDK default. */
  permissionMode?: string;
}

/**
 * Create a `LocalAgentBinding` backed by the Claude Agent SDK.
 *
 * The binding handles all five Tisyn operations:
 * - `newSession` — creates an SDKSession via `unstable_v2_createSession()`,
 *   returns an adapter-internal handle (`cc-1`, `cc-2`, …)
 * - `plan` — looks up the session by handle, calls `send()` + `stream()`
 * - `closeSession` — calls `session.close()`, removes handle from map
 * - `fork` — calls `forkSession()` with the real SDK session ID
 * - `openFork` — calls `unstable_v2_resumeSession()`, returns new handle
 */
export function createSdkBinding(config?: SdkAdapterConfig): LocalAgentBinding {
  return {
    transport: () =>
      resource(function* (provide) {
        const agentToHost = createChannel<AgentMessage, void>();

        // Adapter-internal handle model: workflows see "cc-1", "cc-2", etc.
        // The real SDK session IDs are never exposed.
        let handleCounter = 0;
        const sessions = new Map<string, unknown>();
        let currentModel = config?.model ?? "claude-sonnet-4-6";

        function getSession(handle: string): unknown {
          const session = sessions.get(handle);
          if (!session) {
            throw new Error(`Unknown session handle: ${handle}`);
          }
          return session;
        }

        yield* provide({
          *send(message: HostMessage) {
            if (message.method === "initialize") {
              yield* agentToHost.send(
                initializeResponse(message.id, {
                  protocolVersion: "1.0",
                  sessionId: `sdk-${Date.now()}`,
                }),
              );
              return;
            }

            if (message.method === "shutdown") {
              // Close all open sessions on shutdown
              for (const [handle, session] of sessions) {
                (session as { close(): void }).close();
                sessions.delete(handle);
              }
              return;
            }

            if (message.method === "cancel") {
              return;
            }

            if (message.method === "execute") {
              const { id, params } = message;
              const opName = params.operation.includes(".")
                ? params.operation.split(".").pop()!
                : params.operation;
              const args = params.args[0] as Record<string, unknown> | undefined;
              const progressToken = String(params.progressToken ?? id);

              // Unwrap the compiler's single-parameter envelope
              const UNWRAP: Record<string, string> = {
                newSession: "config",
                closeSession: "handle",
                plan: "args",
                fork: "session",
                openFork: "data",
              };
              const unwrapKey = UNWRAP[opName];
              let unwrapped: Record<string, unknown>;
              if (unwrapKey && args && unwrapKey in args) {
                unwrapped = args[unwrapKey] as Record<string, unknown>;
              } else {
                unwrapped = (args as Record<string, unknown>) ?? {};
              }

              yield* spawn(function* () {
                try {
                  const result: Val = yield* handleOperation(
                    opName,
                    unwrapped,
                    progressToken,
                    agentToHost,
                  );
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
              });
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
              const model = (params.model as string) ?? currentModel;
              currentModel = model;
              const sdk = yield* call(() => import("@anthropic-ai/claude-agent-sdk"));
              const session = sdk.unstable_v2_createSession({
                model: currentModel,
                ...(config?.permissionMode ? { permissionMode: config.permissionMode as any } : {}),
              });
              const handle = `cc-${++handleCounter}`;
              sessions.set(handle, session);
              return { sessionId: handle } as unknown as Val;
            }

            case "closeSession": {
              const sessionHandle =
                (params.sessionId as string) ??
                ((params as Record<string, unknown>).sessionId as string);
              const session = sessions.get(sessionHandle);
              if (session) {
                (session as { close(): void }).close();
                sessions.delete(sessionHandle);
              }
              return null as unknown as Val;
            }

            case "plan": {
              const sessionHandle = (params.session as Record<string, unknown>)
                ?.sessionId as string;
              const session = getSession(sessionHandle);
              const prompt = params.prompt as string;
              if (!prompt) {
                throw new Error("plan operation requires a prompt parameter");
              }

              yield* call(() => (session as { send(msg: string): Promise<void> }).send(prompt));

              let resultText = "";
              const gen = (
                session as {
                  stream(): AsyncGenerator<Record<string, unknown>, void>;
                }
              ).stream();
              for (;;) {
                const { value, done } = yield* call(() => gen.next());
                if (done) {
                  break;
                }
                const msg = value as Record<string, unknown>;

                if (
                  msg.type === "assistant" ||
                  msg.type === "tool_progress" ||
                  msg.type === "system"
                ) {
                  yield* channel.send(progressNotification(progressToken, msg as unknown as Val));
                }

                if (msg.type === "result") {
                  if (msg.subtype === "success") {
                    resultText = msg.result as string;
                  } else {
                    const errors = msg.errors as string[] | undefined;
                    throw new Error(errors?.join("; ") ?? `Claude query failed: ${msg.subtype}`);
                  }
                }
              }

              return { response: resultText } as unknown as Val;
            }

            case "fork": {
              const sessionHandle = params.sessionId as string;
              const session = getSession(sessionHandle);
              let sdkSessionId: string;
              try {
                sdkSessionId = (session as { sessionId: string }).sessionId;
              } catch {
                throw new Error(
                  "fork requires at least one plan call before forking (session not yet initialized)",
                );
              }
              const sdk = yield* call(() => import("@anthropic-ai/claude-agent-sdk"));
              const result = yield* call(() => sdk.forkSession(sdkSessionId));
              return {
                parentSessionId: sessionHandle,
                forkId: result.sessionId,
              } as unknown as Val;
            }

            case "openFork": {
              const forkId = params.forkId as string;
              if (!forkId) {
                throw new Error("openFork requires forkId in data");
              }
              const sdk = yield* call(() => import("@anthropic-ai/claude-agent-sdk"));
              const newSession = sdk.unstable_v2_resumeSession(forkId, {
                model: currentModel,
                ...(config?.permissionMode ? { permissionMode: config.permissionMode as any } : {}),
              });
              const handle = `cc-${++handleCounter}`;
              sessions.set(handle, newSession);
              return { sessionId: handle } as unknown as Val;
            }

            default:
              throw new Error(`Unknown operation: ${opName}`);
          }
        }
      }),
  };
}
