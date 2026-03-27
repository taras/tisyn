/**
 * LLM agent via Worker transport. Chat agent remains local.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, withResolvers } from "effection";
import { implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { installRemoteAgent, workerTransport } from "@tisyn/transport";
import { Call } from "@tisyn/ir";
import { Chat, Llm, chat } from "../src/workflow.generated.js";

describe("Worker transport", () => {
  it("routes LLM.sample through a real worker thread", function* () {
    const renderCalls: Array<{
      input: { messages: Array<{ role: "user" | "assistant"; content: string }> };
    }> = [];
    const userMessages = ["hello from worker test"];
    let userMessageIndex = 0;
    const done = withResolvers<void>();

    // Install local Chat agent
    const chatImpl = implementAgent(Chat(), {
      *elicit() {
        if (userMessageIndex >= userMessages.length) {
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

    // Install LLM agent via Worker transport
    const factory = workerTransport({
      url: new URL("../src/llm-worker.ts", import.meta.url).href,
    });
    yield* installRemoteAgent(Llm(), factory);

    // Run the compiled workflow
    yield* spawn(function* () {
      yield* execute({ ir: Call(chat) });
    });

    yield* done.operation;

    // Assert: transcript was rendered from workflow-local history
    expect(renderCalls).toHaveLength(2); // initial empty + first turn
    expect(renderCalls[0]!.input.messages).toEqual([]);
    expect(renderCalls[1]!.input.messages).toEqual([
      { role: "user", content: "hello from worker test" },
      { role: "assistant", content: "Echo: hello from worker test" },
    ]);
  });
});
