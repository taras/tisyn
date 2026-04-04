/**
 * BrowserSessionManager hydration tests.
 *
 * Verifies that chatMessages accumulates correctly during live turns so that
 * reconnecting owners and non-owner clients receive current transcripts.
 */

import { EventEmitter } from "node:events";
import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { createSignal } from "effection";
import type { WebSocket } from "ws";
import { BrowserSessionManager } from "../src/browser-session.js";
import type { HostToBrowser } from "../src/browser-session.js";

/**
 * Minimal fake WebSocket with EventEmitter support so that attach()'s
 * ws.on("message", ...) listener can be triggered via emit().
 */
class FakeWs extends EventEmitter {
  public messages: HostToBrowser[] = [];
  send(data: string) {
    this.messages.push(JSON.parse(data) as HostToBrowser);
  }
  close() {}
}

function asFakeWs(ws: FakeWs): WebSocket {
  return ws as unknown as WebSocket;
}

function getLoadChat(
  ws: FakeWs,
): { type: "loadChat"; messages: Array<{ role: string; content: string }> } | undefined {
  return ws.messages.find((m) => m.type === "loadChat") as
    | { type: "loadChat"; messages: Array<{ role: string; content: string }> }
    | undefined;
}

describe("BrowserSessionManager transcript hydration", () => {
  it("non-owner client receives current transcript after a completed turn", function* () {
    const userInput = createSignal<string, never>();
    const session = new BrowserSessionManager(userInput);

    // Attach owner
    const ownerWs = new FakeWs();
    session.attach("owner", asFakeWs(ownerWs));

    // Set pending prompt so handleMessage will accept the user message
    session.beginElicit("What do you want?");

    // Simulate user message arriving on the owner socket
    ownerWs.emit("message", JSON.stringify({ type: "userMessage", message: "hello" }));

    // Workflow receives the reply and calls showAssistantMessage
    session.showAssistantMessage("world");

    // Attach a non-owner socket (different clientSessionId)
    const nonOwnerWs = new FakeWs();
    session.attach("observer", asFakeWs(nonOwnerWs));

    const loadChat = getLoadChat(nonOwnerWs);
    expect(loadChat).toBeDefined();
    expect(loadChat!.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
  });

  it("owner reconnect receives current transcript after a completed turn", function* () {
    const userInput = createSignal<string, never>();
    const session = new BrowserSessionManager(userInput);

    // First owner connection
    const ownerWs1 = new FakeWs();
    session.attach("owner", asFakeWs(ownerWs1));

    session.beginElicit("What do you want?");
    ownerWs1.emit("message", JSON.stringify({ type: "userMessage", message: "ping" }));
    session.showAssistantMessage("pong");

    // Simulate owner reconnect with a fresh socket (same clientSessionId)
    const ownerWs2 = new FakeWs();
    session.attach("owner", asFakeWs(ownerWs2));

    const loadChat = getLoadChat(ownerWs2);
    expect(loadChat).toBeDefined();
    expect(loadChat!.messages).toEqual([
      { role: "user", content: "ping" },
      { role: "assistant", content: "pong" },
    ]);
  });
});
