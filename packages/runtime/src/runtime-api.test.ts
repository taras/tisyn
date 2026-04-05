import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { call, scoped } from "effection";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Runtime } from "./runtime-api.js";
import { ModuleLoadError } from "./load-module.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tisyn-runtime-api-test-"));
}

describe("Runtime.loadModule", () => {
  // ── Specifier resolution ─────────────────────────────────────────────────

  describe("specifier resolution", () => {
    it("resolves absolute filesystem path", function* () {
      const dir = yield* call(makeTempDir);
      const filePath = join(dir, "abs.mjs");
      yield* call(() => writeFile(filePath, 'export const v = "absolute";'));
      const mod = yield* Runtime.loadModule(filePath, "file:///ignored/caller.js");
      expect(mod.v).toBe("absolute");
    });

    it("resolves file: URL specifier", function* () {
      const dir = yield* call(makeTempDir);
      const filePath = join(dir, "url.mjs");
      yield* call(() => writeFile(filePath, 'export const v = "url";'));
      const fileUrl = pathToFileURL(filePath).href;
      const mod = yield* Runtime.loadModule(fileUrl, "file:///ignored/caller.js");
      expect(mod.v).toBe("url");
    });

    it("resolves relative specifier against parentURL", function* () {
      const dir = yield* call(makeTempDir);
      yield* call(() => writeFile(join(dir, "rel.mjs"), 'export const v = "relative";'));
      const parentURL = pathToFileURL(join(dir, "caller.js")).href;
      const mod = yield* Runtime.loadModule("./rel.mjs", parentURL);
      expect(mod.v).toBe("relative");
    });

    it("rejects bare specifier", function* () {
      let threw = false;
      try {
        yield* Runtime.loadModule("lodash", "file:///some/caller.js");
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(ModuleLoadError);
        expect((err as Error).message).toContain("Bare specifier");
      }
      expect(threw).toBe(true);
    });

    it("rejects relative specifier with non-file parentURL", function* () {
      let threw = false;
      try {
        yield* Runtime.loadModule("./foo.ts", "https://example.com/");
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(ModuleLoadError);
        expect((err as Error).message).toContain("not a file: URL");
      }
      expect(threw).toBe(true);
    });
  });

  // ── Middleware ────────────────────────────────────────────────────────────

  describe("middleware", () => {
    it("can observe and delegate", function* () {
      const dir = yield* call(makeTempDir);
      const filePath = join(dir, "observed.mjs");
      yield* call(() => writeFile(filePath, "export const v = 1;"));

      const log: string[] = [];
      yield* Runtime.around({
        *loadModule([spec, url]: [string, string], next) {
          log.push(spec);
          return yield* next(spec, url);
        },
      });

      yield* Runtime.loadModule(filePath, "file:///ignored.js");
      expect(log).toContain(filePath);
    });

    it("can redirect specifier", function* () {
      const dir = yield* call(makeTempDir);
      yield* call(() => writeFile(join(dir, "a.mjs"), 'export const v = "a";'));
      yield* call(() => writeFile(join(dir, "b.mjs"), 'export const v = "b";'));

      const parentURL = pathToFileURL(join(dir, "caller.js")).href;

      yield* Runtime.around({
        *loadModule([spec, url]: [string, string], next) {
          if (spec === "./a.mjs") {
            return yield* next("./b.mjs", url);
          }
          return yield* next(spec, url);
        },
      });

      const mod = yield* Runtime.loadModule("./a.mjs", parentURL);
      expect(mod.v).toBe("b");
    });

    it("can deny by throwing", function* () {
      let threw = false;
      yield* Runtime.around({
        *loadModule(_args: [string, string], _next) {
          throw new Error("denied");
        },
      });

      try {
        yield* Runtime.loadModule("/tmp/anything.mjs", "file:///ignored.js");
      } catch (err) {
        threw = true;
        expect((err as Error).message).toBe("denied");
      }
      expect(threw).toBe(true);
    });

    it("parent middleware is inherited by child scope", function* () {
      const dir = yield* call(makeTempDir);
      const filePath = join(dir, "child.mjs");
      yield* call(() => writeFile(filePath, "export const v = 1;"));

      const log: string[] = [];
      yield* Runtime.around({
        *loadModule([spec, url]: [string, string], next) {
          log.push("parent");
          return yield* next(spec, url);
        },
      });

      yield* scoped(function* () {
        yield* Runtime.loadModule(filePath, "file:///ignored.js");
      });

      expect(log).toContain("parent");
    });

    it("child middleware does not affect parent", function* () {
      const dir = yield* call(makeTempDir);
      const filePath = join(dir, "scope.mjs");
      yield* call(() => writeFile(filePath, "export const v = 1;"));

      const childLog: string[] = [];

      yield* scoped(function* () {
        yield* Runtime.around({
          *loadModule([spec, url]: [string, string], next) {
            childLog.push("child");
            return yield* next(spec, url);
          },
        });
        yield* Runtime.loadModule(filePath, "file:///ignored.js");
      });

      expect(childLog).toContain("child");
      childLog.length = 0;

      // Parent call should NOT trigger child middleware
      yield* Runtime.loadModule(filePath, "file:///ignored.js");
      expect(childLog).toHaveLength(0);
    });

    it("min/max priority ordering", function* () {
      const dir = yield* call(makeTempDir);
      const filePath = join(dir, "priority.mjs");
      yield* call(() => writeFile(filePath, "export const v = 1;"));

      const order: string[] = [];

      yield* Runtime.around(
        {
          *loadModule([spec, url]: [string, string], next) {
            order.push("min");
            return yield* next(spec, url);
          },
        },
        { at: "min" },
      );

      yield* Runtime.around({
        *loadModule([spec, url]: [string, string], next) {
          order.push("max");
          return yield* next(spec, url);
        },
      });

      yield* Runtime.loadModule(filePath, "file:///ignored.js");
      // max (outermost) runs first, then min (innermost), then core
      expect(order).toEqual(["max", "min"]);
    });
  });
});
