/**
 * Nested-invocation package tests (Issue #113).
 *
 *  - T1-NI-PKG-02 (Tier 1, regression): `instanceof` against each
 *    InvalidInvoke*Error class succeeds whether the class reference
 *    comes from `@tisyn/effects` primary or the `@tisyn/agent` compat
 *    re-export. Guards against re-declaration of error classes.
 *
 *  - T2-NI-IMP-01 (Tier 2): every moved primary-barrel symbol is
 *    importable from `@tisyn/effects` at runtime.
 *
 *  - T2-NI-IMP-02 (Tier 2): during the compat window, `@tisyn/agent`
 *    re-exports are identity-equal to `@tisyn/effects` originals. A
 *    `COMPAT_SHIM_ACTIVE` flag lets PR 4 flip the expected outcome to
 *    "absent from `@tisyn/agent`" without rewriting the test.
 */
import { describe, it, expect } from "vitest";

import * as effectsBarrel from "@tisyn/effects";
import * as agentBarrel from "@tisyn/agent";

/**
 * Compat-sense flag. Set to `true` while the `@tisyn/agent` re-exports
 * are live (PRs 1–3). PR 4 sets this to `false` and the block below
 * flips to asserting absence.
 */
const COMPAT_SHIM_ACTIVE = true;

const MOVED_PRIMARY_SYMBOLS = [
  "Effects",
  "dispatch",
  "resolve",
  "invoke",
  "installCrossBoundaryMiddleware",
  "getCrossBoundaryMiddleware",
  "InvalidInvokeCallSiteError",
  "InvalidInvokeInputError",
  "InvalidInvokeOptionError",
] as const;

describe("nested-invocation — package surface", () => {
  describe("T1-NI-PKG-02 — error-class identity across compat boundary", () => {
    it("InvalidInvokeCallSiteError: one class, reachable from both paths", () => {
      const fromEffects = effectsBarrel.InvalidInvokeCallSiteError;
      const fromAgent = (agentBarrel as unknown as Record<string, unknown>)
        .InvalidInvokeCallSiteError;
      if (COMPAT_SHIM_ACTIVE) {
        expect(fromAgent).toBe(fromEffects);
        const inst = new fromEffects("x");
        expect(inst).toBeInstanceOf(fromEffects);
        expect(inst).toBeInstanceOf(fromAgent as new (m: string) => Error);
      } else {
        expect(fromAgent).toBeUndefined();
      }
    });

    it("InvalidInvokeInputError: one class, reachable from both paths", () => {
      const fromEffects = effectsBarrel.InvalidInvokeInputError;
      const fromAgent = (agentBarrel as unknown as Record<string, unknown>)
        .InvalidInvokeInputError;
      if (COMPAT_SHIM_ACTIVE) {
        expect(fromAgent).toBe(fromEffects);
        const inst = new fromEffects("x");
        expect(inst).toBeInstanceOf(fromEffects);
        expect(inst).toBeInstanceOf(fromAgent as new (m: string) => Error);
      } else {
        expect(fromAgent).toBeUndefined();
      }
    });

    it("InvalidInvokeOptionError: one class, reachable from both paths", () => {
      const fromEffects = effectsBarrel.InvalidInvokeOptionError;
      const fromAgent = (agentBarrel as unknown as Record<string, unknown>)
        .InvalidInvokeOptionError;
      if (COMPAT_SHIM_ACTIVE) {
        expect(fromAgent).toBe(fromEffects);
        const inst = new fromEffects("x");
        expect(inst).toBeInstanceOf(fromEffects);
        expect(inst).toBeInstanceOf(fromAgent as new (m: string) => Error);
      } else {
        expect(fromAgent).toBeUndefined();
      }
    });
  });

  describe("T2-NI-IMP-01 — moved symbols importable from @tisyn/effects", () => {
    for (const name of MOVED_PRIMARY_SYMBOLS) {
      it(`${name} is exported at runtime`, () => {
        const v = (effectsBarrel as unknown as Record<string, unknown>)[name];
        expect(v, name).toBeDefined();
      });
    }
  });

  describe("T2-NI-IMP-02 — @tisyn/agent re-exports identity during compat", () => {
    for (const name of MOVED_PRIMARY_SYMBOLS) {
      it(`${name}: @tisyn/agent re-export matches @tisyn/effects original`, () => {
        const fromEffects = (effectsBarrel as unknown as Record<string, unknown>)[name];
        const fromAgent = (agentBarrel as unknown as Record<string, unknown>)[name];
        if (COMPAT_SHIM_ACTIVE) {
          expect(fromAgent, `@tisyn/agent should re-export ${name}`).toBe(fromEffects);
        } else {
          expect(fromAgent, `@tisyn/agent should no longer export ${name}`).toBeUndefined();
        }
      });
    }
  });
});
