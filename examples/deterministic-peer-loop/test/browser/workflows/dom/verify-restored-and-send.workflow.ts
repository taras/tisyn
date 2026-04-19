import { Dom } from "../dom-declarations.ts";

export function* verifyRestoredAndSendAfterRestartDom() {
  yield* Dom().expectTranscript({
    messages: ["You: before restart", "Assistant: Echo: before restart"],
  });
  yield* Dom().expectStatusText({ text: "Say something" });
  yield* Dom().fill({ name: "Message", value: "after restart" });
  yield* Dom().click({ role: "button", name: "Send" });
  yield* Dom().expectVisible({ text: "Assistant: Echo: after restart" });
}
