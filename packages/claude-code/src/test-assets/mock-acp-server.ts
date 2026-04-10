/**
 * Mock ACP stdio server for testing the real binding path.
 *
 * Reads NDJSON from stdin, responds on stdout. Speaks real ACP protocol
 * wire methods (not Tisyn operation names — the adapter translates).
 *
 * Supports:
 * - session/new → returns { sessionId: "test-session-1" }
 * - session/prompt → returns { response: "mock plan result" }
 * - session/close → returns null
 * - session/fork → returns fork metadata
 * - session/cancel → no response (cancellation acknowledgment)
 */
import * as readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line: string) => {
  let msg: { jsonrpc: string; id: string; method: string; params: Record<string, unknown> };
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.method === "session/cancel") {
    // Cancel is a notification in ACP — no response
    return;
  }

  // Match on real ACP wire method names. The adapter translates
  // Tisyn operation names (e.g. "newSession") to these before sending.
  let result: unknown;
  switch (msg.method) {
    case "session/new":
      result = { sessionId: "test-session-1" };
      break;
    case "session/prompt": {
      // The adapter forwards args[0] as ACP params. With wrapped shapes from
      // the compiled workflow, params is { args: { session, prompt } }.
      const params = msg.params as Record<string, unknown>;
      const args = params.args as Record<string, unknown> | undefined;
      const prompt = args?.prompt ?? params.prompt ?? "unknown";
      result = {
        response: `mock plan result for: ${prompt}`,
      };
      break;
    }
    case "session/close":
      result = null;
      break;
    case "session/fork":
      result = { parentSessionId: "test-session-1", forkId: "fork-1" };
      break;
    default:
      // Unknown method — return error
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: `Unknown method: ${msg.method}` },
        }) + "\n",
      );
      return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
});
