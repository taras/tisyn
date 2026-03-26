/**
 * Compiled workflow with local agents — no transports.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, withResolvers } from "effection";
import { implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { Call } from "@tisyn/ir";
import { Browser, Llm, State, chat } from "../src/workflow.generated.js";

describe("Compiled workflow", () => {
  it("runs the chat loop: elicit → sample → display, with history accumulation", function* () {
    // Track agent interactions
    const waitForUserCalls: Array<{ input: { prompt: string } }> = [];
    const sampleCalls: Array<{
      input: {
        history: Array<{ role: string; content: string }>;
        message: string;
      };
    }> = [];
    const recordTurnCalls: Array<{
      input: { userMessage: string; assistantMessage: string };
    }> = [];
    const showCalls: Array<{ input: { message: string } }> = [];

    // Conversation history (mutable state managed by State agent)
    const history: Array<{ role: string; content: string }> = [];

    // Canned user messages — after these, the agent throws to exit the loop
    const userMessages = ["hello", "how are you?"];
    let userMessageIndex = 0;

    const done = withResolvers<void>();

    // Install local Browser agent
    const browserImpl = implementAgent(Browser(), {
      *waitForUser(args) {
        waitForUserCalls.push(args);
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
      *hydrateTranscript() {},
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

    // Install local State agent (closure over mutable history)
    const stateImpl = implementAgent(State(), {
      *getHistory(_args) {
        return [...history];
      },
      *recordTurn(args) {
        recordTurnCalls.push(args);
        history.push(
          { role: "user", content: args.input.userMessage },
          { role: "assistant", content: args.input.assistantMessage },
        );
      },
    });
    yield* stateImpl.install();

    // Run the compiled workflow in a spawned task so we can cancel it
    const task = yield* spawn(function* () {
      yield* execute({ ir: Call(chat) });
    });

    // Wait for the loop to complete (agent throws after canned messages)
    yield* done.operation;

    // --- Assertions ---

    // Two full cycles completed
    expect(waitForUserCalls).toHaveLength(3); // 2 successful + 1 that throws
    expect(sampleCalls).toHaveLength(2);
    expect(recordTurnCalls).toHaveLength(2);
    expect(showCalls).toHaveLength(2);

    // Cycle 1: empty history
    expect(sampleCalls[0]!.input.history).toEqual([]);
    expect(sampleCalls[0]!.input.message).toBe("hello");
    expect(showCalls[0]!.input.message).toBe("Echo: hello");

    // Cycle 2: history has entries from cycle 1
    expect(sampleCalls[1]!.input.history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Echo: hello" },
    ]);
    expect(sampleCalls[1]!.input.message).toBe("how are you?");
    expect(showCalls[1]!.input.message).toBe("Echo: how are you?");

    // State was recorded
    expect(recordTurnCalls[0]!.input).toEqual({
      userMessage: "hello",
      assistantMessage: "Echo: hello",
    });
    expect(recordTurnCalls[1]!.input).toEqual({
      userMessage: "how are you?",
      assistantMessage: "Echo: how are you?",
    });
  });
});
