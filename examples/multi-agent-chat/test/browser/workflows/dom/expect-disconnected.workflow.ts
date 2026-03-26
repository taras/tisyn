import { Dom } from "../dom-declarations.ts";

export function* expectDisconnectedDom() {
  yield* Dom().expectStatusText({ text: "Disconnected" });
}
