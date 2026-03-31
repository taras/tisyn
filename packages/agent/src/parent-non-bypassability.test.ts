import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped, spawn } from "effection";
import type { Val } from "@tisyn/ir";
import type { FnNode } from "@tisyn/ir";
import { Fn, Eval, Ref, Arr, If, Eq, Q, Throw } from "@tisyn/ir";
import { Effects, dispatch, installEnforcement, evaluateMiddlewareFn } from "./index.js";
import { ProhibitedEffectError } from "@tisyn/kernel";

// ---------------------------------------------------------------------------
// IR helpers
// ---------------------------------------------------------------------------

// Allow-all middleware: passes every effect through to dispatch
const allowAll: FnNode = Fn(
  ["effectId", "data"],
  Eval("dispatch", Arr(Ref("effectId"), Ref("data"))),
);

// Deny specific effect: if effectId === targetId, throw; else forward
function denyEffect(id: string): FnNode {
  return Fn(
    ["effectId", "data"],
    If(
      Eq(Ref("effectId"), Q(id)),
      Throw(Q(id)),
      Eval("dispatch", Arr(Ref("effectId"), Ref("data"))),
    ),
  );
}

// Helper that simulates protocol-server wiring of IR middleware
function* withEnforcementFromIr(fn: FnNode) {
  yield* installEnforcement((effectId, data, inner) =>
    evaluateMiddlewareFn(fn, effectId, data, inner),
  );
}

// ---------------------------------------------------------------------------
// PNB tests — parent enforcement non-bypassability
// ---------------------------------------------------------------------------

