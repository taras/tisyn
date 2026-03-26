import { TestBrowser } from "./declarations.ts";

export function* secondBrowserIsReadOnly() {
  yield* TestBrowser().open({});
  yield* TestBrowser().expectStatusText({ text: "Say something" });

  yield* TestBrowser().fill({ name: "Message", value: "hello" });
  yield* TestBrowser().click({ role: "button", name: "Send" });
  yield* TestBrowser().expectVisible({ text: "Echo: hello" });

  // Open a second browser (separate BrowserContext = separate clientSessionId)
  yield* TestBrowser().openSession({ sessionId: "second" });

  // Second session gets read-only view
  yield* TestBrowser().expectStatusText({ text: "Session owned by another browser" });
  yield* TestBrowser().expectDisabled({ role: "textbox", name: "Message" });
  yield* TestBrowser().expectDisabled({ role: "button", name: "Send" });

  // Second session has the transcript
  yield* TestBrowser().expectTranscript({
    messages: ["You: hello", "Assistant: Echo: hello"],
  });

  // Switch back to first session and verify it still works
  yield* TestBrowser().switchSession({ sessionId: "default" });
  yield* TestBrowser().expectEnabled({ role: "textbox", name: "Message" });

  yield* TestBrowser().closeSession({ sessionId: "second" });
}
