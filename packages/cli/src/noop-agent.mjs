/**
 * Minimal MCP agent that only handles the initialize handshake.
 * Used by CLI tests that need a valid agent transport without a real agent.
 * Reads NDJSON from stdin, responds to initialize, ignores everything else.
 */
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { protocolVersion: "1.0", sessionId: "noop" },
        }) + "\n",
      );
    }
  } catch {
    // ignore malformed lines
  }
});
