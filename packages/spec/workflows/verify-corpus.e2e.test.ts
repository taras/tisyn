// End-to-end smoke test for the corpus verification pipeline. Invokes
// the real CLI binary on the real descriptor with `--target tisyn-cli`
// and asserts the acceptance rule: exit 0 + the literal
// `── skip-claude ──` substring on stdout. No mocks, no stubs — this
// is the authoritative integration check and the only place the full
// `tsn run` compile-on-the-fly path is exercised in the test suite.
//
// The `tsn` bin is not on the workspace `$PATH` from package scripts,
// so we invoke the built CLI through `node packages/cli/dist/cli.js`
// directly. CWD is the monorepo root so the CLI's descriptor path
// argument resolves against the same tree the developer uses.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const cliPath = resolve(repoRoot, "packages/cli/dist/cli.js");
const descriptorPath = "packages/spec/workflows/verify-corpus.ts";

describe("verify-corpus e2e", () => {
  it("--target tisyn-cli --skip-claude exits 0 and prints the skip-claude log block", () => {
    const stdout = execFileSync(
      process.execPath,
      [cliPath, "run", descriptorPath, "--target", "tisyn-cli", "--skip-claude"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(stdout).toContain("── skip-claude ──");
    expect(stdout).toContain("── compare:spec ──");
    expect(stdout).toContain("── compare:plan ──");
  });
});
