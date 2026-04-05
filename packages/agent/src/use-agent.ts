import type { Operation } from "effection";
import type { AgentDeclaration, OperationSpec } from "./types.js";
import type { AgentFacade } from "./facade.js";
import { getOrCreateAgentApi, buildFacade } from "./facade.js";
import { resolve } from "./dispatch.js";

/** @deprecated Use AgentFacade instead. */
export type AgentHandle<Ops extends Record<string, OperationSpec>> = AgentFacade<Ops>;

/**
 * Get a typed facade for an agent that was previously bound via
 * `Agents.use()` or `useTransport()`.
 *
 * The facade exposes one method per declared operation (each dispatching
 * through the per-agent Context API) plus `.around()` for installing
 * per-operation middleware.
 *
 * Multiple calls with the same declaration in the same scope share
 * middleware visibility — middleware installed via one reference is
 * visible to all.
 *
 * Throws a descriptive error if the agent is not bound in the current scope.
 * Binding is checked by querying the Effects routing middleware chain via
 * `Effects.resolve()`.
 */
export function* useAgent<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
): Operation<AgentFacade<Ops>> {
  const bound = yield* resolve(declaration.id);

  if (!bound) {
    throw new Error(
      `Agent '${declaration.id}' is not bound in the current scope. Call Agents.use() or useTransport() to bind it first.`,
    );
  }

  const api = yield* getOrCreateAgentApi(declaration);
  return buildFacade(api, declaration);
}
