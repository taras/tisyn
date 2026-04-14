// Pilot-local filesystem binding.
//
// This is NOT a general-purpose filesystem agent. The pilot's only
// legitimate reads are the two frozen comparison fixtures under
// `corpus/tisyn-cli/__fixtures__`, so the binding enforces a strict
// two-entry allowlist keyed on the simple filename. Any other `path`
// argument fails fast with a descriptive error.
//
// The binding is wired into the workflow descriptor via
// `transport.inprocess("./filesystem-agent.ts")` from `@tisyn/config`;
// the same `createBinding()` is also imported directly by the
// filesystem-agent unit test and by the workflow test.

import { readFile as nodeReadFile } from "node:fs/promises";
import { resolve } from "node:path";
import { call } from "effection";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import type { Val } from "@tisyn/ir";
import { filesystemDeclaration } from "./agents.ts";

const fixturesDir = resolve(import.meta.dirname, "../corpus/tisyn-cli/__fixtures__");

const ALLOWED = new Map<string, string>([
  ["original-spec.md", resolve(fixturesDir, "original-spec.md")],
  ["original-test-plan.md", resolve(fixturesDir, "original-test-plan.md")],
]);

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(filesystemDeclaration, {
      *readFile(input) {
        const { path } = input as unknown as { path: string };
        const resolved = ALLOWED.get(path);
        if (resolved == null) {
          throw new Error(
            `filesystem-agent: path "${path}" is not in the pilot allowlist. ` +
              `Allowed: ${[...ALLOWED.keys()].join(", ")}`,
          );
        }
        const content = yield* call(() => nodeReadFile(resolved, "utf8"));
        return { content } as unknown as Val;
      },
    }),
  };
}
