export function* hostRestartPreservesState() {
  yield* TestBrowser().open({});
  yield* TestBrowser().expectStatusText({ text: "Say something" });

  yield* TestBrowser().fill({ name: "Message", value: "before restart" });
  yield* TestBrowser().click({ role: "button", name: "Send" });
  yield* TestBrowser().expectVisible({ text: "Echo: before restart" });

  // Host dies — browser sees disconnection
  yield* TestHost().restart({});
  yield* TestBrowser().expectStatusText({ text: "Disconnected" });

  // Reload to reconnect through the proxy (now targeting new host)
  yield* TestBrowser().reload({});

  // Transcript restored from journal replay
  yield* TestBrowser().expectTranscript({
    messages: [
      "You: before restart",
      "Assistant: Echo: before restart",
    ],
  });
  yield* TestBrowser().expectStatusText({ text: "Say something" });

  // Verify the workflow can continue after restart
  yield* TestBrowser().fill({ name: "Message", value: "after restart" });
  yield* TestBrowser().click({ role: "button", name: "Send" });
  yield* TestBrowser().expectVisible({ text: "Echo: after restart" });
}
