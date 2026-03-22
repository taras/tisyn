import type { Operation, Task } from "effection";
import { spawn } from "effection";
import { fromReadable } from "@effectionx/node/stream";
import { lines } from "@effectionx/stream-helpers";
import type { Val } from "@tisyn/ir";
import type { OperationSpec, AgentDeclaration, ImplementationHandlers } from "@tisyn/agent";
import type { HostMessage, AgentMessage } from "./transport.js";

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

    const msg = JSON.parse(line) as HostMessage;

    if (msg.method === "initialize") {
      const params = msg.params as { agentId: string; protocolVersion: string };
      if (params.agentId !== declaration.id) {
        sendMessage({
          jsonrpc: "2.0",
          id: msg.id as string | number,
          error: { code: -32002, message: `Unknown agent: ${params.agentId}` },
        });
      } else {
        sendMessage({
          jsonrpc: "2.0",
          id: msg.id as string | number,
          result: {
            protocolVersion: "1.0",
            sessionId: `session-${declaration.id}-${Date.now()}`,
          },
        });
      }
    } else if (msg.method === "execute") {
      const { id, params } = msg;
      const { operation: opName, args } = params;
      const handler = (handlers as Record<string, (args: Val) => Operation<Val>>)[opName];

      if (!handler) {
        sendMessage({
          jsonrpc: "2.0",
          id,
          result: {
            ok: false,
            error: { message: `No handler for operation: ${opName}`, name: "MethodNotFound" },
          },
        });
      } else {
        const task = yield* spawn(function* () {
          try {
            const val = yield* handler(args[0] as Val);
            inflight.delete(id);
            sendMessage({
              jsonrpc: "2.0",
              id,
              result: { ok: true, value: val as Val },
            });
          } catch (error) {
            inflight.delete(id);
            const err = error instanceof Error ? error : new Error(String(error));
            sendMessage({
              jsonrpc: "2.0",
              id,
              result: { ok: false, error: { message: err.message, name: err.name } },
            });
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
