/**
 * Mock ACP stdio server for testing the real binding path.
 *
 * Reads NDJSON from stdin, responds on stdout. Speaks ACP protocol
 * (not Tisyn protocol — the binding layer translates).
 *
 * Supports:
 * - openSession → returns { sessionId: "test-session-1" }
 * - plan → returns { response: "mock plan result" }
 * - closeSession → returns null
 * - cancel → no response (cancellation acknowledgment)
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

  if (msg.method === "cancel") {
    // Cancel has no response in ACP
    return;
  }

  // Map operation to result. installRemoteAgent extracts the bare
  // operation name (e.g. "openSession") before the ExecuteRequest
  // reaches the adapter, so we match on bare names here.
  let result: unknown;
  switch (msg.method) {
    case "openSession":
      result = { sessionId: "test-session-1" };
      break;
    case "plan":
      // Echo back part of the input to prove args were forwarded
      result = {
        response: `mock plan result for: ${(msg.params as Record<string, unknown>).prompt ?? "unknown"}`,
      };
      break;
    case "closeSession":
      result = null;
      break;
    case "fork":
      result = { parentSessionId: "test-session-1", forkId: "fork-1" };
      break;
    case "openFork":
      result = { sessionId: "test-session-fork-1" };
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

  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n",
  );
});
