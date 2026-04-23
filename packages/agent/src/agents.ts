import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import type { AgentDeclaration, ImplementationHandlers, OperationSpec } from "./types.js";
import { parseEffectId } from "@tisyn/kernel";
import { Effects, runAsTerminal } from "@tisyn/effects";
import { DispatchContext } from "@tisyn/effects/internal";

/**
 * Local binding primitive.
 *
 * Installs Effects.around() dispatch and resolve middleware for the
 * given agent declaration using the provided handlers. After this
 * call, `useAgent(declaration)` will succeed and dispatches matching
 * the agent's operations will be routed to the handlers.
 */
function* use<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
): Operation<void> {
  const { id } = declaration;

  yield* Effects.around({
    *dispatch([effectId, data]: [string, Val], next) {
      const { type, name } = parseEffectId(effectId);
      if (type === id) {
        const handler = (handlers as Record<string, (args: Val) => Operation<Val>>)[name];
        if (!handler) {
          throw new Error(`Agent "${id}" has no handler for operation: ${name}`);
        }
        // Terminal delegation per scoped-effects §9.5: under replay, the
        // runtime terminal boundary substitutes stored results in place of
        // re-invoking the handler.
        return yield* runAsTerminal(effectId, data, () =>
          DispatchContext.with(undefined, () => handler(data)),
        );
      }
      return yield* next(effectId, data);
    },
    *resolve([agentId]: [string], next) {
      if (agentId === id) {
        return true;
      }
      return yield* next(agentId);
    },
  });
}

export const Agents = { use };
