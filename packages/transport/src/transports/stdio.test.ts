import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, scoped, sleep } from "effection";
import { agent, operation, invoke } from "@tisyn/agent";
import { installRemoteAgent } from "../install-remote.js";
import { stdioTransport } from "./stdio.js";
import { resolve } from "node:path";

const fixturesDir = resolve(import.meta.dirname, "../../test/fixtures");

function fixtureTransport(name: string) {
  return stdioTransport({
    command: "npx",
    arguments: ["tsx", resolve(fixturesDir, `${name}.ts`)],
  });
}

describe("stdio transport", () => {
  describe("Protocol semantics", () => {
    it("success path", function* () {
      const math = agent("math", {
        double: operation<{ value: number }, number>(),
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(math, fixtureTransport("math-agent"));
        const result = yield* invoke(math.double({ value: 21 }));
        expect(result).toBe(42);
      });
    });

    it("application error path", function* () {
      const failing = agent("failing", {
        boom: operation<void, never>(),
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(failing, fixtureTransport("failing-agent"));
        try {
          yield* invoke(failing.boom());
          expect.unreachable("should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe("kaboom");
        }
      });
    });

    it("repeated execute on same session", function* () {
      const math = agent("math", {
        double: operation<{ value: number }, number>(),
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(math, fixtureTransport("math-agent"));
        expect(yield* invoke(math.double({ value: 1 }))).toBe(2);
        expect(yield* invoke(math.double({ value: 5 }))).toBe(10);
        expect(yield* invoke(math.double({ value: 21 }))).toBe(42);
      });
    });

    it("cancel on interruption", function* () {
      const slow = agent("slow", {
        work: operation<void, void>(),
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(slow, fixtureTransport("slow-agent"));
        const task = yield* spawn(function* () {
          yield* invoke(slow.work());
        });
        yield* sleep(100);
        yield* task.halt();
        // If we get here without timeout, cancel worked
      });
    });

    it("shutdown on scope exit", function* () {
      const math = agent("math", {
        double: operation<{ value: number }, number>(),
      });

      // Scope exits cleanly after invoke
      yield* scoped(function* () {
        yield* installRemoteAgent(math, fixtureTransport("math-agent"));
        yield* invoke(math.double({ value: 1 }));
      });
      // No timeout = process exited cleanly
    });
  });

  describe("Stdio-specific failure modes", () => {
    it("malformed JSON from child", function* () {
      const badAgent = agent("bad", {
        op: operation<void, void>(),
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(badAgent, fixtureTransport("bad-json-agent"));
        try {
          yield* invoke(badAgent.op());
          expect.unreachable("should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      });
    });

    it("unexpected child exit during in-flight request", function* () {
      const crashAgent = agent("crash", {
        op: operation<void, void>(),
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(crashAgent, fixtureTransport("crash-agent"));
        try {
          yield* invoke(crashAgent.op());
          expect.unreachable("should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      });
    });

    it("multiple messages in quick succession", function* () {
      const math = agent("math", {
        double: operation<{ value: number }, number>(),
      });

      yield* scoped(function* () {
        yield* installRemoteAgent(math, fixtureTransport("math-agent"));
        // Fire multiple requests rapidly to test framing
        const results = [];
        for (let i = 1; i <= 10; i++) {
          results.push(yield* invoke(math.double({ value: i })));
        }
        expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
      });
    });
  });
});
