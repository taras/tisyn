import { call } from "effection";

export function* foo() {
  return yield* call(() => Promise.resolve(1));
}
