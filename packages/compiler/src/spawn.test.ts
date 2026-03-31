/**
 * Compiler tests for spawn/join.
 *
 * Tests the compilation of `yield* spawn(function*() { ... })` and `yield* task`.
 */

import { describe, it, expect } from "vitest";
import { compileOne } from "./index.js";

// ── Helpers ──

function findNode(node: unknown, id: string): Record<string, any> | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const obj = node as Record<string, unknown>;
  if (obj["tisyn"] === "eval" && obj["id"] === id) return obj as Record<string, any>;
  for (const value of Object.values(obj)) {
    const found = findNode(value, id);
    if (found) return found;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findNode(item, id);
        if (found) return found;
      }
    }
  }
  return undefined;
}

// ── Acceptance tests ──

describe("spawn compilation", () => {
  it("bare yield* spawn(function*() {...}) → SpawnEval", () => {
    const ir = compileOne(`
      function* f(): Workflow<void> {
        yield* spawn(function* () {
          return 42;
        });
      }
    `);
    const spawnNode = findNode(ir, "spawn");
    expect(spawnNode).toBeDefined();
    expect(spawnNode!.data).toHaveProperty("tisyn", "quote");
    expect(spawnNode!.data.expr).toHaveProperty("body");
  });

  it("const task = yield* spawn(...) → Let with SpawnEval + join lowers correctly", () => {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        const task = yield* spawn(function* () {
          return 42;
        });
        return yield* task;
      }
    `);
    // Should have a spawn node (Let value)
    const spawnNode = findNode(ir, "spawn");
    expect(spawnNode).toBeDefined();

    // Should have a join node
    const joinNode = findNode(ir, "join");
    expect(joinNode).toBeDefined();
    expect(joinNode!.data).toHaveProperty("tisyn", "ref");
  });

  it("yield* task → JoinEval(Ref('task'))", () => {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        const task = yield* spawn(function* () { return 42; });
        return yield* task;
      }
    `);
    const joinNode = findNode(ir, "join");
    expect(joinNode).toBeDefined();
    expect(joinNode!.data).toMatchObject({ tisyn: "ref" });
    expect(joinNode!.data.name).toContain("task");
  });

  it("spawned body captures outer lexical refs", () => {
    const ir = compileOne(`
      function* f(x: number): Workflow<number> {
        const task = yield* spawn(function* () {
          return x;
        });
        return yield* task;
      }
    `);
    const spawnNode = findNode(ir, "spawn");
    expect(spawnNode).toBeDefined();
    // The body should contain a Ref to "x"
    const bodyRef = findNode(spawnNode!.data.expr.body, "ref");
    // If body is a ref directly
    if (!bodyRef) {
      expect(spawnNode!.data.expr.body).toHaveProperty("tisyn", "ref");
    }
  });

  it("spawn handle in if branch lowers join correctly", () => {
    const ir = compileOne(`
      function* f(cond: boolean): Workflow<number> {
        const task = yield* spawn(function* () { return 42; });
        if (cond) {
          return yield* task;
        }
        return 0;
      }
    `);
    // The join node should exist inside the if branch
    const joinNode = findNode(ir, "join");
    expect(joinNode).toBeDefined();
  });
});

// ── Rejection tests ──

describe("spawn rejection", () => {
  it("rejects arrow function argument (SP1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* spawn(() => 42);
        }
      `),
    ).toThrow("SP1");
  });

  it("rejects non-generator function argument (SP1)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          yield* spawn(function() { return 42; });
        }
      `),
    ).toThrow("SP1");
  });

  it("rejects identifier argument (SP1)", () => {
    expect(() =>
      compileOne(`
        function* f(fn: any): Workflow<void> {
          yield* spawn(fn);
        }
      `),
    ).toThrow("SP1");
  });

  it("rejects let binding for spawn handle (SP2)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          let task = yield* spawn(function* () { return 42; });
        }
      `),
    ).toThrow("SP2");
  });

  it("rejects spawn handle used as return value (SP4)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const task = yield* spawn(function* () { return 42; });
          return task;
        }
      `),
    ).toThrow("SP4");
  });

  it("rejects spawn handle in object literal (SP4)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const task = yield* spawn(function* () { return 42; });
          return { t: task };
        }
      `),
    ).toThrow("SP4");
  });

  it("rejects spawn handle in array literal (SP4)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const task = yield* spawn(function* () { return 42; });
          return [task];
        }
      `),
    ).toThrow("SP4");
  });

  it("rejects parent spawn handle capture in nested spawn (SP11)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<void> {
          const task = yield* spawn(function* () { return 42; });
          yield* spawn(function* () {
            yield* task;
          });
        }
      `),
    ).toThrow("SP11");
  });

  it("rejects parent spawn handle in expression position inside spawned body (SP11)", () => {
    expect(() =>
      compileOne(`
        function* f(): Workflow<any> {
          const task = yield* spawn(function* () { return 42; });
          yield* spawn(function* () {
            return task;
          });
        }
      `),
    ).toThrow("SP11");
  });
});

// ── Scope-aware tracking tests ──

describe("spawn scope-aware handle tracking", () => {
  it("spawn handle declared in if-branch is NOT visible in else-branch", () => {
    // This tests that spawn handles respect block scope (not a flat set)
    expect(() =>
      compileOne(`
        function* f(cond: boolean): Workflow<number> {
          if (cond) {
            const t = yield* spawn(function* () { return 42; });
            return yield* t;
          } else {
            return yield* t;
          }
        }
      `),
    ).toThrow(); // 't' is not in scope in the else branch
  });

  it("clone preserves spawn handle in branch (regression)", () => {
    // This verifies cloneScopeStack preserves isSpawnHandle
    const ir = compileOne(`
      function* f(cond: boolean): Workflow<number> {
        const t = yield* spawn(function* () { return 42; });
        if (cond) {
          return yield* t;
        }
        return 0;
      }
    `);
    // Should compile successfully with join inside the if-branch
    const joinNode = findNode(ir, "join");
    expect(joinNode).toBeDefined();
  });

  it("spawned body can declare its own spawn handles", () => {
    const ir = compileOne(`
      function* f(): Workflow<number> {
        const outer = yield* spawn(function* () {
          const inner = yield* spawn(function* () { return 42; });
          return yield* inner;
        });
        return yield* outer;
      }
    `);
    // Should have multiple spawn and join nodes
    const spawnNode = findNode(ir, "spawn");
    const joinNode = findNode(ir, "join");
    expect(spawnNode).toBeDefined();
    expect(joinNode).toBeDefined();
  });
});
