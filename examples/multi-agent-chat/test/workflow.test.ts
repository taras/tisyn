/**
 * Compiled workflow with local agents — no transports.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, withResolvers } from "effection";
import { implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { Call } from "@tisyn/ir";
import { Chat, Llm, chat } from "../src/workflow.generated.js";

describe("Compiled workflow", () => {
  it("runs the chat loop: elicit → sample → renderTranscript, with history accumulation", function* () {
    // Track agent interactions
    const elicitCalls: Array<{ input: { prompt: string } }> = [];
    const sampleCalls: Array<{
      input: {
        history: Array<{ role: "user" | "assistant"; content: string }>;
        message: string;
      };
    }> = [];
    const renderCalls: Array<{
      input: { messages: Array<{ role: "user" | "assistant"; content: string }> };
    }> = [];

    // Canned user messages — after these, the agent throws to exit the loop
    const userMessages = ["hello", "how are you?"];
    let userMessageIndex = 0;

    const done = withResolvers<void>();

    // Install local Chat agent
    const chatImpl = implementAgent(Chat(), {
      *elicit(args) {
        elicitCalls.push(args);
        if (userMessageIndex >= userMessages.length) {
          // Signal completion and throw to exit the loop
          done.resolve();
          throw new Error("done");
        }
        return { message: userMessages[userMessageIndex++]! };
      },
      *renderTranscript(args) {
        renderCalls.push(args);
      },
      *setReadOnly() {},
    });
    yield* chatImpl.install();

    // Install local LLM agent (echo stub)
    const llmImpl = implementAgent(Llm(), {
      *sample(args) {
        sampleCalls.push(args);
        return { message: `Echo: ${args.input.message}` };
      },
    });
    yield* llmImpl.install();

    // Run the compiled workflow in a spawned task so we can cancel it
    const task = yield* spawn(function* () {
      yield* execute({ ir: Call(chat) });
    });

    // Wait for the loop to complete (agent throws after canned messages)
    yield* done.operation;

    // --- Assertions ---

    // Two full cycles completed
    expect(elicitCalls).toHaveLength(3); // 2 successful + 1 that throws
    expect(sampleCalls).toHaveLength(2);
    expect(renderCalls).toHaveLength(3); // initial empty + two updates

    // Cycle 1: empty history
    expect(sampleCalls[0]!.input.history).toEqual([]);
    expect(sampleCalls[0]!.input.message).toBe("hello");

    // Cycle 2: history has entries from cycle 1
    expect(sampleCalls[1]!.input.history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Echo: hello" },
    ]);
    expect(sampleCalls[1]!.input.message).toBe("how are you?");
    // Transcript was rendered from workflow-local state
    expect(renderCalls[0]!.input.messages).toEqual([]);
    expect(renderCalls[1]!.input.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Echo: hello" },
    });
    expect(renderCalls[2]!.input.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Echo: hello" },
      { role: "user", content: "how are you?" },
      { role: "assistant", content: "Echo: how are you?" },
    });

    task.halt();
  });
});
