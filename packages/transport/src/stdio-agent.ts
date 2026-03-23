import process from "node:process";
import { fromReadable } from "@effectionx/node/stream";
import { lines, map } from "@effectionx/stream-helpers";
import { pipe } from "remeda";
import { parseHostMessage } from "@tisyn/protocol";
import type { AgentServerTransport } from "./protocol-server.js";

/**
 * Create an agent-side transport that reads NDJSON from stdin and
 * writes NDJSON to stdout. Use with `createProtocolServer(impl).use()`
 * to serve an agent over stdio.
 */
export function createStdioAgentTransport(): AgentServerTransport {
  return {
    *receive() {
      return yield* pipe(
        fromReadable(process.stdin),
        lines(),
        map(function* (line: string) {
          return parseHostMessage(JSON.parse(line));
        }),
      );
    },
    *send(msg) {
      process.stdout.write(JSON.stringify(msg) + "\n");
    },
  };
}
