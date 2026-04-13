/**
 * Mock `codex exec --json` subprocess for testing.
 *
 * Reads the prompt from argv (after --json flag) and emits NDJSON
 * events on stdout: one progress event, then one final result event.
 *
 * Usage:
 *   node mock-codex-exec.js exec --json "the prompt text"
 *
 * Special prompts:
 *   "EXIT_ERROR" — exits with code 1 and stderr content
 *   "MULTI_PROGRESS" — emits 3 progress events before result
 */

// Skip "exec" and "--json" args to find the prompt
const args = process.argv.slice(2);
const jsonIdx = args.indexOf("--json");
const prompt =
  jsonIdx >= 0 && args.length > jsonIdx + 1 ? args[jsonIdx + 1] : (args[args.length - 1] ?? "");

if (prompt === "EXIT_ERROR") {
  process.stderr.write("codex: model not found\n");
  process.exitCode = 1;
} else if (prompt === "MULTI_PROGRESS") {
  // Emit multiple progress events then final result
  process.stdout.write(JSON.stringify({ type: "progress", content: "Step 1..." }) + "\n");
  process.stdout.write(JSON.stringify({ type: "progress", content: "Step 2..." }) + "\n");
  process.stdout.write(JSON.stringify({ type: "progress", content: "Step 3..." }) + "\n");
  process.stdout.write(JSON.stringify({ response: "multi-progress result" }) + "\n");
} else {
  // Normal: one progress event, one final result
  process.stdout.write(JSON.stringify({ type: "progress", content: "Working..." }) + "\n");
  process.stdout.write(JSON.stringify({ response: `mock result for: ${prompt}` }) + "\n");
}
