import { describe, it, expect } from "vitest";
import { parseHostMessage, parseAgentMessage } from "./parse.js";
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

describe("parseHostMessage", () => {
  it("accepts valid initialize request", () => {
    const msg = initializeRequest(1, {
      protocolVersion: "1.0",
      agentId: "test",
      capabilities: { methods: ["op1"] },
    });
    expect(parseHostMessage(msg)).toEqual(msg);
  });

  it("accepts valid execute request", () => {
    const msg = executeRequest("req-1", {
      executionId: "ex-1",
      taskId: "root",
      operation: "double",
      args: [{ value: 21 }],
    });
    expect(parseHostMessage(msg)).toEqual(msg);
  });

  it("accepts valid cancel notification", () => {
    const msg = cancelNotification("req-1", "timeout");
    expect(parseHostMessage(msg)).toEqual(msg);
  });

  it("accepts valid shutdown notification", () => {
    const msg = shutdownNotification();
    expect(parseHostMessage(msg)).toEqual(msg);
  });

  it("throws on invalid input", () => {
    expect(() => parseHostMessage({ foo: "bar" })).toThrow("Invalid HostMessage");
  });

  it("throws on null", () => {
    expect(() => parseHostMessage(null)).toThrow("Invalid HostMessage");
  });

  it("throws on missing jsonrpc field", () => {
    expect(() => parseHostMessage({ method: "shutdown", params: {} })).toThrow(
      "Invalid HostMessage",
    );
  });
});

describe("parseAgentMessage", () => {
  it("accepts valid initialize response", () => {
    const msg = initializeResponse(1, {
      protocolVersion: "1.0",
      sessionId: "sess-1",
    });
    expect(parseAgentMessage(msg)).toEqual(msg);
  });

  it("accepts valid initialize protocol error", () => {
    const msg = initializeProtocolError(1, {
      code: ProtocolErrorCode.IncompatibleVersion,
      message: "bad",
    });
    expect(parseAgentMessage(msg)).toEqual(msg);
  });

  it("accepts valid execute success", () => {
    const msg = executeSuccess("req-1", 42);
    expect(parseAgentMessage(msg)).toEqual(msg);
  });

  it("accepts valid execute application error", () => {
    const msg = executeApplicationError("req-1", {
      message: "kaboom",
    });
    expect(parseAgentMessage(msg)).toEqual(msg);
  });

  it("accepts valid execute protocol error", () => {
    const msg = executeProtocolError("req-1", {
      code: ProtocolErrorCode.MethodNotFound,
      message: "not found",
    });
    expect(parseAgentMessage(msg)).toEqual(msg);
  });

  it("accepts valid progress notification", () => {
    const msg = progressNotification("token-1", { percent: 50 });
    expect(parseAgentMessage(msg)).toEqual(msg);
  });

  it("throws on invalid input", () => {
    expect(() => parseAgentMessage("not an object")).toThrow("Invalid AgentMessage");
  });

  it("roundtrips through JSON", () => {
    const msg = executeSuccess("req-1", { nested: [1, "two", null] });
    const roundtripped = JSON.parse(JSON.stringify(msg));
    expect(parseAgentMessage(roundtripped)).toEqual(msg);
  });
});
