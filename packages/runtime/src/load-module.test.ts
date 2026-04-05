import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { call } from "effection";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadModule,
  isTypeScriptFile,
  UnsupportedExtensionError,
  ModuleNotFoundError,
} from "./load-module.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tisyn-loader-test-"));
}

describe("shared module loader", () => {
  it("loads .js module", function* () {
    const dir = yield* call(makeTempDir);
    const filePath = join(dir, "test.mjs");
    yield* call(() => writeFile(filePath, 'export default { hello: "world" };'));
    const mod = yield* call(() => loadModule(filePath));
    expect((mod.default as Record<string, unknown>).hello).toBe("world");
  });

  it("loads .ts module", function* () {
    const dir = yield* call(makeTempDir);
    const filePath = join(dir, "test.ts");
    yield* call(() =>
      writeFile(filePath, 'const x: string = "hello"; export default { x };'),
    );
    const mod = yield* call(() => loadModule(filePath));
    expect((mod.default as Record<string, unknown>).x).toBe("hello");
  });

  it("rejects unsupported extension", function* () {
    const dir = yield* call(makeTempDir);
    const filePath = join(dir, "test.tsx");
    yield* call(() => writeFile(filePath, "export default {};"));
    let threw = false;
    try {
      yield* call(() => loadModule(filePath));
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(UnsupportedExtensionError);
      expect((err as Error).message).toContain("Unsupported");
    }
    expect(threw).toBe(true);
  });

  it("reports not found for missing file", function* () {
    let threw = false;
    try {
      yield* call(() => loadModule("/tmp/nonexistent-runtime-test-xyz.ts"));
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ModuleNotFoundError);
      expect((err as Error).message).toContain("not found");
    }
    expect(threw).toBe(true);
  });

  it("classifies TypeScript and JavaScript extensions", function* () {
    expect(isTypeScriptFile("foo.ts")).toBe(true);
    expect(isTypeScriptFile("foo.mts")).toBe(true);
    expect(isTypeScriptFile("foo.cts")).toBe(true);
    expect(isTypeScriptFile("foo.js")).toBe(false);
    expect(isTypeScriptFile("foo.mjs")).toBe(false);
    expect(isTypeScriptFile("foo.cjs")).toBe(false);
  });
});
