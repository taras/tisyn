/**
 * Quoted-payload regression test.
 *
 * Verifies that nested Eval/Ref nodes inside quoted standard external
 * effect data are preserved as inert data — not dispatched or resolved.
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { execute } from "./execute.js";
import { Effects } from "@tisyn/agent";
import type { Val } from "@tisyn/ir";

// ── IR helpers ──

function Q(expr: unknown) {
  return { tisyn: "quote" as const, expr };
}

function Eval(id: string, data: unknown) {
  return { tisyn: "eval" as const, id, data };
}

// ── Tests ──

describe("Quoted payload in standard external effects", () => {
  it("nested Eval inside quoted data is not dispatched", function* () {
    const dispatched: string[] = [];
    const receivedData: Val[] = [];

    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([effectId, data]: [string, Val]) {
        dispatched.push(effectId);
        receivedData.push(data);
        return null;
      },
    });

    // outer-effect receives quoted data containing a nested Eval node
    const ir = Eval(
      "outer-effect",
      Q({ nested: Eval("inner-effect", Q({ value: 42 })) }),
    );

    const { result } = yield* execute({ ir: ir as never });

    expect(result.status).toBe("ok");
    // Only outer-effect should be dispatched
    expect(dispatched).toEqual(["outer-effect"]);
    // The outer effect's data should contain the nested Eval as inert structure
    expect(receivedData[0]).toEqual({
      nested: { tisyn: "eval", id: "inner-effect", data: { tisyn: "quote", expr: { value: 42 } } },
    });
  });

  it("nested Ref inside quoted data is not resolved", function* () {
    const dispatched: string[] = [];
    const receivedData: Val[] = [];

    yield* Effects.around({
      // biome-ignore lint/correctness/useYield: mock
      *dispatch([effectId, data]: [string, Val]) {
        dispatched.push(effectId);
        receivedData.push(data);
        return null;
      },
    });

    const ir = Eval(
      "outer-effect",
      Q({ ref: { tisyn: "ref", name: "x" } }),
    );

    const { result } = yield* execute({ ir: ir as never });

    expect(result.status).toBe("ok");
    expect(dispatched).toEqual(["outer-effect"]);
    // The Ref node must be preserved as data, not resolved
    expect(receivedData[0]).toEqual({
      ref: { tisyn: "ref", name: "x" },
    });
  });
});
