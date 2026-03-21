import { describe, it, expect } from "vitest";
import type {
  InitializeRequest,
  InitializeResponse,
  ExecuteRequest,
  ExecuteResponse,
  ExecuteProtocolError,
  ProgressNotification,
  CancelNotification,
  ShutdownNotification,
} from "./types.js";
import { ProtocolErrorCode } from "./types.js";

describe("Protocol v1 message shapes", () => {
  it("initialize request includes agentId, protocolVersion, and capabilities", () => {
    const msg: InitializeRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "1.0",
        agentId: "fraud-detector",
        capabilities: {
          methods: ["fraudCheck", "riskScore"],
          progress: true,
          concurrency: 10,
        },
      },
    };

    expect(msg.method).toBe("initialize");
    expect(msg.params.agentId).toBe("fraud-detector");
    expect(msg.params.protocolVersion).toBe("1.0");
    expect(msg.params.capabilities.methods).toEqual(["fraudCheck", "riskScore"]);
    expect(msg.params.capabilities.progress).toBe(true);
    expect(msg.params.capabilities.concurrency).toBe(10);
  });

  it("initialize response includes negotiated protocolVersion and sessionId", () => {
    const msg: InitializeResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "1.0",
        sessionId: "sess-abc-123",
      },
    };

    expect(msg.result.protocolVersion).toBe("1.0");
    expect(msg.result.sessionId).toBe("sess-abc-123");
  });

  it("execute request includes correlation ID, executionId, taskId, operation, args", () => {
    const msg: ExecuteRequest = {
      jsonrpc: "2.0",
      id: "root.0:2",
      method: "execute",
      params: {
        executionId: "ex-abc-123",
        taskId: "root.0",
        operation: "fraudCheck",
        args: [{ id: "order-123", total: 150 }],
        progressToken: "root.0:2",
        deadline: "2026-03-19T12:05:00Z",
      },
    };

    expect(msg.method).toBe("execute");
    expect(typeof msg.id).toBe("string");
    expect(msg.params.executionId).toBe("ex-abc-123");
    expect(msg.params.taskId).toBe("root.0");
    expect(msg.params.operation).toBe("fraudCheck");
    expect(msg.params.args).toEqual([{ id: "order-123", total: 150 }]);
    expect(msg.params.progressToken).toBe("root.0:2");
    expect(msg.params.deadline).toBe("2026-03-19T12:05:00Z");
  });

  it("execute success response encodes ok: true with value", () => {
    const msg: ExecuteResponse = {
      jsonrpc: "2.0",
      id: "root.0:2",
      result: {
        ok: true,
        value: { orderId: "order-1", status: "approved" },
      },
    };

    expect(msg.result.ok).toBe(true);
    expect(msg.result).toHaveProperty("value");
    if (msg.result.ok) {
      expect(msg.result.value).toEqual({ orderId: "order-1", status: "approved" });
    }
  });

  it("execute application-error response encodes ok: false with error", () => {
    const msg: ExecuteResponse = {
      jsonrpc: "2.0",
      id: "root.0:2",
      result: {
        ok: false,
        error: {
          message: "service unavailable",
          name: "ServiceError",
        },
      },
    };

    expect(msg.result.ok).toBe(false);
    if (!msg.result.ok) {
      expect(msg.result.error.message).toBe("service unavailable");
      expect(msg.result.error.name).toBe("ServiceError");
    }
  });

  it("protocol error uses JSON-RPC error field, not result", () => {
    const msg: ExecuteProtocolError = {
      jsonrpc: "2.0",
      id: "root.0:2",
      error: {
        code: ProtocolErrorCode.MethodNotFound,
        message: "Unknown operation: fraudCheck",
      },
    };

    expect(msg.error.code).toBe(-32601);
    expect(msg.error.message).toBeTruthy();
    expect(msg).not.toHaveProperty("result");
  });

  it("cancel notification is a JSON-RPC notification with correlation ID", () => {
    const msg: CancelNotification = {
      jsonrpc: "2.0",
      method: "cancel",
      params: {
        id: "root.0:2",
        reason: "parent_cancelled",
      },
    };

    expect(msg.method).toBe("cancel");
    expect(msg).not.toHaveProperty("id");
    expect(msg.params.id).toBe("root.0:2");
    expect(msg.params.reason).toBe("parent_cancelled");
  });

  it("progress notification includes token and value", () => {
    const msg: ProgressNotification = {
      jsonrpc: "2.0",
      method: "progress",
      params: {
        token: "root.0:2",
        value: { phase: "analyzing", percent: 45 },
      },
    };

    expect(msg.method).toBe("progress");
    expect(msg).not.toHaveProperty("id");
    expect(msg.params.token).toBe("root.0:2");
    expect(msg.params.value).toEqual({ phase: "analyzing", percent: 45 });
  });

  it("shutdown notification has empty params", () => {
    const msg: ShutdownNotification = {
      jsonrpc: "2.0",
      method: "shutdown",
      params: {},
    };

    expect(msg.method).toBe("shutdown");
    expect(msg).not.toHaveProperty("id");
    expect(msg.params).toEqual({});
  });

  it("all message types survive JSON roundtrip", () => {
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "1.0",
          agentId: "test-agent",
          capabilities: { methods: ["op1"], progress: false, concurrency: 1 },
        },
      },
      {
        jsonrpc: "2.0",
        id: "root:0",
        method: "execute",
        params: {
          executionId: "ex-1",
          taskId: "root",
          operation: "op1",
          args: [42, "hello", null, true, [1, 2], { nested: "obj" }],
        },
      },
      {
        jsonrpc: "2.0",
        id: "root:0",
        result: { ok: true, value: { answer: 42 } },
      },
      {
        jsonrpc: "2.0",
        id: "root:0",
        result: { ok: false, error: { message: "boom", name: "TestError" } },
      },
      {
        jsonrpc: "2.0",
        method: "progress",
        params: { token: "root:0", value: { percent: 50 } },
      },
      {
        jsonrpc: "2.0",
        method: "cancel",
        params: { id: "root:0", reason: "timeout" },
      },
      {
        jsonrpc: "2.0",
        method: "shutdown",
        params: {},
      },
    ];

    for (const msg of messages) {
      expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
    }
  });
});
