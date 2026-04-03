import { call } from "effection";
import { loadDescriptorModule } from "./valid-shared-helper.js";

export function* run(modulePath: string) {
  yield* call(() => loadDescriptorModule(modulePath));
}
