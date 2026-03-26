import { Dom } from "../dom-declarations.ts";

export function* verifySecondBrowserReadOnlyDom() {
  yield* Dom().expectStatusText({ text: "Session owned by another browser" });
  yield* Dom().expectDisabled({ role: "textbox", name: "Message" });
  yield* Dom().expectDisabled({ role: "button", name: "Send" });
  yield* Dom().expectTranscript({
    messages: ["You: hello", "Assistant: Echo: hello"],
  });
}
