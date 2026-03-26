import { basicSendReceiveDom } from "../dom-workflows.generated.ts";
import { Browser } from "./host-declarations.ts";

export function* basicSendReceive() {
  yield* Browser().open({});
  yield* Browser().execute({ workflow: basicSendReceiveDom });
}
