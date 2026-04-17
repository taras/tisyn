// Pilot-local filesystem binding.
//
// This is NOT a general-purpose filesystem agent. The binding delegates
// to `acquireFixture` in `@tisyn/spec`, whose allowlist is the corpus
// manifest — `acquireFixture` resolves only registered corpus ids to
// paths under `packages/spec/corpus/<id>/__fixtures__/`. No
// caller-supplied path ever reaches `readFile`, so the allowlist
// property is preserved across targets.
//
// Adding a second target later means registering it in the `@tisyn/spec`
// manifest; the handler, contract, and tests stay the same.
//
// The binding is wired into the workflow descriptor via
// `transport.inprocess("./filesystem-agent.ts")` from `@tisyn/config`;
// the workflow body calls
// `Filesystem().readOriginal({ target, kind })` through an ambient
// contract, and the compiler wraps the single argument as
// `{ input: { target, kind } }` using the ambient param name — so the
// handler destructures `{ input }` and then pulls the fields out.

import type { Operation } from "effection";
import { call } from "effection";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import type { Val } from "@tisyn/ir";
import { acquireFixture } from "@tisyn/spec";
import { filesystemDeclaration } from "./agents.ts";

// `acquireFixture` is typed with @tisyn/spec's local `Operation<T>`
// alias (`Generator<unknown, T, unknown>`) rather than effection's
// `Operation<T>`. At runtime both are generators whose yields flow
// through the same effection scheduler, but TypeScript sees the yield
// types as disjoint. Wrap through `call` so the handler body uses
// effection's `Operation<T>` consistently.
function* readOriginal(payload: Val): Operation<Val> {
  const { input } = payload as unknown as {
    input: { target: string; kind: "spec" | "plan" };
  };
  const { target, kind } = input;
  if (kind !== "spec" && kind !== "plan") {
    throw new Error(
      `filesystem-agent: unknown kind "${kind}" for target "${target}". ` +
        `Expected "spec" or "plan".`,
    );
  }
  const content = yield* call(
    () => acquireFixture(target, kind) as unknown as Operation<string>,
  );
  return { content } as unknown as Val;
}

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(filesystemDeclaration, {
      readOriginal,
    }),
  };
}
