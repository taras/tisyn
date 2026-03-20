/**
 * Agent definition — declares an agent with named operation handlers.
 *
 * An agent wraps a set of operation handlers and can be installed
 * in-process or routed over a transport.
 */

import type { Operation } from "effection";
import type { Val } from "@tisyn/shared";
import { parseEffectId } from "@tisyn/shared";
import { Dispatch } from "./dispatch.js";
import type { Transport } from "./transport.js";

export type AgentHandler = (operation: string, args: Val) => Operation<Val>;

export interface AgentDefinition {
  /** The agent's unique identifier. */
  id: string;
  /** The agent's operation handler. */
  handler: AgentHandler;
  /** Install this agent in-process via Dispatch middleware. */
  install(): Operation<void>;
  /** Route this agent's effects over a transport via Dispatch middleware. */
  use(transport: Transport): Operation<void>;
  /** Serve this agent's handlers over a transport (agent side). */
  serve(transport: Transport): Operation<void>;
}

/**
 * Define an agent with a set of named operation handlers.
 *
 * @param id - The agent's unique identifier (matches the effect ID type prefix)
 * @param handlers - Map of operation name to handler function
 */
export function agent(
  id: string,
  handlers: Record<string, (...args: Val[]) => Operation<Val>>,
): AgentDefinition {
  const handler: AgentHandler = function* (operation, args) {
    const fn = handlers[operation];
    if (!fn) {
      throw new Error(`Agent "${id}" has no handler for operation: ${operation}`);
    }
    return yield* fn(args);
  };

  return {
    id,
    handler,
    *install() {
      yield* Dispatch.around({
        *dispatch([effectId, data], next) {
          const { type, name } = parseEffectId(effectId);
          if (type === id) {
            return yield* handler(name, data);
          }
          return yield* next(effectId, data);
        },
      });
    },
    *use(transport: Transport) {
      yield* Dispatch.around({
        *dispatch([effectId, data], next) {
          const { type, name } = parseEffectId(effectId);
          if (type === id) {
            return yield* transport.dispatch(name, data);
          }
          return yield* next(effectId, data);
        },
      });
    },
    *serve(_transport: Transport) {
      // TODO: listen for incoming Execute messages on the transport
      // and dispatch through this agent's handlers
      throw new Error("serve() not yet implemented");
    },
  };
}
