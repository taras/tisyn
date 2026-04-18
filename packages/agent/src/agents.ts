import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import type { AgentDeclaration, ImplementationHandlers, OperationSpec } from "./types.js";
import { parseEffectId } from "@tisyn/kernel";
import { DispatchContext, Effects } from "./dispatch.js";

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
        return yield* DispatchContext.with(undefined, () => handler(data));
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
