import type { Operation } from "effection";
import type { AgentDeclaration, OperationSpec } from "@tisyn/agent";
import type { AgentTransportFactory } from "./transport.js";
import { installRemoteAgent } from "./install-remote.js";

/**
 * Bind a remote agent to the current scope via a transport factory.
 *
 * Installs Effects middleware that routes matching effects through the
 * transport session and registers the agent as bound via the resolve
 * middleware. The transport connection lifetime is scoped to the
 * current Effection scope.
 */
export function* useTransport<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  factory: AgentTransportFactory,
): Operation<void> {
  yield* installRemoteAgent(declaration, factory);
}
