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
