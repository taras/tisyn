/**
 * Nested-invocation package tests (Issue #113).
 *
 *  - T2-NI-IMP-01 (Tier 2): every moved primary-barrel symbol is
 *    importable from `@tisyn/effects` at runtime.
 *
 *  - T2-NI-IMP-02 (Tier 2, hard-cut): none of the moved primary-barrel
 *    symbols are reachable through `@tisyn/agent`. Issue #113 moved
 *    this surface wholesale; `@tisyn/agent` is the authoring boundary
 *    only and must not re-export the dispatch-boundary APIs.
 *
 *  - T1-NI-PKG-02 (Tier 1, regression): each `InvalidInvoke*Error`
 *    class on `@tisyn/effects` is a real class and an `Error`
 *    subclass. This pins the class shape now that the compat-window
 *    cross-package identity check no longer applies.
 */
import { describe, it, expect } from "vitest";

import * as effectsBarrel from "@tisyn/effects";
import * as agentBarrel from "@tisyn/agent";

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

const ERROR_CLASSES = [
  "InvalidInvokeCallSiteError",
  "InvalidInvokeInputError",
  "InvalidInvokeOptionError",
] as const;

describe("nested-invocation — package surface", () => {
  describe("T2-NI-IMP-01 — moved symbols importable from @tisyn/effects", () => {
    for (const name of MOVED_PRIMARY_SYMBOLS) {
      it(`${name} is exported at runtime`, () => {
        const v = (effectsBarrel as unknown as Record<string, unknown>)[name];
        expect(v, name).toBeDefined();
      });
    }
  });

  describe("T2-NI-IMP-02 — moved symbols absent from @tisyn/agent", () => {
    for (const name of MOVED_PRIMARY_SYMBOLS) {
      it(`${name}: not reachable through @tisyn/agent`, () => {
        const v = (agentBarrel as unknown as Record<string, unknown>)[name];
        expect(v, `@tisyn/agent must not expose ${name}`).toBeUndefined();
      });
    }
  });

  describe("T1-NI-PKG-02 — InvalidInvoke*Error classes are real Error subclasses", () => {
    for (const name of ERROR_CLASSES) {
      it(`${name} is a constructor producing an Error instance`, () => {
        const Ctor = (effectsBarrel as unknown as Record<string, unknown>)[name] as
          | (new (msg: string) => Error)
          | undefined;
        expect(Ctor, name).toBeDefined();
        expect(typeof Ctor).toBe("function");
        const inst = new (Ctor as new (msg: string) => Error)("x");
        expect(inst).toBeInstanceOf(Error);
        expect(inst).toBeInstanceOf(Ctor as new (msg: string) => Error);
      });
    }
  });
});
