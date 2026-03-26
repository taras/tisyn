import { Dom } from "../dom-declarations.ts";

export function* verifyTranscriptAfterReloadDom() {
  yield* Dom().expectTranscript({
    messages: [
      "You: hello",
      "Assistant: Echo: hello",
      "You: world",
      "Assistant: Echo: world",
    ],
  });
  yield* Dom().expectStatusText({ text: "Say something" });
}
