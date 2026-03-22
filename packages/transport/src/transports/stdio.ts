import { resource } from "effection";
import { exec } from "@effectionx/process";
import { lines, filter, map } from "@effectionx/stream-helpers";
import { pipe } from "remeda";
import type {
  AgentTransport,
  AgentTransportFactory,
  HostMessage,
  AgentMessage,
} from "../transport.js";

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

      const transport: AgentTransport = {
        *send(message: HostMessage) {
          proc.stdin.send(JSON.stringify(message) + "\n");
        },
        receive: pipe(
          proc.stdout,
          lines(),
          filter(function* (line: string) {
            return line.trim().length > 0;
          }),
          map(function* (line: string) {
            try {
              return JSON.parse(line) as AgentMessage;
            } catch {
              throw new Error(`Malformed JSON from child process: ${line}`);
            }
          }),
        ),
      };

      yield* provide(transport);
    });
}
