import type { Workflow } from "@tisyn/agent";

declare function App(): {
  waitForUser(input: { prompt: string }): Workflow<{ message: string }>;
  showAssistantMessage(input: { message: string }): Workflow<void>;
  hydrateTranscript(input: { messages: Array<{ role: string; content: string }> }): Workflow<void>;
  setReadOnly(input: { reason: string }): Workflow<void>;
};

declare function Llm(): {
  sample(input: {
    history: Array<{ role: string; content: string }>;
    message: string;
  }): Workflow<{ message: string }>;
};

export function* chat() {
  let history: Array<{ role: string; content: string }> = [];
  while (true) {
    const user = yield* App().waitForUser({ prompt: "Say something" });
    const assistant = yield* Llm().sample({
      history: history,
      message: user.message,
    });
    history = [
      ...history,
      { role: "user", content: user.message },
      { role: "assistant", content: assistant.message },
    ];
    yield* App().showAssistantMessage({ message: assistant.message });
  }
}
