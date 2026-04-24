/**
 * @internal
 *
 * Workspace-internal installer for the Effects `replay` middleware lane.
 * Composes between user middleware (`max`) and framework implementations
 * (`min`) in the dispatch chain. Not part of the stable public API of
 * `@tisyn/effects`; see `./README.md`.
 */

import type { Operation } from "effection";
import type { PropertyMiddleware } from "@effectionx/context-api";
import type { Val } from "@tisyn/ir";
import { EffectsApi } from "../dispatch.js";

/**
 * @internal
 *
 * Middleware signature for the Effects `dispatch` operation, suitable
 * for installation into the `replay` lane.
 */
export type ReplayDispatchMiddleware = PropertyMiddleware<
  { dispatch: (effectId: string, data: Val) => Operation<Val> },
  "dispatch"
>;

/**
 * @internal
 *
 * Install dispatch middleware into the runtime-internal `replay` lane
 * of the Effects composition. The installed middleware composes after
 * `max` frames and before `min` frames on any single dispatch.
 *
 * Phase 3 only wires the lane; runtime replay substitution is
 * installed by a later phase.
 */
export function* installReplayDispatch(dispatch: ReplayDispatchMiddleware): Operation<void> {
  yield* EffectsApi.around({ dispatch }, { at: "replay" });
}
