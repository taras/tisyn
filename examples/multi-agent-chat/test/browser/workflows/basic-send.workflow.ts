export function* basicSendReceive() {
  yield* TestBrowser().open({});
  yield* TestBrowser().expectStatusText({ text: "Say something" });

  yield* TestBrowser().fill({ name: "Message", value: "hello" });
  yield* TestBrowser().click({ role: "button", name: "Send" });

  yield* TestBrowser().expectVisible({ text: "Echo: hello" });
  yield* TestBrowser().expectTranscript({
    messages: ["You: hello", "Assistant: Echo: hello"],
  });
}
