import type { Workflow } from "@tisyn/agent";

declare function Browser(): {
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

declare function State(): {
  getHistory(input: { placeholder: string }): Workflow<Array<{ role: string; content: string }>>;
  recordTurn(input: { userMessage: string; assistantMessage: string }): Workflow<void>;
};

export function* chat() {
  while (true) {
    const user = yield* Browser().waitForUser({ prompt: "Say something" });
    const history = yield* State().getHistory({ placeholder: "" });
    const assistant = yield* Llm().sample({
      history: history,
      message: user.message,
    });
    yield* State().recordTurn({
      userMessage: user.message,
      assistantMessage: assistant.message,
    });
    yield* Browser().showAssistantMessage({ message: assistant.message });
  }
}
