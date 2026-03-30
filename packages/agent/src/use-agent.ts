import { type Operation, createContext, useScope } from "effection";
import type { Val } from "@tisyn/ir";
import type { AgentDeclaration, OperationSpec, ArgsOf, ResultOf } from "./types.js";
import { dispatch } from "./dispatch.js";

/** A typed handle for an already-bound agent — each method dispatches via `dispatch()`. */
export type AgentHandle<Ops extends Record<string, OperationSpec>> = {
  [K in keyof Ops]: (args: ArgsOf<Ops[K]>) => Operation<ResultOf<Ops[K]>>;
};

/**
 * Scope-local registry of bound agent IDs.
 * Set by `useTransport()`; read by `useAgent()`.
 */
export const BoundAgentsContext = createContext<Set<string> | null>("$bound-agents", null);

/**
 * Get a typed handle for an agent that was previously bound via `useTransport()`.
 * Throws a descriptive error if the agent is not bound in the current scope.
 */
export function* useAgent<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
): Operation<AgentHandle<Ops>> {
  const scope = yield* useScope();
  const bound = scope.get(BoundAgentsContext) ?? null;

  if (!bound?.has(declaration.id)) {
    throw new Error(
      `Agent '${declaration.id}' is not bound in the current scope. Call useTransport() to bind it first.`,
    );
  }

  const handle = {} as AgentHandle<Ops>;
  for (const name of Object.keys(declaration.operations) as (keyof Ops & string)[]) {
    (handle as any)[name] = (args: unknown): Operation<unknown> =>
      dispatch(`${declaration.id}.${name}`, args as Val);
  }
  return handle;
}
