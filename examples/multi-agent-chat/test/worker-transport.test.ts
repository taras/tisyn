/**
 * LLM agent via Worker transport. Browser and State agents remain local.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, withResolvers } from "effection";
import { implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { installRemoteAgent, workerTransport } from "@tisyn/transport";
import { Call } from "@tisyn/ir";
import { Browser, Llm, State, chat } from "../src/workflow.generated.js";

describe("Worker transport", () => {
  it("routes LLM.sample through a real worker thread", function* () {
    const showCalls: Array<{ input: { message: string } }> = [];
    const history: Array<{ role: string; content: string }> = [];
    const userMessages = ["hello from worker test"];
    let userMessageIndex = 0;
    const done = withResolvers<void>();

    // Install local Browser agent
    const browserImpl = implementAgent(Browser(), {
      *waitForUser(args) {
        if (userMessageIndex >= userMessages.length) {
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

    // Install local State agent
    const stateImpl = implementAgent(State(), {
      *getHistory() {
        return [...history];
      },
      *recordTurn(args) {
        history.push(
          { role: "user", content: args.input.userMessage },
          { role: "assistant", content: args.input.assistantMessage },
        );
      },
    });
    yield* stateImpl.install();

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

    // Assert: the echo reply came back through the Worker
    expect(showCalls).toHaveLength(1);
    expect(showCalls[0]!.input.message).toBe("Echo: hello from worker test");

    // Assert: history was recorded
    expect(history).toEqual([
      { role: "user", content: "hello from worker test" },
      { role: "assistant", content: "Echo: hello from worker test" },
    ]);
  });
});
