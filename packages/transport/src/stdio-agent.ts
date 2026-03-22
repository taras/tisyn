import type { Operation } from "effection";
import process from "node:process";
import { fromReadable } from "@effectionx/node/stream";
import { lines, map } from "@effectionx/stream-helpers";
import { pipe } from "remeda";
import type { OperationSpec, AgentDeclaration, ImplementationHandlers } from "@tisyn/agent";
import { parseHostMessage } from "@tisyn/protocol";
import { runAgentHandler } from "./agent-handler.js";

/**
 * Run an agent over stdio using NDJSON framing. This is the agent-side
 * entry point — call it from a subprocess that will be spawned by
 * `stdioTransport()` on the host side.
 *
 * Reads HostMessages as NDJSON from process.stdin.
 * Writes AgentMessages as NDJSON to process.stdout.
 */
export function* runStdioAgent<Ops extends Record<string, OperationSpec>>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
): Operation<void> {
  const messageStream = pipe(
    fromReadable(process.stdin),
    lines(),
    map(function* (line: string) {
      return parseHostMessage(JSON.parse(line));
    }),
  );

  const sub = yield* messageStream;

  yield* runAgentHandler(declaration, handlers, {
    receive: sub,
    *send(msg) {
      process.stdout.write(JSON.stringify(msg) + "\n");
    },
  });
}
