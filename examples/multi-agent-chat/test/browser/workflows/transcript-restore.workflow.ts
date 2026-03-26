import { TestBrowser } from "./declarations.ts";

export function* transcriptRestoresAfterReload() {
  yield* TestBrowser().open({});
  yield* TestBrowser().expectStatusText({ text: "Say something" });

  yield* TestBrowser().fill({ name: "Message", value: "hello" });
  yield* TestBrowser().click({ role: "button", name: "Send" });
  yield* TestBrowser().expectVisible({ text: "Echo: hello" });

  yield* TestBrowser().fill({ name: "Message", value: "world" });
  yield* TestBrowser().click({ role: "button", name: "Send" });
  yield* TestBrowser().expectVisible({ text: "Echo: world" });

  yield* TestBrowser().reload({});

  yield* TestBrowser().expectTranscript({
    messages: [
      "You: hello",
      "Assistant: Echo: hello",
      "You: world",
      "Assistant: Echo: world",
    ],
  });
  yield* TestBrowser().expectStatusText({ text: "Say something" });
}
