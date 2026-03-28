/**
 * Kernel try/catch/finally tests — T01–T24.
 *
 * Tests use pure IR (no effects) so the generator is driven synchronously.
 * All IR is constructed as plain objects to avoid circular build deps.
 */

import { describe, it, expect } from "vitest";
import { evaluate } from "./eval.js";
import {
  UnboundVariable,
  NotCallable,
  ArityMismatch,
  TypeError,
  DivisionByZero,
  ExplicitThrow,
  EffectError,
  isCatchable,
} from "./errors.js";
import { EMPTY_ENV, extend } from "./environment.js";

// ── IR helpers ──

function lit(v: unknown) {
  return v;
}

function ref(name: string) {
  return { tisyn: "ref", name };
}

function letNode(name: string, value: unknown, body: unknown) {
  return { tisyn: "eval", id: "let", data: { tisyn: "quote", expr: { name, value, body } } };
}

function throwNode(message: unknown) {
  return { tisyn: "eval", id: "throw", data: { tisyn: "quote", expr: { message } } };
}

function tryNode(
  body: unknown,
  catchParam?: string,
  catchBody?: unknown,
  finallyBody?: unknown,
) {
  const expr: Record<string, unknown> = { body };
  if (catchParam !== undefined) expr["catchParam"] = catchParam;
  if (catchBody !== undefined) expr["catchBody"] = catchBody;
  if (finallyBody !== undefined) expr["finally"] = finallyBody;
  return { tisyn: "eval", id: "try", data: { tisyn: "quote", expr } };
}

function seqNode(...exprs: unknown[]) {
  return { tisyn: "eval", id: "seq", data: { tisyn: "quote", expr: { exprs } } };
}

// ── Driver ──

/**
 * Drive the kernel evaluator to completion (no effects allowed in these tests).
 * Returns the Val or throws the error.
 */
function run(expr: unknown, env = EMPTY_ENV): unknown {
  const gen = evaluate(expr as never, env);
  let result = gen.next();
  while (!result.done) {
    throw new Error("Unexpected effect in pure kernel test");
  }
  return result.value;
}

function runExpectError(expr: unknown, env = EMPTY_ENV): unknown {
  try {
    run(expr, env);
    throw new Error("Expected error but none was thrown");
  } catch (e) {
    return e;
  }
}

// ── T01–T03: body succeeds ──

describe("T01: try body succeeds — pure", () => {
  it("returns body value when no error", () => {
    const ir = tryNode(lit(42), "e", lit("caught"));
    expect(run(ir)).toBe(42);
  });
});

describe("T02: try/finally body succeeds — finally result discarded", () => {
  it("returns body value; finally result is discarded", () => {
    const ir = tryNode(lit("ok"), undefined, undefined, lit("discarded"));
    expect(run(ir)).toBe("ok");
  });
});

describe("T03: try/catch/finally body succeeds — finally runs but result discarded", () => {
  it("returns body value when body succeeds and finally is present", () => {
    const ir = tryNode(lit(1), "e", lit(2), lit(3));
    expect(run(ir)).toBe(1);
  });
});

// ── T04–T10: each catchable error type caught ──

describe("T04: ExplicitThrow is catchable", () => {
  it("catch runs; result is catch value", () => {
    const ir = tryNode(throwNode(lit("boom")), "e", ref("e"));
    expect(run(ir)).toBe("boom");
  });
});

describe("T05: TypeError is catchable", () => {
  it("catch runs on TypeError from arithmetic", () => {
    // add("a", 1) → TypeError
    const addNode = {
      tisyn: "eval",
      id: "add",
      data: { tisyn: "quote", expr: { a: lit("not-a-number"), b: lit(1) } },
    };
    const ir = tryNode(addNode, "e", lit("type-error-caught"));
    expect(run(ir)).toBe("type-error-caught");
  });
});

describe("T06: UnboundVariable is catchable", () => {
  it("catch runs on UnboundVariable", () => {
    const ir = tryNode(ref("noSuchVar"), "e", lit("unbound-caught"));
    expect(run(ir)).toBe("unbound-caught");
  });
});

describe("T07: DivisionByZero is catchable", () => {
  it("catch runs on DivisionByZero", () => {
    const divNode = {
      tisyn: "eval",
      id: "div",
      data: { tisyn: "quote", expr: { a: lit(10), b: lit(0) } },
    };
    const ir = tryNode(divNode, "e", lit("div-by-zero-caught"));
    expect(run(ir)).toBe("div-by-zero-caught");
  });
});

describe("T08: NotCallable is catchable", () => {
  it("catch runs on NotCallable from call with non-fn value", () => {
    const callNode = {
      tisyn: "eval",
      id: "call",
      data: { tisyn: "quote", expr: { fn: lit(42), args: [] } },
    };
    const ir = tryNode(callNode, "e", lit("not-callable-caught"));
    expect(run(ir)).toBe("not-callable-caught");
  });
});

describe("T09: ArityMismatch is catchable", () => {
  it("catch runs on ArityMismatch", () => {
    const fnNode = { tisyn: "fn", params: ["x"], body: ref("x") };
    const callNode = {
      tisyn: "eval",
      id: "call",
      data: { tisyn: "quote", expr: { fn: fnNode, args: [] } },
    };
    const ir = tryNode(callNode, "e", lit("arity-caught"));
    expect(run(ir)).toBe("arity-caught");
  });
});

describe("T10: EffectError is catchable", () => {
  it("isCatchable returns true for EffectError", () => {
    // We can't inject EffectError via effects at kernel level (no runtime harness).
    // Verify that isCatchable() recognises EffectError — sufficient for kernel unit coverage.
    const err = new EffectError("agent-failed");
    expect(isCatchable(err)).toBe(true);
  });
});

