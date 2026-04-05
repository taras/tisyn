import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import type {
  AgentDeclaration,
  AgentImplementation,
  ImplementationHandlers,
  OperationSpec,
} from "./types.js";
import { parseEffectId } from "@tisyn/kernel";
import { Effects } from "./dispatch.js";

/**
 * Bind implementations to an agent declaration.
 *
 * The returned object can be installed as dispatch middleware
 * via `yield* impl.install()`.
 */
export function implementAgent<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
): AgentImplementation<Ops> {
  const { id } = declaration;

  return {
    id,
    handlers,
    *install() {
      yield* Effects.around({
        *dispatch([effectId, data]: [string, Val], next) {
          const { type, name } = parseEffectId(effectId);
          if (type === id) {
            const handler = (handlers as Record<string, (args: Val) => Operation<Val>>)[name];
            if (!handler) {
              throw new Error(`Agent "${id}" has no handler for operation: ${name}`);
            }
            return yield* handler(data);
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
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    *call(name: string, args: any): Operation<any> {
      const handler = (handlers as Record<string, (args: Val) => Operation<Val>>)[name];
      if (!handler) {
        throw new Error(`Agent "${id}" has no handler for operation: ${name}`);
      }
      return yield* handler(args);
    },
  };
}
