import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import { createApi } from "./index.js";

describe("@tisyn/context-api", () => {
  it("runs max middleware before the handler", function* () {
    const log: string[] = [];
    const Api = createApi("test.max", {
      *call(input: string) {
        log.push(`handler:${input}`);
        return `${input}:handled`;
      },
    });

    yield* Api.around({
      *call([input], next) {
        log.push(`mw:${input}`);
        return yield* next(`${input}:mw`);
      },
    });

    const result = yield* Api.operations.call("x");

    expect(result).toBe("x:mw:handled");
    expect(log).toEqual(["mw:x", "handler:x:mw"]);
  });

  it("inherits parent middleware through child scopes without mutating the parent", function* () {
    const log: string[] = [];
    const Api = createApi("test.inherit", {
      *call(input: string) {
        log.push(`handler:${input}`);
        return input;
      },
    });

    yield* Api.around({
      *call([input], next) {
        log.push("parent");
        return yield* next(`${input}:parent`);
      },
    });

    const childResult = yield* scoped(function* () {
      yield* Api.around({
        *call([input], next) {
          log.push("child");
          return yield* next(`${input}:child`);
        },
      });
      return yield* Api.operations.call("x");
    });

    const parentResult = yield* Api.operations.call("x");

    expect(childResult).toBe("x:parent:child");
    expect(parentResult).toBe("x:parent");
    expect(log).toEqual([
      "parent",
      "child",
      "handler:x:parent:child",
      "parent",
      "handler:x:parent",
    ]);
  });

  it("orders min middleware below max middleware", function* () {
    const log: string[] = [];
    const Api = createApi("test.priority", {
      *call() {
        log.push("handler");
        return "ok";
      },
    });

    yield* Api.around(
      {
        *call(_args, next) {
          log.push("min");
          return yield* next();
        },
      },
      { at: "min" },
    );
    yield* Api.around({
      *call(_args, next) {
        log.push("max");
        return yield* next();
      },
    });

    const result = yield* Api.operations.call();

    expect(result).toBe("ok");
    expect(log).toEqual(["max", "min", "handler"]);
  });

  it("custom groups with mixed modes preserve declared lane order", function* () {
    const log: string[] = [];
    const Api = createApi(
      "test.custom-groups",
      {
        *call() {
          log.push("core");
          return "done";
        },
      },
      {
        groups: [
          { name: "outer", mode: "append" },
          { name: "middle", mode: "append" },
          { name: "inner", mode: "prepend" },
        ] as const,
      },
    );

    yield* Api.around(
      {
        *call(_args, next) {
          log.push("inner");
          return yield* next();
        },
      },
      { at: "inner" },
    );
    yield* Api.around(
      {
        *call(_args, next) {
          log.push("middle");
          return yield* next();
        },
      },
      { at: "middle" },
    );
    yield* Api.around(
      {
        *call(_args, next) {
          log.push("outer");
          return yield* next();
        },
      },
      { at: "outer" },
    );

    yield* Api.operations.call();

    // Declared order outer → middle → inner → core.
    expect(log).toEqual(["outer", "middle", "inner", "core"]);
  });

  it("rejects unknown group names with a clear error", function* () {
    const Api = createApi(
      "test.unknown-group",
      {
        *call() {
          return "ok";
        },
      },
      {
        groups: [
          { name: "a", mode: "append" },
          { name: "b", mode: "prepend" },
        ] as const,
      },
    );

    let caught: unknown;
    try {
      yield* Api.around(
        {
          *call(_args, next) {
            return yield* next();
          },
        },
        // deliberate cast — exercises the runtime guard
        { at: "bogus" as unknown as "a" },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("unknown group");
    expect(message).toContain("bogus");
    expect(message).toContain("a, b");
  });

  it("rejects duplicate group names at createApi time", function* () {
    let caught: unknown;
    try {
      createApi(
        "test.duplicates",
        {
          *call() {
            return null;
          },
        },
        {
          groups: [
            { name: "x", mode: "append" },
            { name: "x", mode: "prepend" },
          ] as const,
        },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("duplicate group");
    expect((caught as Error).message).toContain("x");
    // Make `yield*` signature happy.
    yield* scoped(function* () {});
  });
});
