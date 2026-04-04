import type { Workflow } from "@tisyn/agent";

declare function App(): {
  elicit(input: { message: string }): Workflow<{ message: string }>;
  showAssistantMessage(input: { message: string }): Workflow<void>;
  loadChat(messages: Array<{ role: string; content: string }>): Workflow<void>;
  setReadOnly(input: { reason: string }): Workflow<void>;
};

declare function Llm(): {
  sample(input: {
    history: Array<{ role: string; content: string }>;
    message: string;
  }): Workflow<{ message: string }>;
};

declare function DB(): {
  loadMessages(input: Record<string, never>): Workflow<Array<{ role: string; content: string }>>;
  appendMessage(input: { role: string; content: string }): Workflow<void>;
};

export function* chat() {
  // Restore prior chat state: load from DB, push to browser
  const prior = yield* DB().loadMessages({});
  yield* App().loadChat(prior);

  // Chat loop
  let history = prior;
  while (true) {
    const user = yield* App().elicit({ message: "Say something" });
    yield* DB().appendMessage({ role: "user", content: user.message });

    const contextForSampling = [
      ...history,
      { role: "user", content: user.message },
    ];
    const assistant = yield* Llm().sample({
      history: contextForSampling,
      message: user.message,
    });
    yield* DB().appendMessage({ role: "assistant", content: assistant.message });

    history = [
      ...contextForSampling,
      { role: "assistant", content: assistant.message },
    ];
    yield* App().showAssistantMessage({ message: assistant.message });
  }
}
