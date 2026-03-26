import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("@tisyn/ir boundary", () => {
  it("has zero dependencies in package.json", async () => {
    const pkg = JSON.parse(await readFile(resolve(__dirname, "../package.json"), "utf-8"));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });
});
