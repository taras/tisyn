import { describe, it } from "@effectionx/vitest";
import { expect, it as syncIt } from "vitest";
import { execute } from "./execute.js";
import { isCompoundExternal } from "@tisyn/kernel";
import { Seq, Try, Throw, Ref, Get } from "@tisyn/ir";
import { agent, operation } from "@tisyn/agent";
import { inprocessTransport } from "@tisyn/transport";

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

  // SC-B-001: unbound ref in binding fails scope before body executes
  it("unbound Ref binding fails scope before body executes", function* () {
    const { result } = yield* execute({
      ir: Try(
        scope(42, null, { "my-agent": { tisyn: "ref", name: "noSuchVar" } }),
        "e",
        Ref("e"),
      ),
    });
    // The Try catches the scope failure; the caught error value contains the message
    expect(result.status).toBe("ok");
    expect(String((result as any).value)).toContain("noSuchVar");
  });

  // SC-B-002: effectful binding expression fails with ScopeBindingEffectError
  it("effectful binding expression fails with ScopeBindingEffectError", function* () {
    const effectfulBinding = {
      tisyn: "eval" as const,
      id: "sleep",
      data: { tisyn: "quote" as const, expr: [10] },
    };
    const { result } = yield* execute({
      ir: Try(scope(42, null, { "my-agent": effectfulBinding }), "e", Ref("e")),
    });
    expect(result.status).toBe("ok");
    // errorToValue returns the error message; ScopeBindingEffectError message mentions "scope binding"
    expect(String((result as any).value)).toContain("scope binding");
  });

  // SC-B-003: failed binding produces no Yield events in journal
  it("failed binding evaluation produces no journal Yield events", function* () {
    const ir = Try(
      scope(42, null, { "my-agent": { tisyn: "ref", name: "missing" } }),
      "e",
      Ref("e"),
    );
    const { journal } = yield* execute({ ir });
    const yieldEvents = journal.filter((e) => e.type === "yield");
    expect(yieldEvents).toHaveLength(0);
  });

  // SC-B-004: non-Ref binding expression evaluates to factory and body executes
  it("non-Ref binding (Get) evaluates to factory and body executes", function* () {
    const greetAgent = agent("greet-service-scope", {
      noop: operation<Record<string, never>, null>(),
    });
    const factory = inprocessTransport(greetAgent, {
      // biome-ignore lint/correctness/useYield: mock
      *noop() {
        return null;
      },
    });

    const ir = scope(42, null, { "greet-service-scope": Get(Ref("envObj"), "transport") });
    // biome-ignore lint/suspicious/noExplicitAny: factory is not Json-serializable but is a valid Val at runtime
    const { result } = yield* execute({ ir, env: { envObj: { transport: factory } as any } });
    expect(result).toEqual({ status: "ok", value: 42 });
  });
});
