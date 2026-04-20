/**
 * Codex exec adapter.
 *
 * Non-conforming convenience utility that wraps `codex exec --json`
 * as a one-shot per-prompt subprocess. Each prompt spawns an
 * independent process with no conversation history.
 *
 * This adapter does NOT satisfy the CodeAgent contract because it
 * cannot preserve sequential prompt history (base contract §10.2).
 * It is suitable for CI workflows where each prompt is independent.
 */

import type { Operation, Task } from "effection";
import { resource, createChannel, spawn } from "effection";
import { exec } from "@effectionx/process";
import { lines, filter, map } from "@effectionx/stream-helpers";
import { pipe } from "remeda";
import type { AgentMessage, LocalAgentBinding, HostMessage } from "@tisyn/transport";
import {
  initializeResponse,
  executeSuccess,
  executeApplicationError,
  progressNotification,
} from "@tisyn/protocol";
import type { Val } from "@tisyn/ir";
import type { CodexExecConfig } from "./types.js";
import { validateCommand } from "./validate-config.js";
import { validateNewSessionPayload } from "@tisyn/code-agent";

/**
 * Build the argument array for `codex exec`.
 *
 * Verified: `codex exec --json <prompt>` exists (spec §4.4).
 *
 * The exact CLI flags for passing model, sandbox, and approval config
 * values are not verified in the imported spec. Config fields are
 * omitted from the argument list until flag names are validated
 * against the real CLI. This function is the single point that needs
 * updating after CLI flag validation.
 */
export function buildExecArgs(prompt: string): string[] {
  return ["exec", "--json", prompt];
}

export function createExecBinding(config?: CodexExecConfig): LocalAgentBinding {
  if (config?.model !== undefined) {
    throw new Error(
      "Codex exec adapter cannot honor 'model' config: CLI flag mapping for " +
        "'codex exec' is unverified. Remove the model field or use the SDK adapter when available.",
    );
  }
  if (config?.sandbox !== undefined) {
    throw new Error(
      "Codex exec adapter cannot honor 'sandbox' config: CLI flag mapping for " +
        "'codex exec' is unverified. Remove the sandbox field or use the SDK adapter when available.",
    );
  }
  if (config?.approval !== undefined) {
    throw new Error(
      "Codex exec adapter cannot honor 'approval' config: CLI flag mapping for " +
        "'codex exec' is unverified. Remove the approval field or use the SDK adapter when available.",
    );
  }
  validateCommand(config?.command);

  const command = config?.command ?? "codex";

  return {
    transport: () =>
      resource(function* (provide) {
        const agentToHost = createChannel<AgentMessage, void>();

        let handleCounter = 0;
        const handles = new Set<string>();
        const inflight = new Map<string, Task<void>>();

        yield* provide({
          *send(message: HostMessage) {
            if (message.method === "initialize") {
              yield* agentToHost.send(
                initializeResponse(message.id, {
                  protocolVersion: "1.0",
                  sessionId: `codex-exec-${Date.now()}`,
                }),
              );
              return;
            }

            if (message.method === "shutdown") {
              handles.clear();
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
              validateNewSessionPayload(params);
              if (params.model !== undefined) {
                throw new Error(
                  "Codex exec adapter cannot honor 'model' in newSession config: " +
                    "CLI flag mapping for 'codex exec' is unverified. " +
                    "Omit the model field or use the SDK adapter when available.",
                );
              }
              const handle = `cx-${++handleCounter}`;
              handles.add(handle);
              return { sessionId: handle } as unknown as Val;
            }

            case "closeSession": {
              // Stale-handle tolerance (base contract §9.1, O-CX-3):
              // return null without error regardless.
              const sessionHandle =
                (params.sessionId as string) ??
                ((params as Record<string, unknown>).sessionId as string);
              if (sessionHandle) {
                handles.delete(sessionHandle);
              }
              return null as unknown as Val;
            }

            case "prompt": {
              // Stale-handle strict (base contract §9.2, O-CX-4)
              const sessionHandle = (params.session as Record<string, unknown>)
                ?.sessionId as string;
              if (!sessionHandle || !handles.has(sessionHandle)) {
                const err = new Error(`Unknown session handle: ${sessionHandle ?? "undefined"}`);
                err.name = "SessionNotFound";
                throw err;
              }

              const prompt = params.prompt as string;
              if (!prompt) {
                throw new Error("prompt operation requires a prompt parameter");
              }

              // Spawn independent codex exec subprocess (non-conforming:
              // no conversation history carried over).
              const execArgs = [...(config?.arguments ?? []), ...buildExecArgs(prompt)];

              const proc = yield* exec(command, {
                arguments: execArgs,
                env: config?.env,
                cwd: config?.cwd,
              });

              // Capture stderr for diagnostics
              const stderrChunks: string[] = [];
              const decoder = new TextDecoder();
              yield* spawn(function* () {
                const sub = yield* proc.stderr;
                for (;;) {
                  const { value, done } = yield* sub.next();
                  if (done) {
                    break;
                  }
                  stderrChunks.push(decoder.decode(value));
                }
              });

              // Parse NDJSON from stdout
              const eventStream = pipe(
                proc.stdout,
                lines(),
                filter(function* (line: string) {
                  return line.trim().length > 0;
                }),
                map(function* (line: string): Operation<Record<string, unknown>> {
                  try {
                    return JSON.parse(line) as Record<string, unknown>;
                  } catch {
                    throw new Error(`Malformed JSON from codex exec: ${line}`);
                  }
                }),
              );

              let lastEvent: Record<string, unknown> | null = null;
              const sub = yield* eventStream;
              for (;;) {
                const { value, done } = yield* sub.next();
                if (done) {
                  break;
                }

                // Forward intermediate events as progress
                if (lastEvent !== null) {
                  yield* channel.send(
                    progressNotification(progressToken, lastEvent as unknown as Val),
                  );
                }
                lastEvent = value;
              }

              // Wait for process to complete and check exit status
              const exitStatus = yield* proc.join();
              if (exitStatus.code !== 0) {
                const stderr = stderrChunks.join("");
                throw new Error(
                  `codex exec exited with code ${exitStatus.code}` +
                    (stderr ? `\nstderr:\n${stderr}` : ""),
                );
              }

              // The final event provides the response text
              if (!lastEvent) {
                throw new Error("codex exec produced no output events");
              }

              // Extract assistant text from the Codex NDJSON output.
              // Real codex exec --json emits completed items with shape:
              //   { type: "item.completed", item: { type: "message", text: "..." } }
              // The mock and older formats may use { response: "..." } directly.
              const completed = lastEvent as Record<string, unknown>;
              let response: string;
              if (
                completed.type === "item.completed" &&
                completed.item != null &&
                typeof (completed.item as Record<string, unknown>).text === "string"
              ) {
                response = (completed.item as Record<string, unknown>).text as string;
              } else if (typeof completed.response === "string") {
                response = completed.response;
              } else if (typeof completed.message === "string") {
                response = completed.message;
              } else {
                response = JSON.stringify(lastEvent);
              }

              return { response } as unknown as Val;
            }

            case "fork": {
              const err = new Error("fork is not supported by the Codex exec adapter.");
              err.name = "NotSupported";
              throw err;
            }

            case "openFork": {
              const err = new Error("openFork is not supported by the Codex exec adapter.");
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
