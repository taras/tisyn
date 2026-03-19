/**
 * Agent registry — maps agent IDs to in-process handlers.
 *
 * See Agent Specification §2 and Architecture §9.
 *
 * Each agent has a unique ID and handles named operations.
 * The registry dispatches effects by parsing the dotted effect ID
 * and routing to the appropriate agent.
 */

import type { Operation } from "effection";
import { type Val, parseEffectId } from "@tisyn/shared";

/**
 * An agent handler receives an operation name and arguments,
 * and returns a result value.
 */
export type AgentHandler = (operation: string, args: Val) => Operation<Val>;

/**
 * Registry of in-process agents.
 *
 * Dispatch parses dotted effect IDs:
 *   "order-service.fetchOrder" → agent "order-service", operation "fetchOrder"
 */
export class AgentRegistry {
  private agents = new Map<string, AgentHandler>();

  /** Register an agent handler by ID. */
  register(agentId: string, handler: AgentHandler): void {
    this.agents.set(agentId, handler);
  }

  /**
   * Dispatch an effect to the appropriate agent.
   *
   * Parses the effect ID, looks up the agent, and calls its handler.
   * Throws if no agent is registered for the effect's type.
   */
  *dispatch(effectId: string, data: Val): Operation<Val> {
    const { type, name } = parseEffectId(effectId);
    const handler = this.agents.get(type);
    if (!handler) {
      throw new Error(`No agent registered for type: ${type}`);
    }
    return yield* handler(name, data);
  }
}
