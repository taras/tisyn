#!/usr/bin/env node
/**
 * Mock `codex exec --json` subprocess for testing.
 *
 * Receives args as: exec --json <prompt>
 * Emits NDJSON events on stdout.
 *
 * Special prompts:
 *   "EXIT_ERROR" — exits with code 1 and stderr content
 *   "MULTI_PROGRESS" — emits 3 progress events before result
 */

const args = process.argv.slice(2);
// Find prompt: after "exec" and "--json"
const execIdx = args.indexOf("exec");
const jsonIdx = args.indexOf("--json");
const promptIdx = Math.max(execIdx, jsonIdx) + 1;
const prompt = promptIdx < args.length ? args[promptIdx] : args[args.length - 1] || "";

if (prompt === "EXIT_ERROR") {
  process.stderr.write("codex: model not found\n");
  process.exitCode = 1;
} else if (prompt === "MULTI_PROGRESS") {
  process.stdout.write(JSON.stringify({ type: "progress", content: "Step 1..." }) + "\n");
  process.stdout.write(JSON.stringify({ type: "progress", content: "Step 2..." }) + "\n");
  process.stdout.write(JSON.stringify({ type: "progress", content: "Step 3..." }) + "\n");
  process.stdout.write(JSON.stringify({ response: "multi-progress result" }) + "\n");
} else {
  process.stdout.write(JSON.stringify({ type: "progress", content: "Working..." }) + "\n");
  process.stdout.write(JSON.stringify({ response: `mock result for: ${prompt}` }) + "\n");
}