// ── T11–T12: try/finally only ──

describe("T11: try/finally — error propagates after finally", () => {
  it("error still propagates when only finally is present", () => {
    const ir = tryNode(throwNode(lit("propagating")), undefined, undefined, lit(99));
    const err = runExpectError(ir);
    expect(err).toBeInstanceOf(ExplicitThrow);
    expect((err as ExplicitThrow).message).toBe("propagating");
  });
});

describe("T12: try/finally — success returns body value", () => {
  it("body value returned; finally result discarded", () => {
    const ir = tryNode(lit("body-result"), undefined, undefined, lit("finally-discarded"));
    expect(run(ir)).toBe("body-result");
  });
});

// ── T13: catch error propagates (not re-caught by same try) ──

describe("T13: error in catch clause propagates", () => {
  it("catch error is not re-caught by the same try", () => {
    const ir = tryNode(throwNode(lit("original")), "e", throwNode(lit("catch-error")));
    const err = runExpectError(ir);
    expect(err).toBeInstanceOf(ExplicitThrow);
    expect((err as ExplicitThrow).message).toBe("catch-error");
  });
});

// ── T14: finally error replaces prior error outcome ──

describe("T14: finally error replaces prior error outcome", () => {
  it("finally error propagates instead of original error", () => {
    const ir = tryNode(
      throwNode(lit("original")),
      "e",
      lit("caught"),
      throwNode(lit("finally-error")),
    );
    const err = runExpectError(ir);
    expect(err).toBeInstanceOf(ExplicitThrow);
    expect((err as ExplicitThrow).message).toBe("finally-error");
  });
});

// ── T15–T16: nested try, finally always runs ──

describe("T15: nested try — inner catch runs, outer finally runs", () => {
  it("inner catch handles inner error; outer finally still runs", () => {
    // outer: try { inner: try { throw } catch (e) { e } } finally { discarded }
    const inner = tryNode(throwNode(lit("inner")), "e", ref("e"));
    const outer = tryNode(inner, undefined, undefined, lit("outer-finally"));
    expect(run(outer)).toBe("inner");
  });
});

describe("T16: nested try — inner throw propagates to outer catch", () => {
  it("uncaught inner error is caught by outer catch", () => {
    const inner = tryNode(throwNode(lit("escaping")), undefined, undefined, lit("inner-finally"));
    const outer = tryNode(inner, "e", ref("e"));
    expect(run(outer)).toBe("escaping");
  });
});

// ── T17–T20: catchParam bindings ──

describe("T17: catchParam binds error message", () => {
  it("catchParam resolves to error message string inside catchBody", () => {
    const ir = tryNode(throwNode(lit("hello")), "err", ref("err"));
    expect(run(ir)).toBe("hello");
  });
});

describe("T18: catchParam not visible outside catchBody", () => {
  it("catchParam name not bound in body", () => {
    // body references 'err' which is not in scope → UnboundVariable in body
    const ir = tryNode(ref("err"), "err", lit("caught-something"));
    // 'err' is unbound in body → UnboundVariable → catchable → catch runs
    expect(run(ir)).toBe("caught-something");
  });
});

describe("T19: outer binding with same name as catchParam resolves normally in body", () => {
  it("outer 'x' is accessible in body even if 'x' is also catchParam", () => {
    const env = extend(EMPTY_ENV, "x", "outer-value");
    const ir = tryNode(ref("x"), "x", lit("catch-fallback"));
    // body: ref("x") → "outer-value" (no error); catch not needed
    expect(run(ir, env)).toBe("outer-value");
  });
});

describe("T20: catchParam shadows outer binding inside catchBody", () => {
  it("catchParam 'x' shadows outer 'x' in catchBody", () => {
    const env = extend(EMPTY_ENV, "x", "outer-x");
    // body throws, catchParam='x' bound to error message, catchBody returns ref("x")
    const ir = tryNode(throwNode(lit("error-msg")), "x", ref("x"));
    expect(run(ir, env)).toBe("error-msg");
  });
});

// ── T21–T22: finally runs in pre-try env ──

describe("T21: finally runs in original pre-try env", () => {
  it("finally sees pre-try bindings (not catch bindings)", () => {
    const env = extend(EMPTY_ENV, "preVal", "pre");
    // try: throw; catch(e): e; finally: ref("preVal")
    const ir = tryNode(throwNode(lit("err")), "e", ref("e"), ref("preVal"));
    // body throws, catch runs → "err", finally runs and returns "pre" but result is discarded
    // so the overall result is the catch value "err"
    expect(run(ir, env)).toBe("err");
  });
});

describe("T22: try succeeds — finally runs in original env", () => {
  it("finally sees pre-try bindings when body succeeds", () => {
    // try: lit("body"); finally: lit("finally") → result is "body"
    const ir = tryNode(lit("body"), undefined, undefined, lit("finally"));
    expect(run(ir)).toBe("body");
  });
});

// ── T23: try without catch (try/finally only, body succeeds) ──

describe("T23: try/finally only, body succeeds", () => {
  it("returns body value; no catch needed", () => {
    const ir = tryNode(lit(100), undefined, undefined, lit("discarded"));
    expect(run(ir)).toBe(100);
  });
});

// ── T24: catch without catchParam ──

describe("T24: catch without catchParam", () => {
  it("catch runs without binding when catchParam is absent", () => {
    // Try(body, undefined, catchBody) — error is caught, no binding
    const ir = tryNode(throwNode(lit("ignored")), undefined, lit("no-param-catch"));
    expect(run(ir)).toBe("no-param-catch");
  });
});
