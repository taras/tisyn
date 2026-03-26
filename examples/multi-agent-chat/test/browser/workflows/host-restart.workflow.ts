import {
  expectDisconnectedDom,
  sendBeforeRestartDom,
  verifyRestoredAndSendAfterRestartDom,
} from "../dom-workflows.generated.ts";
import { Browser, Host } from "./host-declarations.ts";

export function* hostRestartPreservesState() {
  yield* Browser().open({});
  yield* Browser().execute({ workflow: sendBeforeRestartDom });
  yield* Host().restart({});
  yield* Browser().execute({ workflow: expectDisconnectedDom });
  yield* Browser().reload({});
  yield* Browser().execute({ workflow: verifyRestoredAndSendAfterRestartDom });
}
