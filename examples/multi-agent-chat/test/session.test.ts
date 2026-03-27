/**
 * BrowserSessionManager hydration tests.
 *
 * Verifies that history accumulates correctly during live turns so that
 * reconnecting owners and non-owner clients receive current transcripts.
 */

import { EventEmitter } from "node:events";
import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
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

function getHydrate(
  ws: FakeWs,
): { type: "hydrateTranscript"; messages: Array<{ role: string; content: string }> } | undefined {
  return ws.messages.find((m) => m.type === "hydrateTranscript") as
    | { type: "hydrateTranscript"; messages: Array<{ role: string; content: string }> }
    | undefined;
}

describe("BrowserSessionManager transcript hydration", () => {
  it("non-owner client receives current transcript after a completed turn", function* () {
    const session = new BrowserSessionManager([]);

    // Attach owner
    const ownerWs = new FakeWs();
    session.attach("owner", asFakeWs(ownerWs));

    // Set pendingPrompt so handleMessage will save the user message.
    // We call waitForUser() without yielding — it sets this.pendingPrompt.
    session.waitForUser("What do you want?");

    // Simulate user message arriving on the owner socket
    ownerWs.emit("message", JSON.stringify({ type: "userMessage", message: "hello" }));

    // Workflow receives the reply and calls showAssistantMessage —
    // this should flush the complete pair to this.history.
    session.showAssistantMessage("world");

    // Attach a non-owner socket (different clientSessionId)
    const nonOwnerWs = new FakeWs();
    session.attach("observer", asFakeWs(nonOwnerWs));

    const hydrate = getHydrate(nonOwnerWs);
    expect(hydrate).toBeDefined();
    expect(hydrate!.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
  });

  it("owner reconnect receives current transcript after a completed turn", function* () {
    const session = new BrowserSessionManager([]);

    // First owner connection
    const ownerWs1 = new FakeWs();
    session.attach("owner", asFakeWs(ownerWs1));

    session.waitForUser("What do you want?");
    ownerWs1.emit("message", JSON.stringify({ type: "userMessage", message: "ping" }));
    session.showAssistantMessage("pong");

    // Simulate owner reconnect with a fresh socket (same clientSessionId)
    const ownerWs2 = new FakeWs();
    session.attach("owner", asFakeWs(ownerWs2));

    const hydrate = getHydrate(ownerWs2);
    expect(hydrate).toBeDefined();
    expect(hydrate!.messages).toEqual([
      { role: "user", content: "ping" },
      { role: "assistant", content: "pong" },
    ]);
  });
});
