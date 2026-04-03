import { call } from "effection";

export function* run(modulePath: string) {
  yield* call(() => import(modulePath));
}
