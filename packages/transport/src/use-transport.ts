import type { Operation } from "effection";
import type { AgentDeclaration, OperationSpec } from "@tisyn/agent";
import { BoundAgentsContext } from "@tisyn/agent";
import type { AgentTransportFactory } from "./transport.js";
import { installRemoteAgent } from "./install-remote.js";

/**
 * Bind a remote agent to the current scope via a transport factory.
 *
 * Registers the agent ID in the scope-local bound-agents registry and
 * installs Effects middleware that routes matching effects through the
 * transport session. The transport connection lifetime is scoped to the
 * current Effection scope.
 */
export function* useTransport<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  factory: AgentTransportFactory,
): Operation<void> {
  const current = yield* BoundAgentsContext.expect();
  const next = new Set(current);
  next.add(declaration.id);
  yield* BoundAgentsContext.set(next);

  yield* installRemoteAgent(declaration, factory);
}
