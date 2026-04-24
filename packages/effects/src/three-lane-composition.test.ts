/**
 * Three-lane middleware composition tests for the replay-aware Effects
 * substrate (#125, Phase 3).
 *
 * Covers scoped-effects test plan IDs from §13:
 *
 *   RD-CO-001 — max runs before min, then core
 *   RD-CO-002 — multiple max frames install-order; multiple min frames reverse install-order
 *   RD-CO-004 / RD-PL-001 — public Effects.around(..., { at: "replay" as any }) rejected
 *   RD-PL-002 (companion) — rejection error does not name the internal group "replay"
 *
 * Plus the Phase 3-specific "internal replay lane exists and composes
 * between max and min" assertion named in the Phase 3 handoff.
 *
 * NOTE — install order matters: the `min` group uses prepend mode, so
 * the core handler MUST be installed first (becomes innermost in the
 * min lane) and min middleware installed afterwards (prepended on top
 * so it runs before core on dispatch). Reversing this places core
 * outermost and short-circuits the min middleware.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import type { Val } from "@tisyn/ir";
import { Effects, dispatch } from "./index.js";
import { installReplayDispatch } from "./internal/index.js";

describe("three-lane middleware composition", () => {
  // RD-CO-001
  it("max runs before min, then core", function* () {
    const log: string[] = [];

    // Core first (innermost in min lane).
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return null as Val;
        },
      },
      { at: "min" },
    );

    // Min middleware prepends on top of core.
    yield* Effects.around(
      {
        *dispatch([e, d]: [string, Val], next) {
          log.push("min");
          return yield* next(e, d);
        },
      },
      { at: "min" },
    );

    // Max middleware.
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("max");
        return yield* next(e, d);
      },
    });

    yield* dispatch("test.op", null);
    expect(log).toEqual(["max", "min", "core"]);
  });

  // RD-CO-002
  it("multiple max frames keep install order; multiple min frames run in reverse install order", function* () {
    const log: string[] = [];

    // Core first.
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return null as Val;
        },
      },
      { at: "min" },
    );

    // m1 installed before m2; prepend means m2 becomes outermost in the min lane.
    yield* Effects.around(
      {
        *dispatch([e, d]: [string, Val], next) {
          log.push("m1");
          return yield* next(e, d);
        },
      },
      { at: "min" },
    );
    yield* Effects.around(
      {
        *dispatch([e, d]: [string, Val], next) {
          log.push("m2");
          return yield* next(e, d);
        },
      },
      { at: "min" },
    );

    // M1 installed before M2; append means M1 stays outer in the max lane.
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("M1");
        return yield* next(e, d);
      },
    });
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("M2");
        return yield* next(e, d);
      },
    });

    yield* dispatch("test.op", null);
    expect(log).toEqual(["M1", "M2", "m2", "m1", "core"]);
  });

  // RD-CO-004 / RD-PL-001 + RD-PL-002 companion
  it("public Effects.around with unknown { at } rejects without leaking the internal group name", function* () {
    const log: string[] = [];

    // Sentinel core anchor: must still fire after the rejected install.
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("sentinel");
          return null as Val;
        },
      },
      { at: "min" },
    );

    try {
      yield* Effects.around(
        {
          *dispatch([e, d]: [string, Val], next) {
            log.push("should-not-install");
            return yield* next(e, d);
          },
        },
        // Caller uses an unsafe cast; public surface must reject.
        { at: "replay" as unknown as "min" },
      );
      expect.unreachable("Effects.around should have thrown on unknown { at } value");
    } catch (error) {
      const message = (error as Error).message;
      // Exact message — test will fail if the public error regresses to echo the input.
      expect(message).toBe('Effects.around: { at } must be "max" or "min"');
      // Internal group name must not leak to the public error surface.
      expect(message.includes("replay")).toBe(false);
    }

    // Confirm the failed install left no middleware behind.
    yield* dispatch("test.op", null);
    expect(log).toEqual(["sentinel"]);
  });

  // Phase 3-specific: internal replay lane composes between max and min.
  it("internal installReplayDispatch composes between max and min", function* () {
    const log: string[] = [];

    // Core first (innermost in min lane).
    yield* Effects.around(
      {
        *dispatch([_e, _d]: [string, Val]) {
          log.push("core");
          return null as Val;
        },
      },
      { at: "min" },
    );

    // Min middleware on top of core.
    yield* Effects.around(
      {
        *dispatch([e, d]: [string, Val], next) {
          log.push("min");
          return yield* next(e, d);
        },
      },
      { at: "min" },
    );

    // Replay middleware via the internal installer (reaches the `replay` lane
    // without the group name being addressable from user code).
    yield* installReplayDispatch(function* ([e, d]: [string, Val], next) {
      log.push("replay");
      return yield* next(e, d);
    });

    // Max middleware.
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        log.push("max");
        return yield* next(e, d);
      },
    });

    yield* dispatch("test.op", null);
    expect(log).toEqual(["max", "replay", "min", "core"]);
  });
});
