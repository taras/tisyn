/**
 * Shared types for the Claude Code ACP transport binding.
 *
 * These are the serializable data shapes used in the agent contract
 * and protocol translation layer.
 */

// ── Agent contract types (plain serializable data) ──

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

// ── ACP protocol message types ──

/**
 * ACP JSON-RPC request (host → ACP process).
 * These are the messages sent to the Claude Code ACP stdio process.
 */
export interface AcpRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/**
 * ACP JSON-RPC success response (ACP process → host).
 */
export interface AcpSuccessResponse {
  jsonrpc: "2.0";
  id: string;
  result: unknown;
}

/**
 * ACP JSON-RPC error response (ACP process → host).
 */
export interface AcpErrorResponse {
  jsonrpc: "2.0";
  id: string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * ACP JSON-RPC notification (ACP process → host).
 * Used for streaming progress (partial text, tool calls).
 */
export interface AcpNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

export type AcpResponse = AcpSuccessResponse | AcpErrorResponse;
export type AcpMessage = AcpResponse | AcpNotification;
