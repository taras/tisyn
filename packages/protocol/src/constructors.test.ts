import { describe, it, expect } from "vitest";
import {
  initializeRequest,
  initializeResponse,
  initializeProtocolError,
  executeRequest,
  executeSuccess,
  executeApplicationError,
  executeProtocolError,
  progressNotification,
  cancelNotification,
  shutdownNotification,
} from "./constructors.js";
import { ProtocolErrorCode } from "./types.js";

describe("Protocol constructors", () => {
  it("initializeRequest", () => {
    const msg = initializeRequest(1, {
      protocolVersion: "1.0",
      agentId: "test",
      capabilities: { methods: ["op1"] },
    });
    expect(msg).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "1.0",
        agentId: "test",
        capabilities: { methods: ["op1"] },
      },
    });
  });

  it("initializeResponse", () => {
    const msg = initializeResponse(1, {
      protocolVersion: "1.0",
      sessionId: "sess-1",
    });
    expect(msg).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "1.0", sessionId: "sess-1" },
    });
  });

  it("initializeProtocolError", () => {
    const msg = initializeProtocolError(1, {
      code: ProtocolErrorCode.IncompatibleVersion,
      message: "bad version",
    });
    expect(msg.error.code).toBe(-32002);
  });

  it("executeRequest", () => {
    const msg = executeRequest("req-1", {
      executionId: "ex-1",
      taskId: "root",
      operation: "double",
      args: [{ value: 21 }],
    });
    expect(msg.method).toBe("execute");
    expect(msg.id).toBe("req-1");
    expect(msg.params.operation).toBe("double");
  });

  it("executeSuccess", () => {
    const msg = executeSuccess("req-1", 42);
    expect(msg.result).toEqual({ ok: true, value: 42 });
  });

  it("executeApplicationError", () => {
    const msg = executeApplicationError("req-1", {
      message: "kaboom",
      name: "TestError",
    });
    expect(msg.result).toEqual({
      ok: false,
      error: { message: "kaboom", name: "TestError" },
    });
  });

  it("executeProtocolError", () => {
    const msg = executeProtocolError("req-1", {
      code: ProtocolErrorCode.MethodNotFound,
      message: "not found",
    });
    expect(msg.error.code).toBe(-32601);
  });

  it("progressNotification", () => {
    const msg = progressNotification("token-1", { percent: 50 });
    expect(msg.method).toBe("progress");
    expect(msg.params).toEqual({ token: "token-1", value: { percent: 50 } });
  });

  it("cancelNotification with reason", () => {
    const msg = cancelNotification("req-1", "timeout");
    expect(msg.params).toEqual({ id: "req-1", reason: "timeout" });
  });

  it("cancelNotification without reason", () => {
    const msg = cancelNotification("req-1");
    expect(msg.params).toEqual({ id: "req-1" });
    expect(msg.params).not.toHaveProperty("reason");
  });

  it("shutdownNotification", () => {
    const msg = shutdownNotification();
    expect(msg).toEqual({ jsonrpc: "2.0", method: "shutdown", params: {} });
  });
});
