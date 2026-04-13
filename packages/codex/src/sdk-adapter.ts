/**
 * Codex SDK adapter.
 *
 * Candidate conforming path for the CodeAgent contract, pending
 * @openai/codex-sdk API verification (OQ-CX-1).
 *
 * Config validation is verified and implemented. Operation handlers
 * for newSession and prompt are blocked pending SDK verification.
 * closeSession implements verified stale-handle tolerance.
 * fork/openFork throw NotSupported.
 */

import type { Operation } from "effection";
import { resource, createChannel, spawn } from "effection";
import type { AgentMessage, LocalAgentBinding, HostMessage } from "@tisyn/transport";
import {
  initializeResponse,
  executeSuccess,
  executeApplicationError,
} from "@tisyn/protocol";
import type { Val } from "@tisyn/ir";
import type { CodexSdkConfig } from "./types.js";
import { validateApproval, validateSandbox, validateModel } from "./validate-config.js";

const UNWRAP: Record<string, string> = {
  newSession: "config",
  closeSession: "handle",
  prompt: "args",
  fork: "session",
  openFork: "data",
};

export function createSdkBinding(config?: CodexSdkConfig): LocalAgentBinding {
  validateApproval(config?.approval);
  validateSandbox(config?.sandbox);
  validateModel(config?.model);

  return {
    transport: () =>
      resource(function* (provide) {
        const agentToHost = createChannel<AgentMessage, void>();

        let handleCounter = 0;
        const sessions = new Set<string>();

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
              sessions.clear();
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

              const unwrapKey = UNWRAP[opName];
              let unwrapped: Record<string, unknown>;
              if (unwrapKey && args && unwrapKey in args) {
                unwrapped = args[unwrapKey] as Record<string, unknown>;
              } else {
                unwrapped = (args as Record<string, unknown>) ?? {};
              }

              yield* spawn(function* () {
                try {
                  const result: Val = yield* handleOperation(opName, unwrapped);
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
        ): Operation<Val> {
          switch (opName) {
            case "newSession": {
              // Blocked: SDK thread creation API not verified (OQ-CX-1).
              // When verified, this will call the SDK to create a thread
              // and store it in a sessions map.
              throw new Error(
                "Codex SDK adapter: newSession is not yet implemented. " +
                  "The @openai/codex-sdk thread API has not been verified. " +
                  "See codex-specification.source.md §7.2 and OQ-CX-1.",
              );
            }

            case "closeSession": {
              // Verified: stale-handle tolerance (base contract §9.1, O-CX-3).
              // Return null without error regardless of whether the handle
              // references a live session.
              const sessionHandle =
                (params.sessionId as string) ??
                ((params as Record<string, unknown>).sessionId as string);
              if (sessionHandle) {
                sessions.delete(sessionHandle);
              }
              return null as unknown as Val;
            }

            case "prompt": {
              // Blocked: SDK prompt/streaming API not verified (OQ-CX-1).
              throw new Error(
                "Codex SDK adapter: prompt is not yet implemented. " +
                  "The @openai/codex-sdk thread API has not been verified. " +
                  "See codex-specification.source.md §7.2 and OQ-CX-1.",
              );
            }

            case "fork": {
              const err = new Error(
                "fork is not supported by the Codex adapter. " +
                  "SDK fork/resume capabilities have not been verified (OQ-CX-3).",
              );
              err.name = "NotSupported";
              throw err;
            }

            case "openFork": {
              const err = new Error(
                "openFork is not supported by the Codex adapter. " +
                  "SDK fork/resume capabilities have not been verified (OQ-CX-3).",
              );
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
