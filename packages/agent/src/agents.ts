import type { Operation } from "effection";
import type { AgentDeclaration, AgentImplementation, OperationSpec } from "./types.js";

/**
 * Local binding primitive.
 *
 * Installs the agent implementation as Effects.around() dispatch and
 * resolve middleware. After this call, `useAgent(declaration)` will
 * succeed and dispatches matching the agent's operations will be
 * routed to the implementation handlers.
 */
function* use<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  impl: AgentImplementation<Ops>,
): Operation<void> {
  yield* impl.install();
}

export const Agents = { use };
