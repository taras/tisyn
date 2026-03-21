import type { Val } from "@tisyn/ir";

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 base envelopes
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number;
  error: JsonRpcError;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface JsonRpcError {
  code: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface AgentCapabilities {
  methods: string[];
  progress?: boolean;
  concurrency?: number;
}

// ---------------------------------------------------------------------------
// Initialize (agent → host)
// ---------------------------------------------------------------------------

export interface InitializeRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: "initialize";
  params: {
    protocolVersion: string;
    agentId: string;
    capabilities: AgentCapabilities;
  };
}

export interface InitializeResponse {
  jsonrpc: "2.0";
  id: string | number;
  result: {
    protocolVersion: string;
    sessionId: string;
  };
}

export interface InitializeProtocolError {
  jsonrpc: "2.0";
  id: string | number;
  error: JsonRpcError;
}

// ---------------------------------------------------------------------------
// Execute (host → agent) and Result (agent → host)
// ---------------------------------------------------------------------------

export interface ExecuteRequest {
  jsonrpc: "2.0";
  id: string;
  method: "execute";
  params: {
    executionId: string;
    taskId: string;
    operation: string;
    args: Val[];
    progressToken?: string;
    deadline?: string;
  };
}

export interface ResultSuccess {
  ok: true;
  value: Val;
}

export interface ApplicationError {
  message: string;
  name?: string;
}

export interface ResultApplicationError {
  ok: false;
  error: ApplicationError;
}

export type ResultPayload = ResultSuccess | ResultApplicationError;

export interface ExecuteResponse {
  jsonrpc: "2.0";
  id: string;
  result: ResultPayload;
}

export interface ExecuteProtocolError {
  jsonrpc: "2.0";
  id: string;
  error: JsonRpcError;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface ProgressNotification {
  jsonrpc: "2.0";
  method: "progress";
  params: {
    token: string;
    value: Val;
  };
}

export interface CancelNotification {
  jsonrpc: "2.0";
  method: "cancel";
  params: {
    id: string;
    reason?: string;
  };
}

export interface ShutdownNotification {
  jsonrpc: "2.0";
  method: "shutdown";
  params: Record<string, never>;
}

// ---------------------------------------------------------------------------
// Protocol error codes
// ---------------------------------------------------------------------------

export const ProtocolErrorCode = {
  MethodNotFound: -32601,
  ConcurrencyExceeded: -32003,
  IncompatibleVersion: -32002,
  ParseError: -32700,
  InvalidRequest: -32600,
  InternalError: -32603,
} as const;
