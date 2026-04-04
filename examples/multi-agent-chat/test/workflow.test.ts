/**
 * Compiled workflow with local agents — no transports.
 *
 * Three agents: App (browser), Llm (echo), DB (persistence).
 * History is managed locally via SSA let + reassignment.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, withResolvers } from "effection";
import { implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { Call } from "@tisyn/ir";
import { App, Llm, DB, chat } from "../src/workflow.generated.js";

describe("Compiled workflow", () => {
  it("runs the chat loop: load → elicit → sample → persist → display, with history accumulation", function* () {
    // Track agent interactions
    const elicitCalls: Array<{ input: { message: string } }> = [];
    const sampleCalls: Array<{
      input: {
        history: Array<{ role: string; content: string }>;
        message: string;
      };
    }> = [];
    const showCalls: Array<{ input: { message: string } }> = [];
    const loadChatCalls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const loadMessagesCalls: Array<unknown> = [];
    const appendMessageCalls: Array<{ input: { role: string; content: string } }> = [];

    // Canned user messages — after these, the agent throws to exit the loop
    const userMessages = ["hello", "how are you?"];
    let userMessageIndex = 0;

    const done = withResolvers<void>();

    // Install local App agent
    const browserImpl = implementAgent(App(), {
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
    yield* browserImpl.install();

    // Install local LLM agent (echo stub)
    const llmImpl = implementAgent(Llm(), {
      *sample(args) {
        sampleCalls.push(args);
        return { message: `Echo: ${args.input.message}` };
      },
    });
    yield* llmImpl.install();

    // Install local DB agent (in-memory stub)
    const dbImpl = implementAgent(DB(), {
      *loadMessages(args) {
        loadMessagesCalls.push(args);
        return [];
      },
      *appendMessage(args) {
        appendMessageCalls.push(args);
      },
    });
    yield* dbImpl.install();

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
    expect(loadChatCalls[0]!.messages).toEqual([]);

    // Two full cycles completed + one elicit that throws
    expect(elicitCalls).toHaveLength(3); // 2 successful + 1 that throws
    expect(sampleCalls).toHaveLength(2);
    expect(showCalls).toHaveLength(2);

    // 4 appendMessage calls: user+assistant for each cycle
    expect(appendMessageCalls).toHaveLength(4);
    expect(appendMessageCalls[0]!.input).toEqual({ role: "user", content: "hello" });
    expect(appendMessageCalls[1]!.input).toEqual({ role: "assistant", content: "Echo: hello" });
    expect(appendMessageCalls[2]!.input).toEqual({ role: "user", content: "how are you?" });
    expect(appendMessageCalls[3]!.input).toEqual({
      role: "assistant",
      content: "Echo: how are you?",
    });

    // Cycle 1: contextForSampling includes the current user message
    expect(sampleCalls[0]!.input.history).toEqual([{ role: "user", content: "hello" }]);
    expect(sampleCalls[0]!.input.message).toBe("hello");
    expect(showCalls[0]!.input.message).toBe("Echo: hello");

    // Cycle 2: contextForSampling has prior history + current user message
    expect(sampleCalls[1]!.input.history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Echo: hello" },
      { role: "user", content: "how are you?" },
    ]);
    expect(sampleCalls[1]!.input.message).toBe("how are you?");
    expect(showCalls[1]!.input.message).toBe("Echo: how are you?");
  });
});
