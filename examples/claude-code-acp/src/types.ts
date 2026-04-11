/**
 * Agent contract types for the Claude Code ACP integration.
 *
 * These are the serializable data shapes exchanged between the
 * authored workflow and the Claude Code agent.
 */

export interface SessionHandle {
  sessionId: string;
}

export interface PlanResult {
  response: string;
  toolResults?: Array<{ tool: string; output: unknown }>;
}

export interface ForkData {
  parentSessionId: string;
  forkId: string;
}
