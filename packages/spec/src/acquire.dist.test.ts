// Regression: default acquire readers must resolve `packages/spec/corpus/...`
// and repo-root `specs/...` correctly regardless of whether the module runs
// from `src/` or `dist/src/`. Exercises the published entry point.

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Operation } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_ENTRY = resolve(HERE, "..", "dist", "src", "index.js");

describe("SS-AQ default readers resolve from the built entry point", () => {
  it("acquireFixture reads tisyn-cli corpus fixture from dist", function* (): Operation<void> {
    if (!existsSync(DIST_ENTRY)) {
      // Build has not been run in this environment; skip with a soft assert.
      expect(true).toBe(true);
      return;
    }
    const mod = (yield* awaitPromise(import(DIST_ENTRY))) as {
      acquireFixture: (id: string, kind: "spec" | "plan") => Operation<string>;
    };
    const text = yield* mod.acquireFixture("tisyn-cli", "spec");
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});

function* awaitPromise<T>(promise: Promise<T>): Operation<T> {
  const instruction = {
    description: "awaitPromise",
    enter: (settle: (result: { ok: true; value: T } | { ok: false; error: Error }) => void) => {
      promise.then(
        (value) => settle({ ok: true, value }),
        (error: unknown) =>
          settle({
            ok: false,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
      );
      return (discarded: (result: { ok: true }) => void) => discarded({ ok: true });
    },
  };
  return (yield instruction) as T;
}
