declare function Browser(): {
  waitForUser(input: { prompt: string }): Workflow<{ message: string }>;
  showAssistantMessage(input: { message: string }): Workflow<void>;
};

declare function LLM(): {
  sample(input: {
    history: Array<{ role: string; content: string }>;
    message: string;
  }): Workflow<{ message: string }>;
};

declare function State(): {
  getHistory(input: { placeholder: string }): Workflow<Array<{ role: string; content: string }>>;
  recordTurn(input: { userMessage: string; assistantMessage: string }): Workflow<void>;
};

// The `if (false) { return; }` triggers the compiler's Case B (recursive Fn)
// which creates proper Let bindings for variable declarations across the loop.
// Without it, While Case A discards variable names and refs would be unbound.
export function* chat() {
  while (true) {
    const user = yield* Browser().waitForUser({ prompt: "Say something" });
    const history = yield* State().getHistory({ placeholder: "" });
    const assistant = yield* LLM().sample({
      history: history,
      message: user.message,
    });
    yield* State().recordTurn({
      userMessage: user.message,
      assistantMessage: assistant.message,
    });
    yield* Browser().showAssistantMessage({ message: assistant.message });
    if (false) {
      return;
    }
  }
}
