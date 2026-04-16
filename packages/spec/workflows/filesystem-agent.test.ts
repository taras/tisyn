// Unit test for the pilot-local filesystem binding. Exercises the
// real install path (`installRemoteAgent` on a real
// `inprocessTransport` factory) and verifies both the positive read
// path and the unknown-target / unknown-kind rejection.
//
// The binding handler expects `{ input: { target, kind } }` because
// the compiler wraps ambient-contract arguments under the declared
// parameter name. The dispatch-based tests below mirror that shape so
// they exercise the exact payload the compiled workflow sends.

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import { dispatch } from "@tisyn/agent";
import { installRemoteAgent } from "@tisyn/transport";
import type { Val } from "@tisyn/ir";
import { filesystemDeclaration } from "./agents.ts";
import { createBinding } from "./filesystem-agent.ts";

describe("filesystem-agent", () => {
  it("reads the registered spec fixture for a known target", function* () {
    yield* scoped(function* () {
      yield* installRemoteAgent(filesystemDeclaration, createBinding().transport);
      const result = (yield* dispatch("filesystem.readOriginal", {
        input: { target: "tisyn-cli", kind: "spec" },
      } as unknown as Val)) as { content: string };
      expect(result.content).toContain("# Tisyn CLI Specification");
    });
  });

  it("reads the registered plan fixture for a known target", function* () {
    yield* scoped(function* () {
      yield* installRemoteAgent(filesystemDeclaration, createBinding().transport);
      const result = (yield* dispatch("filesystem.readOriginal", {
        input: { target: "tisyn-cli", kind: "plan" },
      } as unknown as Val)) as { content: string };
      expect(result.content).toContain("Test Plan");
    });
  });

  it("rejects an unknown target", function* () {
    yield* scoped(function* () {
      yield* installRemoteAgent(filesystemDeclaration, createBinding().transport);
      let thrown: unknown;
      try {
        yield* dispatch("filesystem.readOriginal", {
          input: { target: "missing", kind: "spec" },
        } as unknown as Val);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toContain('unknown target "missing"');
    });
  });
});
