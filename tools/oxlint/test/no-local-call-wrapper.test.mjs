import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const configPath = resolve(__dirname, "oxlint-test-config.mjs");
const fixture = (name) => resolve(__dirname, "fixtures", name);

async function runOxlint(file) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "pnpm",
      ["exec", "oxlint", "-c", configPath, "-f", "json", file],
      { cwd: repoRoot },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

function parseDiagnostics(stdout) {
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : (parsed.diagnostics ?? []);
}

test("flags same-file helper wrapped in call()", async () => {
  const result = await runOxlint(fixture("invalid-local-helper.ts"));
  assert.notEqual(result.code, 0);

  const diagnostics = parseDiagnostics(result.stdout);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "tisyn(no-local-call-wrapper)");
  assert.match(
    diagnostics[0]?.message ?? "",
    /Local helper 'loadDescriptorModule' wrapped in call\(\)/,
  );
});

test("flags same-file helper used inside a member-call wrapper", async () => {
  const result = await runOxlint(fixture("invalid-local-helper-member.ts"));
  assert.notEqual(result.code, 0);

  const diagnostics = parseDiagnostics(result.stdout);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "tisyn(no-local-call-wrapper)");
  assert.match(diagnostics[0]?.message ?? "", /Local helper 'activePage' wrapped in call\(\)/);
});

test("allows imported helper wrapped in call()", async () => {
  const result = await runOxlint(fixture("valid-imported-helper.ts"));
  assert.equal(result.code, 0);
  assert.deepEqual(parseDiagnostics(result.stdout), []);
});

test("allows imported helper in block-body callback", async () => {
  const result = await runOxlint(fixture("valid-imported-helper-return.ts"));
  assert.equal(result.code, 0);
  assert.deepEqual(parseDiagnostics(result.stdout), []);
});

test("allows direct import() promise boundary", async () => {
  const result = await runOxlint(fixture("valid-import-expression.ts"));
  assert.equal(result.code, 0);
  assert.deepEqual(parseDiagnostics(result.stdout), []);
});
