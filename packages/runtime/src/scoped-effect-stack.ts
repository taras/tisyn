/**
 * Scoped-effect-frame stack — runtime-owned overlay primitive.
 *
 * Overlays pushed via ctx.invoke(fn, args, { overlay }) are visible to the
 * invoked child subtree via currentScopedEffectFrames(). They are NOT
 * journaled (no durable event, no IR descriptor) — replay equivalence is
 * guaranteed by deterministic middleware re-execution.
 */
import { createContext, type Operation } from "effection";
import type { ScopedEffectFrame } from "@tisyn/agent";

const ScopedEffectStack = createContext<readonly ScopedEffectFrame[]>(
  "$tisyn-scoped-effect-stack",
  [],
);

/**
 * Push `frame` for the duration of `body`. The frame is visible via
 * currentScopedEffectFrames() inside `body` and restored on exit.
 */
export function* withOverlayFrame<T>(
  frame: ScopedEffectFrame,
  body: () => Operation<T>,
): Operation<T> {
  const current = (yield* ScopedEffectStack.get()) ?? [];
  return yield* ScopedEffectStack.with([...current, frame], () => body());
}

/** Read the current overlay stack, outermost first. */
export function* currentScopedEffectFrames(): Operation<readonly ScopedEffectFrame[]> {
  return (yield* ScopedEffectStack.get()) ?? [];
}
