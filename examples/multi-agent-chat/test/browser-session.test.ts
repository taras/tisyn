/**
 * BrowserSessionManager — reconnect semantics.
 *
 * Tests the session manager directly without running the full workflow.
 * Verifies: elicit suspension, reconnect continuation, identity-safe
 * detach, non-owner read-only, render projection during disconnect.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, withResolvers } from "effection";
import type { Operation } from "effection";
import { BrowserSessionManager } from "../src/browser-session.js";
import { EventEmitter } from "node:events";

/** Minimal mock WebSocket for testing. */
function createMockWs() {
  const emitter = new EventEmitter();
  const sent: unknown[] = [];
  let closed = false;

  return {
    send(data: string) {
      sent.push(JSON.parse(data));
    },
    close() {
      if (!closed) {
        closed = true;
        emitter.emit("close");
      }
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      emitter.on(event, listener);
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      emitter.off(event, listener);
    },
    injectMessage(msg: unknown) {
      emitter.emit("message", Buffer.from(JSON.stringify(msg)));
    },
    get sent() {
      return sent;
    },
    get closed() {
      return closed;
    },
  };
}

/** Yield a microtask to let withResolvers callbacks propagate. */
function nextTick(): Operation<void> {
  const { operation, resolve } = withResolvers<void>();
  queueMicrotask(() => resolve());
  return operation;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWs = any;

describe("Browser session manager", () => {
  it("elicit suspends until userMessage arrives", function* () {
    const session = new BrowserSessionManager();
    const ws = createMockWs();

    session.attach("session-1", ws as AnyWs);
    yield* session.waitForOwner();

    let result: { message: string } | undefined;
    yield* spawn(function* () {
      result = yield* session.elicit("Say something");
    });

    // Let the spawn start
    yield* nextTick();

    // Should have sent elicit to the browser
    const waitMsg = ws.sent.find((m: any) => m.type === "elicit");
    expect(waitMsg).toEqual({ type: "elicit", prompt: "Say something" });

    // Not yet resolved
    expect(result).toBeUndefined();

    // Simulate user input
    ws.injectMessage({ type: "userMessage", message: "hello" });
    yield* nextTick();

    expect(result).toEqual({ message: "hello" });
  });

  it("elicit survives disconnect and resumes on reconnect", function* () {
    const session = new BrowserSessionManager();
    const ws1 = createMockWs();

    session.attach("session-1", ws1 as AnyWs);
    yield* session.waitForOwner();

    let result: { message: string } | undefined;
    yield* spawn(function* () {
      result = yield* session.elicit("Say something");
    });
    yield* nextTick();

    // Disconnect
    session.detach(ws1 as AnyWs);
    expect(result).toBeUndefined();

    // Reconnect with same session ID
    const ws2 = createMockWs();
    session.attach("session-1", ws2 as AnyWs);

    const render = ws2.sent.find((m: any) => m.type === "renderTranscript");
    expect(render).toBeDefined();
    const reSentPrompt = ws2.sent.find((m: any) => m.type === "elicit");
    expect(reSentPrompt).toEqual({ type: "elicit", prompt: "Say something" });

    // Submit on new socket
    ws2.injectMessage({ type: "userMessage", message: "world" });
    yield* nextTick();

    expect(result).toEqual({ message: "world" });
  });

  it("renderTranscript during disconnect does not fail", function* () {
    const session = new BrowserSessionManager();
    const ws = createMockWs();

    session.attach("session-1", ws as AnyWs);
    yield* session.waitForOwner();

    session.detach(ws as AnyWs);

    // Should not throw
    session.renderTranscript([{ role: "assistant", content: "Echo: hello" }]);
  });

  it("second connect with same ID replaces old socket (identity-safe)", function* () {
    const session = new BrowserSessionManager();
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    session.attach("session-1", ws1 as AnyWs);
    yield* session.waitForOwner();

    session.attach("session-1", ws2 as AnyWs);

    expect(ws1.closed).toBe(true);

    const render = ws2.sent.find((m: any) => m.type === "renderTranscript");
    expect(render).toBeDefined();
  });

  it("non-owner gets read-only view", function* () {
    const transcript = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "Echo: hello" },
    ] as const;
    const session = new BrowserSessionManager([...transcript]);

    const ownerWs = createMockWs();
    session.attach("owner-1", ownerWs as AnyWs);
    yield* session.waitForOwner();

    const nonOwnerWs = createMockWs();
    session.attach("other-2", nonOwnerWs as AnyWs);

    expect(nonOwnerWs.sent.find((m: any) => m.type === "renderTranscript")).toEqual({
      type: "renderTranscript",
      messages: [...transcript],
    });

    expect(nonOwnerWs.sent.find((m: any) => m.type === "setReadOnly")).toEqual({
      type: "setReadOnly",
      reason: "Session owned by another browser",
    });
  });

  it("stale close from old socket does not clear new socket", function* () {
    const session = new BrowserSessionManager();
    const ws1 = createMockWs();

    session.attach("session-1", ws1 as AnyWs);
    yield* session.waitForOwner();

    let result: { message: string } | undefined;
    yield* spawn(function* () {
      result = yield* session.elicit("Prompt");
    });
    yield* nextTick();

    const ws2 = createMockWs();
    session.attach("session-1", ws2 as AnyWs);

    // ws1 was closed by attach — its close listener called detach(ws1),
    // which is a no-op because this.socket is now ws2

    const reSent = ws2.sent.find((m: any) => m.type === "elicit");
    expect(reSent).toEqual({ type: "elicit", prompt: "Prompt" });

    ws2.injectMessage({ type: "userMessage", message: "answer" });
    yield* nextTick();
    expect(result).toEqual({ message: "answer" });
  });
});
