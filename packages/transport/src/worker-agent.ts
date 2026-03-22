import { spawn, createQueue } from "effection";
import { workerMain } from "@effectionx/worker";
import type { OperationSpec, AgentDeclaration, ImplementationHandlers } from "@tisyn/agent";
import type { AgentMessage } from "@tisyn/protocol";
import { parseHostMessage } from "@tisyn/protocol";
import type { HostMessage } from "./transport.js";
import { runAgentHandler } from "./agent-handler.js";

/**
 * Bootstrap a tisyn agent inside a worker thread.
 *
 * Call this from a worker entry file:
 * ```ts
 * import { runWorkerAgent } from "@tisyn/transport/worker-agent";
 *
 * runWorkerAgent(myAgent, { *myOp(args) { return result; } });
 * ```
 *
 * Uses `@effectionx/worker`'s `workerMain` to receive `HostMessage`s
 * (via void-ACK request/response) and delegates protocol dispatch to
 * the shared `runAgentHandler`.
 */
export function runWorkerAgent<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
): Promise<void> {
  return workerMain<HostMessage, void, void, void, AgentMessage, void>(
    function* ({ messages, send }) {
      // Buffer host messages into a queue for runAgentHandler to consume
      const queue = createQueue<HostMessage, void>();

      yield* spawn(function* () {
        yield* messages.forEach(function* (raw) {
          queue.add(parseHostMessage(raw));
        });
        queue.close();
      });

      yield* runAgentHandler(declaration, handlers, {
        receive: queue,
        *send(agentMsg) {
          yield* send(agentMsg);
        },
      });
    },
  );
}
