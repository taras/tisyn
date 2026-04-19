/**
 * Export-surface regression for @tisyn/runtime (Issue #113 CP-009).
 *
 * `DispatchContext` used to live on `packages/runtime/src/dispatch-context.ts`
 * as a duplicate of the seam declared in `@tisyn/agent`. Issue #113 consolidates
 * it into `@tisyn/effects/internal`. This test pins that `DispatchContext`
 * must NOT be reachable from the @tisyn/runtime primary barrel.
 */
import { describe, it, expect } from "vitest";
import * as runtime from "./index.js";

describe("@tisyn/runtime — package exports", () => {
  it("does not export DispatchContext from the primary barrel", () => {
    const names = Object.keys(runtime);
    expect(names).not.toContain("DispatchContext");
  });
});
