// Pilot-local filesystem binding.
//
// This is NOT a general-purpose filesystem agent. The binding owns a
// `TARGET_FIXTURES` registry keyed by target name; each entry holds
// the resolved absolute paths of that target's two frozen comparison
// originals (`spec` and `plan`). The `readOriginal` handler looks the
// target up, throws on miss, and reads the resolved path — no
// caller-supplied path ever reaches `readFileSync`, so the allowlist
// property is preserved across targets.
//
// Adding a second target later means appending one row to
// `TARGET_FIXTURES`; the handler, contract, and tests stay the same.
//
// The binding is wired into the workflow descriptor via
// `transport.inprocess("./filesystem-agent.ts")` from `@tisyn/config`;
// the workflow body calls
// `Filesystem().readOriginal({ target, kind })` through an ambient
// contract, and the compiler wraps the single argument as
// `{ input: { target, kind } }` using the ambient param name — so the
// handler destructures `{ input }` and then pulls the fields out.

import { readFile as nodeReadFile } from "node:fs/promises";
import { resolve } from "node:path";
import { call } from "effection";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import type { Val } from "@tisyn/ir";
import { filesystemDeclaration } from "./agents.ts";

interface TargetFixtures {
  readonly spec: string;
  readonly plan: string;
}

const TARGET_FIXTURES = new Map<string, TargetFixtures>([
  [
    "tisyn-cli",
    {
      spec: resolve(import.meta.dirname, "../corpus/tisyn-cli/__fixtures__/original-spec.md"),
      plan: resolve(import.meta.dirname, "../corpus/tisyn-cli/__fixtures__/original-test-plan.md"),
    },
  ],
]);

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(filesystemDeclaration, {
      *readOriginal(payload) {
        const { input } = payload as unknown as {
          input: { target: string; kind: "spec" | "plan" };
        };
        const { target, kind } = input;
        const fixtures = TARGET_FIXTURES.get(target);
        if (fixtures == null) {
          throw new Error(
            `filesystem-agent: unknown target "${target}". ` +
              `Known targets: ${[...TARGET_FIXTURES.keys()].join(", ")}`,
          );
        }
        if (kind !== "spec" && kind !== "plan") {
          throw new Error(
            `filesystem-agent: unknown kind "${kind}" for target "${target}". ` +
              `Expected "spec" or "plan".`,
          );
        }
        const resolved = fixtures[kind];
        const content = yield* call(() => nodeReadFile(resolved, "utf8"));
        return { content } as unknown as Val;
      },
    }),
  };
}
