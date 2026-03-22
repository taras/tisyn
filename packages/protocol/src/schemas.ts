import { Type, type TSchema } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 base
// ---------------------------------------------------------------------------

const JsonRpc = Type.Literal("2.0");
const Id = Type.Union([Type.String(), Type.Number()]);
const StringId = Type.String();

const JsonRpcError = Type.Object({
  code: Type.Number(),
  message: Type.String(),
});

// ---------------------------------------------------------------------------
// Val — recursive JSON value (mirrors @tisyn/ir Val)
// ---------------------------------------------------------------------------

const Val: TSchema = Type.Recursive((Self) =>
  Type.Union([
    Type.String(),
    Type.Number(),
    Type.Boolean(),
    Type.Null(),
    Type.Array(Self),
    Type.Record(Type.String(), Self),
  ]),
);

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

const AgentCapabilities = Type.Object({
  methods: Type.Array(Type.String()),
  progress: Type.Optional(Type.Boolean()),
  concurrency: Type.Optional(Type.Number()),
});

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

export const InitializeRequestSchema = Type.Object({
  jsonrpc: JsonRpc,
  id: Id,
  method: Type.Literal("initialize"),
  params: Type.Object({
    protocolVersion: Type.String(),
    agentId: Type.String(),
    capabilities: AgentCapabilities,
  }),
});

export const InitializeResponseSchema = Type.Object({
  jsonrpc: JsonRpc,
  id: Id,
  result: Type.Object({
    protocolVersion: Type.String(),
    sessionId: Type.String(),
  }),
});

export const InitializeProtocolErrorSchema = Type.Object({
  jsonrpc: JsonRpc,
  id: Id,
  error: JsonRpcError,
});

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export const ExecuteRequestSchema = Type.Object({
  jsonrpc: JsonRpc,
  id: StringId,
  method: Type.Literal("execute"),
  params: Type.Object({
    executionId: Type.String(),
    taskId: Type.String(),
    operation: Type.String(),
    args: Type.Array(Val),
    progressToken: Type.Optional(Type.String()),
    deadline: Type.Optional(Type.String()),
  }),
});

const ResultSuccess = Type.Object({
  ok: Type.Literal(true),
  value: Val,
});

const ResultApplicationError = Type.Object({
  ok: Type.Literal(false),
  error: Type.Object({
    message: Type.String(),
    name: Type.Optional(Type.String()),
  }),
});

const ResultPayload = Type.Union([ResultSuccess, ResultApplicationError]);

export const ExecuteResponseSchema = Type.Object({
  jsonrpc: JsonRpc,
  id: StringId,
  result: ResultPayload,
});

export const ExecuteProtocolErrorSchema = Type.Object({
  jsonrpc: JsonRpc,
  id: StringId,
  error: JsonRpcError,
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const ProgressNotificationSchema = Type.Object({
  jsonrpc: JsonRpc,
  method: Type.Literal("progress"),
  params: Type.Object({
    token: Type.String(),
    value: Val,
  }),
});

export const CancelNotificationSchema = Type.Object({
  jsonrpc: JsonRpc,
  method: Type.Literal("cancel"),
  params: Type.Object({
    id: Type.String(),
    reason: Type.Optional(Type.String()),
  }),
});

export const ShutdownNotificationSchema = Type.Object({
  jsonrpc: JsonRpc,
  method: Type.Literal("shutdown"),
  params: Type.Object({}),
});

// ---------------------------------------------------------------------------
// Unions
// ---------------------------------------------------------------------------

export const HostMessageSchema = Type.Union([
  InitializeRequestSchema,
  ExecuteRequestSchema,
  CancelNotificationSchema,
  ShutdownNotificationSchema,
]);

export const AgentMessageSchema = Type.Union([
  InitializeResponseSchema,
  InitializeProtocolErrorSchema,
  ExecuteResponseSchema,
  ExecuteProtocolErrorSchema,
  ProgressNotificationSchema,
]);
