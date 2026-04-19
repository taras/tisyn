import { Dom } from "../dom-declarations.ts";

export function* verifyDefaultSessionEnabledDom() {
  yield* Dom().expectEnabled({ role: "textbox", name: "Message" });
}
