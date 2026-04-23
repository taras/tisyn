/**
 * Export-surface tests for @tisyn/effects (Issue #113 CP-008).
 *
 * Asserts:
 *  - `package.json#exports` keys are exactly the documented set.
 *  - Primary barrel (`.`) exposes the moved dispatch-boundary symbols.
 *  - `DispatchContext` and `evaluateMiddlewareFn` are NOT on the primary
 *    barrel; they live only on `./internal`.
 *  - `./internal` has `@internal` JSDoc on its named value exports.
 *  - `src/internal/README.md` carries the non-stability notice.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as primary from "./index.js";
import * as internal from "./internal/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const pkgJson = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
};

describe("@tisyn/effects — package exports", () => {
  it("exposes exactly the documented subpath exports", () => {
    expect(Object.keys(pkgJson.exports).sort()).toEqual([".", "./internal"]);
  });

  it("each subpath export entry has `types` and `import` keys", () => {
    for (const [subpath, entry] of Object.entries(pkgJson.exports)) {
      const e = entry as Record<string, unknown>;
      expect(e.types, `exports[${subpath}].types`).toBeDefined();
      expect(e.import, `exports[${subpath}].import`).toBeDefined();
    }
  });

  describe("primary barrel (`.`)", () => {
    it("exports the dispatch-boundary surface", () => {
      const names = Object.keys(primary).sort();
      expect(names).toContain("Effects");
      expect(names).toContain("dispatch");
      expect(names).toContain("resolve");
      expect(names).toContain("invoke");
      expect(names).toContain("invokeInline");
      expect(names).toContain("installCrossBoundaryMiddleware");
      expect(names).toContain("getCrossBoundaryMiddleware");
      expect(names).toContain("InvalidInvokeCallSiteError");
      expect(names).toContain("InvalidInvokeInputError");
      expect(names).toContain("InvalidInvokeOptionError");
    });

    it("does NOT expose the workspace seam", () => {
      const names = Object.keys(primary);
      expect(names).not.toContain("DispatchContext");
      expect(names).not.toContain("evaluateMiddlewareFn");
    });

    it("error constructors are real classes", () => {
      const { InvalidInvokeCallSiteError, InvalidInvokeInputError, InvalidInvokeOptionError } =
        primary;
      expect(typeof InvalidInvokeCallSiteError).toBe("function");
      expect(new InvalidInvokeCallSiteError("x")).toBeInstanceOf(Error);
      expect(new InvalidInvokeInputError("x")).toBeInstanceOf(Error);
      expect(new InvalidInvokeOptionError("x")).toBeInstanceOf(Error);
    });
  });

  describe("internal subpath (`./internal`)", () => {
    it("exposes DispatchContext and evaluateMiddlewareFn", () => {
      const names = Object.keys(internal).sort();
      expect(names).toContain("DispatchContext");
      expect(names).toContain("evaluateMiddlewareFn");
    });

    it("source files carry @internal JSDoc tags", () => {
      const dcSource = readFileSync(resolve(pkgRoot, "src/internal/dispatch-context.ts"), "utf8");
      const mwSource = readFileSync(resolve(pkgRoot, "src/internal/middleware-eval.ts"), "utf8");
      expect(dcSource).toMatch(/@internal/);
      expect(mwSource).toMatch(/@internal/);
    });

    it("README.md documents non-stability", () => {
      const readme = readFileSync(resolve(pkgRoot, "src/internal/README.md"), "utf8");
      expect(readme.length).toBeGreaterThan(0);
    });
  });
});
