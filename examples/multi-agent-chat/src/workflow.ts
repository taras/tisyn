import type { Workflow } from "@tisyn/agent";

declare function Chat(): {
  elicit(input: { prompt: string }): Workflow<{ message: string }>;
  renderTranscript(input: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Workflow<void>;
  setReadOnly(input: { reason: string }): Workflow<void>;
};

declare function Llm(): {
  sample(input: {
    history: Array<{ role: "user" | "assistant"; content: string }>;
    message: string;
  }): Workflow<{ message: string }>;
};

export function* chat() {
  const state = {
    history: [] as Array<{ role: "user" | "assistant"; content: string }>,
  };
  yield* Chat().renderTranscript({ messages: state.history });
  while (true) {
    const user = yield* Chat().elicit({ prompt: "Say something" });
    const assistant = yield* Llm().sample({
      history: state.history,
      message: user.message,
    });
    state.history = [
      ...state.history,
      { role: "user", content: user.message },
      { role: "assistant", content: assistant.message },
    ];
    yield* Chat().renderTranscript({ messages: state.history });
  }
}
