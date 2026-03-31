import { describe, it } from "@effectionx/vitest";
import { expect, it as syncIt } from "vitest";
import { execute } from "./execute.js";
import { isCompoundExternal } from "@tisyn/kernel";
import { Seq, Try, Throw, Ref } from "@tisyn/ir";

// Convenience constructor for scope IR — raw plain objects (no @tisyn/compiler dependency).
const scope = (body: unknown, handler: unknown = null, bindings: unknown = {}) =>
  ({
    tisyn: "eval",
    id: "scope",
    data: { tisyn: "quote", expr: { handler, bindings, body } },
  }) as unknown as import("@tisyn/ir").IrInput;

describe("scope orchestration", () => {
  syncIt("scope is compound external", () => {
    expect(isCompoundExternal("scope")).toBe(true);
  });

  // SC-R-001: simplest case — literal body
  it("scope with literal body returns the body value", function* () {
    const result = yield* execute({ ir: scope(42) });
    expect(result.result).toEqual({ status: "ok", value: 42 });
  });

  // SC-R-003: sequential scopes get distinct child IDs
  it("two sequential scopes get root.0 and root.1", function* () {
    const { journal } = yield* execute({ ir: Seq(scope(1), scope(2)) });
    const childClose = journal.filter(
      (e) => e.type === "close" && (e as any).coroutineId !== "root",
    );
    expect(childClose.map((e) => (e as any).coroutineId)).toEqual(["root.0", "root.1"]);
  });

  // SC-T-005: scope error is catchable by parent try/catch
  it("scope error is catchable by parent try", function* () {
    const ir = Try(scope(Throw("scope failed")), "e", Ref("e"));
    const result = yield* execute({ ir });
    expect(result.result.status).toBe("ok");
  });
});
