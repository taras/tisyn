import type { Operation } from "effection";
import type { Val } from "@tisyn/ir";
import type { Invocation } from "./types.js";
import { dispatch } from "./dispatch.js";

/** Convert an Invocation to a dispatch call. */
export function* invoke<T = Val>(invocation: Invocation): Operation<T> {
  return (yield* dispatch(invocation.effectId, invocation.data as Val)) as T;
}
