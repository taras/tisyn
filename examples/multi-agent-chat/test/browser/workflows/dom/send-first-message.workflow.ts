import { Dom } from "../dom-declarations.ts";

export function* sendFirstMessageDom() {
  yield* Dom().expectStatusText({ text: "Say something" });
  yield* Dom().fill({ name: "Message", value: "hello" });
  yield* Dom().click({ role: "button", name: "Send" });
  yield* Dom().expectVisible({ text: "Assistant: Echo: hello" });
}
