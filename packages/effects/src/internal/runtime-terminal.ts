import { createContext, type Operation } from "effection";
import type { Val } from "@tisyn/ir";

// ---------------------------------------------------------------------------
// RuntimeTerminal — cross-package seam carrying the runtime-controlled
// replay-aware terminal boundary for the active dispatch.
//
// Per `tisyn-scoped-effects-specification.md` §9.5, middleware re-executes on
// every run. The runtime prevents duplicate external side effects by
// intercepting each dispatch at a terminal boundary below every user-
// installable middleware priority. Terminal middleware (agent implementations,
// remote transport bindings, mocks, and the built-in EffectsApi terminal) MUST
// delegate their live work through the `runAsTerminal(...)` public helper,
// which reads this context and delegates to the installed boundary.
//
// Declared once, exported only via `@tisyn/effects/internal` — the non-stable
// workspace-intended subpath. User code has no supported way to reach this
// module and MUST NOT import it.
//
// The runtime installs a fresh RuntimeTerminalBoundary value for each
// standard-effect dispatch via RuntimeTerminal.with(...), closing over the
// active journal-lane id, replay cursor, and journaling context. The
// boundary's `run(effectId, data, liveWork)` method checks the cursor for a
// stored YieldEvent matching `effectId`; if found, it consumes and returns the
// stored result; otherwise it invokes `liveWork()` and writes a new YieldEvent.
// ---------------------------------------------------------------------------

/**
 * @internal
 *
 * Runtime-controlled terminal boundary for a single effect dispatch. The
 * runtime installs this per-dispatch. Terminal middleware delegates to it via
 * the public `runAsTerminal(...)` helper in `@tisyn/effects`.
 */
export interface RuntimeTerminalBoundary {
  run<T extends Val = Val>(
    effectId: string,
    data: Val,
    liveWork: () => Operation<T>,
  ): Operation<T>;
}

/**
 * @internal
 *
 * Active runtime terminal boundary, or `undefined` when no Tisyn runtime is
 * installed (standalone @tisyn/effects use). Single declaration across the
 * workspace — `context.name` is scope-keyed by Effection, so a duplicate
 * createContext call with the same name would silently share this slot.
 */
export const RuntimeTerminal = createContext<RuntimeTerminalBoundary | undefined>(
  "$tisyn-runtime-terminal",
  undefined,
);
