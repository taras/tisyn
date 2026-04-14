// Unit test for the pilot-local filesystem binding. Exercises the
// real install path (`installRemoteAgent` on a real
// `inprocessTransport` factory) and verifies both the allowlisted
// read and the deny-by-default behavior.

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import { dispatch } from "@tisyn/agent";
import { installRemoteAgent } from "@tisyn/transport";
import type { Val } from "@tisyn/ir";
import { filesystemDeclaration } from "./agents.ts";
import { createBinding } from "./filesystem-agent.ts";

describe("filesystem-agent", () => {
  it("reads an allowlisted fixture", function* () {
    yield* scoped(function* () {
      yield* installRemoteAgent(filesystemDeclaration, createBinding().transport);
      const result = (yield* dispatch("filesystem.readFile", {
        path: "original-spec.md",
      } as unknown as Val)) as { content: string };
      expect(result.content).toContain("# Tisyn CLI Specification");
    });
  });

  it("rejects paths not in the allowlist", function* () {
    yield* scoped(function* () {
      yield* installRemoteAgent(filesystemDeclaration, createBinding().transport);
      let thrown: unknown;
      try {
        yield* dispatch("filesystem.readFile", { path: "/etc/passwd" } as unknown as Val);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toContain("not in the pilot allowlist");
    });
  });
});
