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

describe("Bug 1 — while loop __last accumulator", () => {
  it("returns the last body result when the condition becomes false", function* () {
    // Before the fix: emitLoopBody emitted If(cond, body) with no else branch,
    // so the loop expression evaluated to null when cond became false.
    // After the fix: If(cond, body, Ref(__last)) propagates the last computed value.
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

describe("Bug 2 — nested if SSA join inside branch compilation", () => {
  it("produces the post-join value for a variable reassigned in a nested if", function* () {
    // Before the fix: emitIfStatementInList "neither terminates" path compiled the
    // inner if using emitStatementBodyWithCtx (no join synthesis), so the join
    // expression for x evaluated to null instead of 5.
    // After the fix: SSA join synthesis is applied, producing the correct join value.
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

describe("Bug 4 — asymmetric branch SSA version leak in emitIfStatementInList", () => {
  it("thenTerminates && !elseTerminates: fallthrough does not reference unbound version", function* () {
    // Before the fix: compiling the terminating then-branch against the shared ctx
    // bumped x to x_1 in ctx. The else/fallthrough was then compiled against that
    // mutated ctx and emitted Ref("x_1"), which is only bound inside the then-branch
    // Let chain — causing an "Unbound variable" runtime error.
    // After the fix: the then-branch is compiled in a cloned context so ctx is
    // unchanged when the else/fallthrough is compiled.
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

  it("!thenTerminates && elseTerminates: terminating else does not see then's bumped versions", function* () {
    // Before the fix: then-branch (falling-through) was compiled first, bumping x to
    // x_1. The terminating else was then compiled against that mutated ctx and
    // referenced Ref("x_1") — only bound in the then Let chain — causing an
    // "Unbound variable" runtime error when the else branch was taken.
    // After the fix: elseCtx is cloned from the pre-then ctx so the else branch
    // always sees the original x_0.
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

describe("Bug 5 — loop if with per-branch SSA isolation", () => {
  it("if/else inside while loop does not reference versions from the other branch", function* () {
    // Before the fix: emitLoopIfStatement compiled the then-branch against the shared
    // ctx (bumping x to x_1), then compiled the else-branch against the same mutated
    // ctx. The else-branch emitted Ref("x_1") — only bound in the then Let chain —
    // causing an "Unbound variable" runtime error when the else branch executed.
    // After the fix: each branch is compiled in a cloned context with the remaining
    // loop body inlined, so both branches independently track SSA versions.
    // Note: no explicit `return x` after the while — the while expression itself
    // is the function's return value (the last_N accumulator when the condition
    // becomes false). Adding `return x` would return the outer x_0 = 0 instead.
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

describe("Bug 6 — nested block continuation duplicated in emitStatementListWithTerminal", () => {
  it("continuation after a nested block executes exactly once", function* () {
    // Before the fix: emitStatementListWithTerminal compiled a nested block with
    // `rest` as the terminal (so blockResult already ended with rest()), then wrapped
    // it in Let(discard, blockResult, rest()) — calling rest() a second time. Any
    // branch path with a nested block followed by more statements would therefore
    // execute the suffix twice.
    // After the fix: blockResult is returned directly; the embedded terminal already
    // provides the single continuation.
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

describe("Bug 7 — post-loop carried state rebinding: single var", () => {
  it("outer scope sees the final loop value after loop exits", function* () {
    // Before the fix: the loop Fn returned the last body result (x_N) but never
    // rebound the outer SSA name. The outer `return x` emitted Ref("x_0") = 0.
    // After the fix: the loop result struct is destructured and x is rebound in
    // the outer scope before the continuation runs.
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
});

describe("Bug 7 — post-loop carried state rebinding: multiple vars", () => {
  it("all loop-carried vars are rebound in outer scope after loop exits", function* () {
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
});

describe("Bug 7 — post-loop carried state rebinding: if/else body", () => {
  it("carried var updated through if/else inside loop is rebound after loop exits", function* () {
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

describe("Bug 7 — early return with no loop-carried vars, not last statement", () => {
  it("early return short-circuits post-loop continuation (Bug B)", function* () {
    // Before the fix: the loop result was discarded and rest() always ran.
    // When x > 0 was true on the first iteration, `return x` fired but the
    // outer code discarded it and executed `return 0` instead.
    // After the fix: the __tag dispatch short-circuits rest() on early return.
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
});

describe("Bug 7 — early return inside loop, loop is last statement", () => {
  it("early return value is the function result when loop is last", function* () {
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
});

describe("Bug 7 — early return with carried vars, not last statement", () => {
  it("early return short-circuits post-loop code even when loop has carried vars", function* () {
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
});

describe("Bug 7 — while(true) early return, loop is last statement", () => {
  it("early return value propagates as function result", function* () {
    // Before the fix: while(true) set lastParamName=null → needsPack=false → early
    // return was a raw scalar. For isLast the scalar happened to be the right value,
    // but when loop has carried vars the outer code tried Get(scalar,"x") → undefined.
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
});

describe("Bug 7 — while(true) early return, not last statement (user example)", () => {
  it("early return short-circuits post-loop code in while(true) with carried vars", function* () {
    // Before the fix: needsPack was false for while(true) (lastParamName===null).
    // For !isLast with carried vars the outer code went into the rebind branch and
    // called Get(scalar,"x") on the raw early-return value → undefined.
    // After the fix: needsPack = hasReturn regardless of lastParamName, so early
    // returns are tagged structs and the __tag dispatch short-circuits rest().
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
