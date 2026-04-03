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
      [
        "exec",
        "oxlint",
        "-c",
        configPath,
        "-A",
        "all",
        "-D",
        "tisyn/no-trivial-generator-wrapper",
        "-f",
        "json",
        file,
      ],
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

test("flags trivial generator wrapper over another helper", async () => {
  const result = await runOxlint(fixture("invalid-trivial-generator-wrapper.ts"));
  assert.notEqual(result.code, 0);

  const diagnostics = parseDiagnostics(result.stdout);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "tisyn(no-trivial-generator-wrapper)");
  assert.match(diagnostics[0]?.message ?? "", /Generator 'foo' only delegates with return yield\*/);
});

test("flags trivial generator wrapper over resource()", async () => {
  const result = await runOxlint(fixture("invalid-trivial-generator-resource.ts"));
  assert.notEqual(result.code, 0);

  const diagnostics = parseDiagnostics(result.stdout);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "tisyn(no-trivial-generator-wrapper)");
});

test("flags trivial generator wrapper over call()", async () => {
  const result = await runOxlint(fixture("invalid-trivial-generator-call.ts"));
  assert.notEqual(result.code, 0);

  const diagnostics = parseDiagnostics(result.stdout);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "tisyn(no-trivial-generator-wrapper)");
});

test("allows inline generator callback passed to another API", async () => {
  const result = await runOxlint(fixture("valid-trivial-generator-inline-callback.ts"));
  assert.equal(result.code, 0);
  assert.deepEqual(parseDiagnostics(result.stdout), []);
});
