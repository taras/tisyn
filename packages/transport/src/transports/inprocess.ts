import type { Operation } from "effection";
import { createChannel, createScope, ensure } from "effection";
import type { OperationSpec, AgentDeclaration, ImplementationHandlers } from "@tisyn/agent";
import { implementAgent } from "@tisyn/agent";
import type {
  AgentTransport,
  AgentTransportFactory,
  HostMessage,
  AgentMessage,
} from "../transport.js";
import { createProtocolServer } from "../protocol-server.js";

/**
 * Create a transport factory for an in-process agent. The agent-side
 * processing loop runs in the same process, using channels for
 * bidirectional message passing.
 *
 * This is the reference transport. Its cancel behavior is normative:
 * cancel interrupts a running handler if still in-flight, and is
 * harmless if the handler already completed.
 *
 * The server runs in an isolated scope (parented to the Effection global
 * root, not to the host task scope) so that host Effects middleware and
 * agent bindings do not leak into the agent-side runtime. Cross-boundary
 * middleware reaches the child only via the protocol middleware field,
 * not through scope inheritance.
 */
export function inprocessTransport<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
): AgentTransportFactory {
  return function* (): Operation<AgentTransport> {
    const hostToAgent = createChannel<HostMessage, void>();
    const agentToHost = createChannel<AgentMessage, void>();

    // Subscribe BEFORE spawning so the subscription exists when sends arrive
    const hostSub = yield* hostToAgent;

    const impl = implementAgent(declaration, handlers);
    const server = createProtocolServer(impl);

    // Create an isolated scope parented to the Effection global root.
    // Its contexts prototype chain terminates at null — no host contexts
    // (Effects middleware, agent bindings, etc.) are inherited.
    // Lifecycle is tied to the caller scope via ensure(destroyScope).
    const [agentScope, destroyScope] = createScope();
    yield* ensure(destroyScope);

    // Start the server loop inside the isolated scope.
    agentScope.run(function* () {
      yield* server.use({
        *receive() {
          return hostSub;
        },
        *send(msg) {
          yield* agentToHost.send(msg);
        },
      });
      yield* agentToHost.close();
    });

    return {
      *send(message: HostMessage) {
        yield* hostToAgent.send(message);
      },
      receive: agentToHost,
    };
  };
}
