/**
 * Runtime behavioral tests for compiler correctness.
 *
 * These tests compile TypeScript source to IR, then execute it via @tisyn/runtime
 * to assert observable behavior rather than IR shape.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { Call } from "@tisyn/ir";
import { execute } from "@tisyn/runtime";
import { compileOne } from "./index.js";

describe("while loop expression value", () => {
  it("returns the last body result when the condition becomes false", function* () {
    // The condition-false exit of the loop Fn must propagate the last computed
    // body value, not null. The __last accumulator param carries it forward so
    // If(cond, body, Ref(__last)) returns it when the loop exits normally.
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        while (x < 10) {
          x = x + 1;
        }
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(10);
    }
  });
});

describe("SSA join for nested if inside branch", () => {
  it("produces the post-join value for a variable reassigned in a nested if", function* () {
    // A nested if-statement in the "neither branch terminates" path must still
    // synthesize an SSA join so the variable's post-branch version is visible
    // to subsequent statements.
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        if (true) {
          if (true) {
            x = 5;
          }
        }
        return x;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(5);
    }
  });
});

describe("asymmetric branch SSA isolation", () => {
  it("thenTerminates && !elseTerminates: fallthrough does not reference unbound version", function* () {
    // A terminating then-branch must be compiled in a cloned SSA context.
    // If the shared context is mutated instead, the fallthrough path emits a
    // versioned ref that is only bound inside the then Let chain, causing an
    // "Unbound variable" error at runtime.
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        if (true) {
          if (false) {
            x = 99;
            return x;
          }
          return x;
        }
        return x;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(0);
    }
  });

  it("!thenTerminates && elseTerminates: terminating else uses pre-then SSA versions", function* () {
    // The else context must be cloned from the pre-then state. If it is cloned
    // after the then-branch mutates the shared context, the else branch emits a
    // ref only bound in the then Let chain and fails at runtime.
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        if (true) {
          if (true) {
            x = 2;
          } else {
            return x;
          }
          return x;
        }
        return x;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(2);
    }
  });
});

describe("per-branch SSA isolation inside while loop body", () => {
  it("if/else inside while loop does not reference versions from the other branch", function* () {
    // Each branch of an if inside a loop body must be compiled in its own cloned
    // SSA context with the remaining loop statements inlined. Sharing the context
    // between branches causes one branch to emit a ref that is only bound inside
    // the other branch's Let chain.
    //
    // Note: no explicit `return x` after the while — the while expression itself
    // is the function's return value (the __last accumulator when the condition
    // becomes false).
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        while (x < 3) {
          if (x === 1) {
            x = x + 2;
          } else {
            x = x + 1;
          }
        }
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(3);
    }
  });
});

describe("nested block continuation executes exactly once", () => {
  it("statements after a nested block inside a branch run exactly once", function* () {
    // When a nested block is embedded in a statement list that has a terminal
    // continuation, the block's result already contains that continuation. The
    // outer list must return the block result directly rather than wrapping it in
    // another Let(..., rest()), which would invoke the continuation twice.
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        if (true) {
          {
            x = 1;
          }
          x = x + 1;
        }
        return x;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(2);
    }
  });
});

describe("post-loop carried state is visible after loop exits", () => {
  it("single loop-carried variable is rebound in outer scope", function* () {
    // The loop Fn executes in its own SSA scope. After it returns, the outer
    // scope must destructure the result struct and rebind each loop-carried
    // variable to its final value before the continuation runs.
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        while (x < 3) { x = x + 1; }
        return x;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(3);
    }
  });

  it("all loop-carried variables are rebound when multiple vars are updated", function* () {
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        let y = 10;
        while (x < 3) {
          x = x + 1;
          y = y + 2;
        }
        return y;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(16);
    }
  });

  it("carried variable updated through if/else body is correctly rebound", function* () {
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        while (x < 5) {
          if (x < 3) { x = x + 1; } else { x = x + 2; }
        }
        return x;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(5);
    }
  });
});

describe("early return from while loop bypasses post-loop continuation", () => {
  it("early return short-circuits following statements when loop has no carried vars", function* () {
    // An early return inside the loop must propagate as the function's return
    // value. The post-loop continuation must not execute.
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 1;
        while (x > 0) {
          return x;
        }
        return 0;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(1);
    }
  });

  it("early return value is the function result when the loop is the last statement", function* () {
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        while (x < 10) {
          if (x === 5) return x;
          x = x + 1;
        }
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(5);
    }
  });

  it("early return short-circuits post-loop code even when the loop has carried vars", function* () {
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        while (x < 10) {
          if (x === 5) return x;
          x = x + 1;
        }
        return x;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(5);
    }
  });

  it("while(true): early return value is the function result when loop is last", function* () {
    // For while(true) with carried vars, the loop Fn has no last-body accumulator
    // param (no condition-false exit). The early return value must still be
    // correctly extracted from the packed result struct.
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        while (true) {
          if (x === 3) return x;
          x = x + 1;
        }
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(3);
    }
  });

  it("while(true): early return short-circuits following statements when loop has carried vars", function* () {
    // For while(true), needsPack must be true whenever the caller needs to
    // dispatch on the exit path, even though lastParamName is null (no
    // condition-false exit). The __tag dispatch must prevent rest() from running.
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let x = 0;
        while (true) {
          if (x === 1) return x;
          x = x + 1;
        }
        return x;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(1);
    }
  });
});

// ── Return-in-try runtime integration tests (§6.7.1) ──

describe("Return-in-try: C — Dispatch behavior", () => {
  it("C01: return suppresses post-try continuation", function* () {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        try { return 1; } catch (e) { /* fallthrough */ }
        return 99;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(1);
    }
  });

  it("C02: fallthrough continues post-try execution", function* () {
    const ir = compileOne(`
      function* f(): Workflow<string> {
        try { const x = 1; } catch (e) { return "caught"; }
        return "continued";
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe("continued");
    }
  });

  it("C03: fallthrough extracts join vars before rest", function* () {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        let x = 0;
        try { x = 1; } catch (e) { x = 2; return x; }
        return x;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe(1);
    }
  });
});

describe("Return-in-try: D — Finally interaction (runtime)", () => {
  it("D02: finally throw overrides packed return outcome", function* () {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        try { return 1; } catch (e) { /* fallthrough */ } finally { throw new Error("fail"); }
        return 0;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("err");
    if (result.status === "err") {
      expect(result.error.message).toBe("fail");
    }
  });
});

describe("Return-in-try: E — SSA join propagation", () => {
  it("E01: body assigns and returns — fallthrough sees post-join x", function* () {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        let x = 0;
        try { x = 1; return x; } catch (e) { x = 2; }
        return x;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      // Body returns 1 on success path
      expect(result.value).toBe(1);
    }
  });

  it("E02: catch assigns and returns — body fallthrough sees post-join x", function* () {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        let x = 0;
        try { x = 1; } catch (e) { x = 2; return x; }
        return x;
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      // Body falls through with x=1, join extracts x=1, returns x=1
      expect(result.value).toBe(1);
    }
  });

  it("E04: return value independent of join vars", function* () {
    const ir = compileOne(`
      function* f(): Workflow<string> {
        let x = 0;
        try { x = 1; return "hello"; } catch (e) { x = 2; }
        return "world";
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toBe("hello");
    }
  });
});

