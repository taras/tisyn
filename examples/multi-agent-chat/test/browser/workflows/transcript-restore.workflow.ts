import {
  sendTwoMessagesDom,
  verifyTranscriptAfterReloadDom,
} from "../dom-workflows.generated.ts";
import { Browser } from "./host-declarations.ts";

export function* transcriptRestoresAfterReload() {
  yield* Browser().open({});
  yield* Browser().execute({ workflow: sendTwoMessagesDom });
  yield* Browser().reload({});
  yield* Browser().execute({ workflow: verifyTranscriptAfterReloadDom });
}