describe("parent enforcement non-bypassability", () => {
  // PNB-1: enforcement installed in parent scope is inherited by child scopes
  it("enforcement installed in parent fires for dispatches from child scopes", function* () {
    const log: string[] = [];

    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock core handler
      *dispatch([_e, _d]: [string, Val]) {
        log.push("core");
        return "core" as Val;
      },
    });

    // Install enforcement in the current (parent) scope
    yield* installEnforcement(function* (effectId, data, inner) {
      log.push("enforcement");
      return yield* inner(effectId, data);
    });

    // Effects.around from a child scope — inherited lookup means enforcement DOES run
    yield* scoped(function* () {
      yield* dispatch("test.op", null);
    });

    // enforcement fires because child scope inherits from parent via prototype chain
    expect(log).toContain("enforcement");
    expect(log).toContain("core");
    expect(log.indexOf("enforcement")).toBeLessThan(log.indexOf("core"));
  });

  // PNB-2: enforcement runs before the Effects handler in the same scope
  it("enforcement runs before the Effects handler in the same scope where it is installed", function* () {
    const log: string[] = [];

    yield* Effects.around({
      *dispatch([_e, _d]: [string, Val]) {
        log.push("core");
        return "core" as Val;
      },
    });

    yield* installEnforcement(function* (effectId, data, inner) {
      log.push("enforcement");
      return yield* inner(effectId, data);
    });

    // Effects.around in the SAME scope as installEnforcement
    yield* dispatch("test.op", null);

    // Enforcement runs first, then the Effects handler
    expect(log[0]).toBe("enforcement");
    expect(log).toContain("core");
    expect(log.indexOf("enforcement")).toBeLessThan(log.indexOf("core"));
  });

  // PNB-3: enforcement denial is non-bypassable — child Effects middleware cannot allow a denied effect
  it("enforcement denial cannot be bypassed by child Effects middleware installed after enforcement", function* () {
    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock core handler
      *dispatch([_e, _d]: [string, Val]) {
        return "core" as Val;
      },
    });

    // Enforcement denies "blocked.op" in the same scope
    yield* installEnforcement(function* (effectId, data, inner) {
      if (effectId === "blocked.op") throw new Error("denied by enforcement");
      return yield* inner(effectId, data);
    });

    // Even if Effects middleware is added after enforcement, it runs AFTER enforcement
    yield* Effects.around({
      *dispatch([e, d]: [string, Val], next) {
        return yield* next(e, d);
      },
    });

    try {
      yield* dispatch("blocked.op", null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toBe("denied by enforcement");
    }
  });

  // PNB-4: IR-based enforcement (evaluateMiddlewareFn with allow-all) passes effects through
  it("IR allow-all enforcement passes effects through to the Effects chain", function* () {
    let coreReached = false;

    yield* Effects.around({
      *dispatch([_e, _d]: [string, Val]) {
        coreReached = true;
        return "core" as Val;
      },
    });

    yield* withEnforcementFromIr(allowAll);

    const result = yield* dispatch("any.op", null);
    expect(coreReached).toBe(true);
    expect(result).toBe("core");
  });

  // PNB-5: IR-based enforcement (evaluateMiddlewareFn with denyEffect) denies the target effect
  it("IR denyEffect enforcement denies specific effect", function* () {
    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock core handler
      *dispatch([_e, _d]: [string, Val]) {
        return "core" as Val;
      },
    });

    yield* withEnforcementFromIr(denyEffect("sensitive.op"));

    // allowed.op passes through
    const result = yield* dispatch("allowed.op", null);
    expect(result).toBe("core");

    // sensitive.op is denied by the IR enforcement
    try {
      yield* dispatch("sensitive.op", null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  // PNB-6: IR enforcement that uses a non-dispatch effect ID throws ProhibitedEffectError
  it("IR middleware that yields non-dispatch effect throws ProhibitedEffectError", function* () {
    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock core handler
      *dispatch([_e, _d]: [string, Val]) {
        return "core" as Val;
      },
    });

    // IR fn that tries to yield a "sleep" effect — not allowed in middleware
    const illegalMiddleware = Fn(
      ["effectId", "data"],
      Eval("sleep", Q(null)), // "sleep" is not "dispatch" — prohibited
    );

    yield* withEnforcementFromIr(illegalMiddleware);

    try {
      yield* dispatch("test.op", null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProhibitedEffectError);
      expect((error as ProhibitedEffectError).message).toContain("sleep");
    }
  });

  // PNB-7: enforcement installed in a scope is not visible to a sibling scope
  it("enforcement installed in one scope does not apply to sibling scope", function* () {
    const log: string[] = [];

    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock core handler
      *dispatch([_e, _d]: [string, Val]) {
        log.push("core");
        return "core" as Val;
      },
    });

    // Sibling scope 1: installs enforcement
    yield* scoped(function* () {
      yield* installEnforcement(function* (effectId, data, inner) {
        log.push("enforcement-s1");
        return yield* inner(effectId, data);
      });

      yield* dispatch("test.op", null);
      expect(log).toContain("enforcement-s1");
    });

    log.length = 0;

    // Sibling scope 2: enforcement from scope 1 must NOT be visible here
    yield* scoped(function* () {
      yield* dispatch("test.op", null);
      expect(log).not.toContain("enforcement-s1");
      expect(log).toContain("core");
    });
  });

  // PNB-8: child scope can install its own enforcement independent of parent
  it("child scope can install its own enforcement without affecting parent scope dispatch", function* () {
    const log: string[] = [];

    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock core handler
      *dispatch([_e, _d]: [string, Val]) {
        log.push("core");
        return "core" as Val;
      },
    });

    yield* scoped(function* () {
      yield* installEnforcement(function* (effectId, data, inner) {
        log.push("child-enforcement");
        return yield* inner(effectId, data);
      });

      yield* dispatch("test.op", null);
      expect(log).toContain("child-enforcement");
    });

    log.length = 0;

    // Parent scope dispatch: child-enforcement must NOT run here
    yield* dispatch("test.op", null);
    expect(log).not.toContain("child-enforcement");
    expect(log).toContain("core");
  });

  // PNB-9: enforcement allows overriding effectId forwarded to inner
  // (keeping original numbering; new inheritance tests are PNB-10 through PNB-14 below)
  it("enforcement can transform the effectId before forwarding to the Effects chain", function* () {
    let receivedEffectId: string | null = null;

    yield* Effects.around({
      *dispatch([e, _d]: [string, Val]) {
        receivedEffectId = e;
        return "core" as Val;
      },
    });

    yield* installEnforcement(function* (_effectId, data, inner) {
      // Rewrite effectId to a canonical form
      return yield* inner("canonical.op", data);
    });

    yield* dispatch("original.op", null);
    expect(receivedEffectId).toBe("canonical.op");
  });

  // PNB-10: child scope inherits parent enforcement (inherited lookup)
  it("child scoped() task inherits enforcement installed in parent", function* () {
    const log: string[] = [];

    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock core handler
      *dispatch([_e, _d]: [string, Val]) {
        log.push("core");
        return "core" as Val;
      },
    });

    yield* installEnforcement(function* (effectId, data, inner) {
      log.push("enforcement");
      return yield* inner(effectId, data);
    });

    yield* scoped(function* () {
      yield* dispatch("test.op", null);
    });

    expect(log).toContain("enforcement");
    expect(log).toContain("core");
  });

  // PNB-11: spawned task inherits parent enforcement
  it("spawned task inherits enforcement installed in parent", function* () {
    const log: string[] = [];

    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock core handler
      *dispatch([_e, _d]: [string, Val]) {
        log.push("core");
        return "core" as Val;
      },
    });

    yield* installEnforcement(function* (effectId, data, inner) {
      log.push("enforcement");
      return yield* inner(effectId, data);
    });

    const task = yield* spawn(function* () {
      yield* dispatch("test.op", null);
    });
    yield* task;

    expect(log).toContain("enforcement");
    expect(log).toContain("core");
  });

  // PNB-12: child scope enforcement shadows parent enforcement
  it("child enforcement shadows parent enforcement for that subtree", function* () {
    const log: string[] = [];

    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock core handler
      *dispatch([_e, _d]: [string, Val]) {
        log.push("core");
        return "core" as Val;
      },
    });

    // Parent installs enforcement
    yield* installEnforcement(function* (effectId, data, inner) {
      log.push("parent-enforcement");
      return yield* inner(effectId, data);
    });

    // Child installs its own enforcement — shadows parent
    yield* scoped(function* () {
      yield* installEnforcement(function* (effectId, data, inner) {
        log.push("child-enforcement");
        return yield* inner(effectId, data);
      });

      yield* dispatch("test.op", null);
    });

    // Child enforcement ran, not parent enforcement (shadowed)
    expect(log).toContain("child-enforcement");
    expect(log).not.toContain("parent-enforcement");
    expect(log).toContain("core");
  });
});
