import { call } from "effection";

function loadDescriptorModule(modulePath: string): Promise<object> {
  return import(modulePath);
}

export function* run(modulePath: string) {
  yield* call(() => loadDescriptorModule(modulePath));
}
