import {
  sendFirstMessageDom,
  verifyDefaultSessionEnabledDom,
  verifySecondBrowserReadOnlyDom,
} from "../dom-workflows.generated.ts";
import { Browser } from "./host-declarations.ts";

export function* secondBrowserIsReadOnly() {
  yield* Browser().open({});
  yield* Browser().execute({ workflow: sendFirstMessageDom });
  yield* Browser().openSession({ sessionId: "second" });
  yield* Browser().execute({ workflow: verifySecondBrowserReadOnlyDom });
  yield* Browser().switchSession({ sessionId: "default" });
  yield* Browser().execute({ workflow: verifyDefaultSessionEnabledDom });
  yield* Browser().closeSession({ sessionId: "second" });
}
