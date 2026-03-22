import type { Val } from "@tisyn/ir";
import type {
  InitializeRequest,
  InitializeResponse,
  InitializeProtocolError,
  ExecuteRequest,
  ExecuteResponse,
  ExecuteProtocolError,
  ProgressNotification,
  CancelNotification,
  ShutdownNotification,
  AgentCapabilities,
  JsonRpcError,
} from "./types.js";

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

export function initializeRequest(
  id: string | number,
  params: { protocolVersion: string; agentId: string; capabilities: AgentCapabilities },
): InitializeRequest {
  return { jsonrpc: "2.0", id, method: "initialize", params };
}

export function initializeResponse(
  id: string | number,
  result: { protocolVersion: string; sessionId: string },
): InitializeResponse {
  return { jsonrpc: "2.0", id, result };
}

export function initializeProtocolError(
  id: string | number,
  error: JsonRpcError,
): InitializeProtocolError {
  return { jsonrpc: "2.0", id, error };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export function executeRequest(id: string, params: ExecuteRequest["params"]): ExecuteRequest {
  return { jsonrpc: "2.0", id, method: "execute", params };
}

export function executeSuccess(id: string, value: Val): ExecuteResponse {
  return { jsonrpc: "2.0", id, result: { ok: true, value } };
}

export function executeApplicationError(
  id: string,
  error: { message: string; name?: string },
): ExecuteResponse {
  return { jsonrpc: "2.0", id, result: { ok: false, error } };
}

export function executeProtocolError(id: string, error: JsonRpcError): ExecuteProtocolError {
  return { jsonrpc: "2.0", id, error };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function progressNotification(token: string, value: Val): ProgressNotification {
  return { jsonrpc: "2.0", method: "progress", params: { token, value } };
}

export function cancelNotification(id: string, reason?: string): CancelNotification {
  return {
    jsonrpc: "2.0",
    method: "cancel",
    params: reason !== undefined ? { id, reason } : { id },
  };
}

export function shutdownNotification(): ShutdownNotification {
  return { jsonrpc: "2.0", method: "shutdown", params: {} };
}
