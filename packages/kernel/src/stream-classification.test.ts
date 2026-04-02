/**
 * SI-K-001 through SI-K-005: Kernel non-change verification for stream effects.
 *
 * Confirms that stream.subscribe and stream.next are classified as standard
 * external effects with no kernel code changes required.
 */

import { describe, it, expect } from "vitest";
import { classify, isCompoundExternal } from "./classify.js";
import { evaluate } from "./eval.js";
import { extend, EMPTY_ENV } from "./environment.js";
import type { TisynExpr as Expr, Val } from "@tisyn/ir";
import type { EffectDescriptor } from "./events.js";

// ── IR helpers (plain objects, no build deps) ──

function Ref(name: string) {
  return { tisyn: "ref" as const, name };
}

function ExternalEval(id: string, data: unknown) {
  return { tisyn: "eval" as const, id, data };
}

describe("stream effect classification", () => {
  it("SI-K-001: classify('stream.subscribe') returns EXTERNAL", () => {
    expect(classify("stream.subscribe")).toBe("EXTERNAL");
  });

  it("SI-K-002: classify('stream.next') returns EXTERNAL", () => {
    expect(classify("stream.next")).toBe("EXTERNAL");
  });

  it("SI-K-003: isCompoundExternal('stream.subscribe') returns false", () => {
    expect(isCompoundExternal("stream.subscribe")).toBe(false);
  });

  it("SI-K-004: isCompoundExternal('stream.next') returns false", () => {
    expect(isCompoundExternal("stream.next")).toBe(false);
  });

  it("SI-K-005: kernel uses resolve path — yielded descriptor has fully-resolved data", () => {
    // Build IR: Eval("stream.next", [Ref("sub")])
    // The Ref("sub") must be resolved to the env value, not left as a Ref node.
    const subHandle = { __tisyn_subscription: "sub:root:0" };
    const env = extend(EMPTY_ENV, "sub", subHandle as unknown as Val);
    const ir = ExternalEval("stream.next", [Ref("sub")]);

    const gen = evaluate(ir as unknown as Expr, env);
    const result = gen.next();

    // Should yield (not return) an EffectDescriptor
    expect(result.done).toBe(false);

    const descriptor = result.value as EffectDescriptor;
    expect(descriptor.id).toBe("stream.next");
    // Data should be the fully-resolved array [subHandle], not [Ref("sub")]
    expect(descriptor.data).toEqual([subHandle]);
  });
});
