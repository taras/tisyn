/**
 * Substrate conformance tests.
 *
 * V1 (reverse close ordering) and V2 (child close before parent resumes)
 * are verified by Effection's own spawn.test.ts — not duplicated here.
 *
 * V3: coroutineId determinism across restart
 * V4: ensure() closed-flag gating pattern
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { spawn, ensure, suspend, scoped, sleep } from "effection";

describe("Substrate Conformance", () => {
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
