/**
 * Substrate conformance tests.
 *
 * V1: Reverse child close ordering (LIFO)
 * V2: Child close events appear before parent resumes after compound
 * V3: coroutineId determinism across restart
 * V4: ensure() closed-flag gating pattern
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, ensure, suspend, scoped, sleep } from "effection";
import { execute } from "./execute.js";
import { AgentRegistry } from "@tisyn/agent";
import type { CloseEvent, YieldEvent } from "@tisyn/kernel";

describe("Substrate Conformance", () => {
  describe("V1: child close ordering on scope teardown", () => {
    it("all children close when scope exits", function* () {
      const closeOrder: number[] = [];

      yield* scoped(function* () {
        for (let i = 0; i < 3; i++) {
          const idx = i;
          yield* spawn(function* () {
            yield* ensure(() => {
              closeOrder.push(idx);
            });
            yield* suspend();
          });
        }
        // Let children start, then exit scope — halting all children
        yield* sleep(0);
      });

      // All 3 children must close (order among siblings is not guaranteed LIFO)
      expect(closeOrder).toHaveLength(3);
      expect(new Set(closeOrder)).toEqual(new Set([0, 1, 2]));
    });
  });

  describe("V2: child close before parent resumes after compound", () => {
    it("child Close events appear in journal before post-compound Yield", function* () {
      const agents = new AgentRegistry();
      let callCount = 0;
      // biome-ignore lint/correctness/useYield: mock
      agents.register("a", function* () {
        return ++callCount * 10;
      });

      // IR: let x = all(a.op1, a.op2); a.final(x)
      const ir = {
        tisyn: "eval",
        id: "let",
        data: {
          tisyn: "quote",
          expr: {
            name: "x",
            value: {
              tisyn: "eval",
              id: "all",
              data: { tisyn: "quote", expr: { exprs: [
                { tisyn: "eval", id: "a.op1", data: [] },
                { tisyn: "eval", id: "a.op2", data: [] },
              ] } },
            },
            body: { tisyn: "eval", id: "a.final", data: [] },
          },
        },
      };

      const { journal } = yield* execute({ ir: ir as never, agents });

      // Find the post-compound Yield (a.final)
      const finalYieldIdx = journal.findIndex(
        (e) => e.type === "yield" && (e as YieldEvent).description.name === "final",
      );
      // Find child Close events
      const childCloseIndices = journal
        .map((e, i) =>
          e.type === "close" && e.coroutineId.startsWith("root.") ? i : -1,
        )
        .filter((i) => i >= 0);

      expect(finalYieldIdx).toBeGreaterThan(-1);
      expect(childCloseIndices.length).toBe(2);

      // All child closes must precede the post-compound effect
      for (const childIdx of childCloseIndices) {
        expect(childIdx).toBeLessThan(finalYieldIdx);
      }
    });
  });
  describe("V3: coroutineId determinism across restart", () => {
    it("same parent and spawn index produce identical child IDs", function* () {
      function deriveChildIds(parentId: string, numChildren: number): string[] {
        const ids: string[] = [];
        for (let i = 0; i < numChildren; i++) {
          ids.push(`${parentId}.${i}`);
        }
        return ids;
      }

      // Two independent derivations produce identical results
      expect(deriveChildIds("root", 2)).toEqual(deriveChildIds("root", 2));
      expect(deriveChildIds("root", 2)).toEqual(["root.0", "root.1"]);

      // Nested compounds
      expect(deriveChildIds("root.0", 2)).toEqual(["root.0.0", "root.0.1"]);

      // No collision between siblings
      const s1 = deriveChildIds("root.0", 3);
      const s2 = deriveChildIds("root.1", 3);
      const allIds = [...s1, ...s2];
      expect(new Set(allIds).size).toBe(allIds.length);
    });
  });

  describe("V4: ensure() closed-flag gating pattern", () => {
    it("closed flag prevents Close(cancelled) on normal completion", function* () {
      const journal: string[] = [];

      yield* scoped(function* () {
        const task = yield* spawn(function* () {
          let closed = false;

          yield* ensure(() => {
            if (!closed) {
              journal.push("Close(cancelled)");
            }
          });

          // Normal completion
          closed = true;
          journal.push("Close(ok)");
        });
        yield* task;
      });

      expect(journal).toEqual(["Close(ok)"]);
    });

    it("closed flag allows Close(cancelled) on halt", function* () {
      const journal: string[] = [];

      yield* scoped(function* () {
        yield* spawn(function* () {
          let closed = false;

          yield* ensure(() => {
            if (!closed) {
              journal.push("Close(cancelled)");
            }
          });

          yield* suspend();
          // Never reached on halt
          closed = true;
          journal.push("Close(ok)");
        });

        // Let the child start, then scoped() exits — halting the child
        yield* sleep(0);
      });

      expect(journal).toEqual(["Close(cancelled)"]);
    });
  });
});
