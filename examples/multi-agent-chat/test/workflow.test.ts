/**
 * Compiled workflow with local agents — no transports.
 *
 * Three agents: App (browser), Llm (echo), DB (persistence).
 * History is managed locally via SSA let + reassignment.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, withResolvers } from "effection";
import { Agents } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { Call } from "@tisyn/ir";
import { App, Llm, DB, chat } from "../src/workflow.generated.js";

describe("Compiled workflow", () => {
  it("runs the chat loop: load → elicit → sample → persist → display, with history accumulation", function* () {
    // Track agent interactions
    const elicitCalls: Array<{ message: string }> = [];
    const sampleCalls: Array<{
      history: Array<{ role: string; content: string }>;
      message: string;
    }> = [];
    const showCalls: Array<{ message: string }> = [];
    const loadChatCalls: Array<Array<{ role: string; content: string }>> = [];
    const loadMessagesCalls: Array<unknown> = [];
    const appendMessageCalls: Array<{ role: string; content: string }> = [];

    // Canned user messages — after these, the agent throws to exit the loop
    const userMessages = ["hello", "how are you?"];
    let userMessageIndex = 0;

    const done = withResolvers<void>();

    // Install local App agent
    yield* Agents.use(App(), {
      *elicit(args) {
        elicitCalls.push(args);
        if (userMessageIndex >= userMessages.length) {
          // Signal completion and throw to exit the loop
          done.resolve();
          throw new Error("done");
        }
        return { message: userMessages[userMessageIndex++]! };
      },
      *showAssistantMessage(args) {
        showCalls.push(args);
      },
      *loadChat(args) {
        loadChatCalls.push(args);
      },
      *setReadOnly() {},
    });

    // Install local LLM agent (echo stub)
    yield* Agents.use(Llm(), {
      *sample(args) {
        sampleCalls.push(args);
        return { message: `Echo: ${args.message}` };
      },
    });

    // Install local DB agent (in-memory stub)
    yield* Agents.use(DB(), {
      *loadMessages(args) {
        loadMessagesCalls.push(args);
        return [];
      },
      *appendMessage(args) {
        appendMessageCalls.push(args);
      },
    });

    // Run the compiled workflow in a spawned task so we can cancel it
    const _task = yield* spawn(function* () {
      yield* execute({ ir: Call(chat) });
    });

    // Wait for the loop to complete (agent throws after canned messages)
    yield* done.operation;

    // --- Assertions ---

    // DB.loadMessages called once on startup
    expect(loadMessagesCalls).toHaveLength(1);

    // App.loadChat called once with empty array (fresh start)
    expect(loadChatCalls).toHaveLength(1);
    expect(loadChatCalls[0]).toEqual([]);

    // Two full cycles completed + one elicit that throws
    expect(elicitCalls).toHaveLength(3); // 2 successful + 1 that throws
    expect(sampleCalls).toHaveLength(2);
    expect(showCalls).toHaveLength(2);

    // 4 appendMessage calls: user+assistant for each cycle
    expect(appendMessageCalls).toHaveLength(4);
    expect(appendMessageCalls[0]).toEqual({ role: "user", content: "hello" });
    expect(appendMessageCalls[1]).toEqual({ role: "assistant", content: "Echo: hello" });
    expect(appendMessageCalls[2]).toEqual({ role: "user", content: "how are you?" });
    expect(appendMessageCalls[3]).toEqual({
      role: "assistant",
      content: "Echo: how are you?",
    });

    // Cycle 1: contextForSampling includes the current user message
    expect(sampleCalls[0]!.history).toEqual([{ role: "user", content: "hello" }]);
    expect(sampleCalls[0]!.message).toBe("hello");
    expect(showCalls[0]!.message).toBe("Echo: hello");

    // Cycle 2: contextForSampling has prior history + current user message
    expect(sampleCalls[1]!.history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Echo: hello" },
      { role: "user", content: "how are you?" },
    ]);
    expect(sampleCalls[1]!.message).toBe("how are you?");
    expect(showCalls[1]!.message).toBe("Echo: how are you?");
  });
});
