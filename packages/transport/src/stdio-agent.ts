import type { Operation, Task } from "effection";
import { spawn } from "effection";
import process from "node:process";
import { fromReadable } from "@effectionx/node/stream";
import { lines } from "@effectionx/stream-helpers";
import type { Val } from "@tisyn/ir";
import type { OperationSpec, AgentDeclaration, ImplementationHandlers } from "@tisyn/agent";
import type { AgentMessage } from "@tisyn/protocol";
import {
  parseHostMessage,
  initializeResponse,
  initializeProtocolError,
  executeSuccess,
  executeApplicationError,
  ProtocolErrorCode,
} from "@tisyn/protocol";

/**
 * Run an agent over stdio using NDJSON framing. This is the agent-side
 * entry point — call it from a subprocess that will be spawned by
 * `stdioTransport()` on the host side.
 *
 * Reads HostMessages as NDJSON from process.stdin.
 * Writes AgentMessages as NDJSON to process.stdout.
 */
export function* runStdioAgent<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
): Operation<void> {
  const inflight = new Map<string, Task<void>>();

  function sendMessage(msg: AgentMessage): void {
    process.stdout.write(JSON.stringify(msg) + "\n");
  }

  const lineStream = lines()(fromReadable(process.stdin));
  const sub = yield* lineStream;

  for (;;) {
    const { value: line, done } = yield* sub.next();
    if (done) break;

    const msg = parseHostMessage(JSON.parse(line));

    if (msg.method === "initialize") {
      if (msg.params.agentId !== declaration.id) {
        sendMessage(
          initializeProtocolError(msg.id, {
            code: ProtocolErrorCode.IncompatibleVersion,
            message: `Unknown agent: ${msg.params.agentId}`,
          }),
        );
      } else {
        sendMessage(
          initializeResponse(msg.id, {
            protocolVersion: "1.0",
            sessionId: `session-${declaration.id}-${Date.now()}`,
          }),
        );
      }
    } else if (msg.method === "execute") {
      const { id, params } = msg;
      const { operation: opName, args } = params;
      const handler = (handlers as Record<string, (args: Val) => Operation<Val>>)[opName];

      if (!handler) {
        sendMessage(
          executeApplicationError(id, {
            message: `No handler for operation: ${opName}`,
            name: "MethodNotFound",
          }),
        );
      } else {
        const task = yield* spawn(function* () {
          try {
            const val = yield* handler(args[0] as Val);
            inflight.delete(id);
            sendMessage(executeSuccess(id, val as Val));
          } catch (error) {
            inflight.delete(id);
            const err = error instanceof Error ? error : new Error(String(error));
            sendMessage(executeApplicationError(id, { message: err.message, name: err.name }));
          }
        });

        inflight.set(id, task);
      }
    } else if (msg.method === "cancel") {
      const cancelId = msg.params.id;
      const task = inflight.get(cancelId);
      if (task) {
        inflight.delete(cancelId);
        yield* task.halt();
      }
    } else if (msg.method === "shutdown") {
      break;
    }
  }
}