// ── Scope teardown across while-loop iterations ──

describe("compileOne with scoped()", () => {
  it("compiles and executes a minimal scoped block via compileOne()", function* () {
    // Regression: compileOne() was not passing a contracts map to createContext(),
    // causing emitScoped to throw S0 even for valid authored scoped() usage.
    // This test must use compileOne() directly — not generateWorkflowModule().
    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        return yield* scoped(function* () {
          yield* Effects.around({
            *dispatch([id, data], next) {
              return 42;
            },
          });
          return yield* sleep(1);
        });
      }
    `);
    const { result } = yield* execute({ ir: Call(ir) });
    // The Effects.around handler intercepts the sleep dispatch and returns 42.
    expect(result).toEqual({ status: "ok", value: 42 });
  });
});

describe("scope teardown across while-loop iterations", () => {
  it("each scoped() iteration installs a fresh handler and tears it down on exit", function* () {
    // Each scope installs an Effects.around handler (compiled to a FnNode) via
    // installEnforcement, which sets EnforcementContext for that Effection scope.
    // orchestrateScope wraps each body inside Effection's scoped(), so when it
    // exits, EnforcementContext reverts to null.
    //
    // Why this detects teardown failure:
    //   After the while loop, `yield* sleep(5)` fires dispatch("sleep", [5]).
    //   With correct teardown: EnforcementContext is null → Effects chain → throws
    //   "No agent registered" → catch block returns "clean".
    //   If scoped() were removed from orchestrateScope: iter 2's handler (returns 100)
    //   would remain set → sleep(5) returns 100 → try returns 100, not "clean".
    //
    // The handler returns a constant (100) rather than data+1 because sleep passes
    // data as an array [ms], not a scalar, so arithmetic on raw data would fail.
    // The constant-return approach is sufficient: "clean" vs 100 is unambiguous.
    //
    // Per-iteration assertions (nice-to-have):
    //   The journal must have exactly two child Close events with IDs "root.0" and
    //   "root.1", proving each loop iteration created a distinct Tisyn scope.

    const ir = compileOne(`
      function* test(): Workflow<unknown> {
        let i = 0;
        while (i < 2) {
          yield* scoped(function* () {
            yield* Effects.around({
              *dispatch([id, data], next) {
                return 100;
              }
            });
            return yield* sleep(10);
          });
          i = i + 1;
        }
        try {
          return yield* sleep(5);
        } catch (e) {
          return "clean";
        }
      }
    `);
    const { result, journal } = yield* execute({ ir: Call(ir) });

    // Main assertion: enforcement was torn down after the loop.
    // With correct teardown: sleep(5) throws → catch returns "clean".
    // With leaked enforcement (no scoped()): sleep(5) returns 100 → try returns 100.
    expect(result).toEqual({ status: "ok", value: "clean" });

    // Structural assertion: two distinct child scope IDs were produced.
    const scopeCloses = journal.filter(
      (e) => e.type === "close" && (e as any).coroutineId !== "root",
    );
    expect(scopeCloses.map((e) => (e as any).coroutineId)).toEqual(["root.0", "root.1"]);
  });
});
