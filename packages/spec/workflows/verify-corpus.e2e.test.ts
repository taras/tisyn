// End-to-end smoke test for the corpus verification pipeline. Invokes
// the real CLI binary on the real descriptor with `--target tisyn-cli`
// and asserts the acceptance rule for both the default path (memory
// journal, no filesystem side effects) and the `debug` entrypoint
// (file-backed NDJSON journal). No mocks, no stubs — this is the
// authoritative integration check and the only place the full
// `tsn run` compile-on-the-fly path is exercised in the test suite.
//
// Hermeticity. Both cases remove any pre-existing journal file at
// `packages/spec/workflows/.debug/verify-corpus.ndjson` before
// spawning the CLI. The default case relies on that to prove the
// file is never created; the debug case relies on it so parse
// assertions only see events this run produced. Test ordering
// must not matter — both cases remove the file up front.
//
// The `tsn` bin is not on the workspace `$PATH` from package scripts,
// so we invoke the built CLI through `node packages/cli/dist/cli.js`
// directly. CWD is the monorepo root so the CLI's descriptor path
// argument resolves against the same tree the developer uses.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DurableEvent } from "@tisyn/kernel";

const repoRoot = resolve(import.meta.dirname, "../../..");
const cliPath = resolve(repoRoot, "packages/cli/dist/cli.js");
const descriptorPath = "packages/spec/workflows/verify-corpus.ts";
const descriptorDir = resolve(repoRoot, "packages/spec/workflows");
const debugJournalPath = resolve(descriptorDir, ".debug/verify-corpus.ndjson");

describe("verify-corpus e2e", () => {
  it("default path (--target tisyn-cli --skip-claude) is memory-backed — no journal file written", () => {
    rmSync(debugJournalPath, { force: true });
    const stdout = execFileSync(
      process.execPath,
      [cliPath, "run", descriptorPath, "--target", "tisyn-cli", "--skip-claude"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(stdout).toContain("── journal ──");
    expect(stdout).toContain("In-memory journal");
    expect(stdout).toContain("Replay is DISABLED");
    expect(stdout).toContain("── skip-claude ──");
    expect(stdout).toContain("── compare:spec ──");
    expect(stdout).toContain("── compare:plan ──");
    expect(existsSync(debugJournalPath)).toBe(false);
  });

  it("debug entrypoint (-e debug) writes an NDJSON journal with a terminating close event", () => {
    rmSync(debugJournalPath, { force: true });
    try {
      const stdout = execFileSync(
        process.execPath,
        [cliPath, "run", descriptorPath, "-e", "debug", "--target", "tisyn-cli", "--skip-claude"],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(stdout).toContain("── journal ──");
      expect(stdout).toContain("File-backed journal at ");
      expect(stdout).toContain(debugJournalPath);
      expect(stdout).toContain("Replay is ENABLED");
      expect(stdout).toContain("── skip-claude ──");

      expect(existsSync(debugJournalPath)).toBe(true);
      const content = readFileSync(debugJournalPath, "utf8");
      const lines = content.split("\n").filter((line) => line !== "");
      expect(lines.length).toBeGreaterThan(0);
      const events: DurableEvent[] = lines.map((line) => JSON.parse(line) as DurableEvent);
      for (const event of events) {
        expect(["yield", "close"]).toContain(event.type);
      }
      const last = events[events.length - 1]!;
      expect(last.type).toBe("close");
    } finally {
      rmSync(debugJournalPath, { force: true });
    }
  });
});
