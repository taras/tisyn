import type { Stream } from "effection";
import { resource } from "effection";
import { exec } from "@effectionx/process";
import { lines, filter, map } from "@effectionx/stream-helpers";
import { pipe } from "remeda";
import type { AgentMessage } from "@tisyn/protocol";
import { parseAgentMessage } from "@tisyn/protocol";
import type { AgentTransportFactory, HostMessage } from "../transport.js";

export interface StdioTransportOptions {
  command: string;
  arguments?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Create a transport factory that spawns a child process and communicates
 * over NDJSON on stdin/stdout.
 */
export function stdioTransport(options: StdioTransportOptions): AgentTransportFactory {
  return () =>
    resource(function* (provide) {
      const proc = yield* exec(options.command, {
        arguments: options.arguments,
        env: options.env,
        cwd: options.cwd,
      });

      const receive = pipe(
        proc.stdout,
        lines(),
        filter(function* (line: string) {
          return line.trim().length > 0;
        }),
        map(function* (line: string) {
          try {
            return parseAgentMessage(JSON.parse(line));
          } catch {
            throw new Error(`Malformed JSON from child process: ${line}`);
          }
        }),
      ) as Stream<AgentMessage, void>;

      const transport = {
        *send(message: HostMessage) {
          proc.stdin.send(JSON.stringify(message) + "\n");
        },
        receive,
      };

      yield* provide(transport);
    });
}
