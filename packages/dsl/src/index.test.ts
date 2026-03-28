import { describe, it, expect } from "vitest";
import {
  Ref,
  Q,
  Fn,
  Let,
  Seq,
  If,
  While,
  Call,
  Get,
  Add,
  Sub,
  Mul,
  Div,
  Mod,
  Neg,
  Gt,
  Gte,
  Lt,
  Lte,
  Eq,
  Neq,
  And,
  Or,
  Not,
  Construct,
  Arr,
  Concat,
  ConcatArrays,
  MergeObjects,
  Throw,
  Eval,
  All,
  Race,
} from "@tisyn/ir";
import {
  parseDSL,
  parseDSLSafe,
  parseDSLWithRecovery,
  tryAutoClose,
  DSLParseError,
  print,
} from "./index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function roundTrip(expr: any) {
  const src = print(expr);
  const result = parseDSLSafe(src);
  expect(result.ok, `parseDSL(print(expr)) failed: ${!result.ok && result.error.message}`).toBe(
    true,
  );
  if (result.ok) expect(result.value).toEqual(expr);
}

// ── §11.4 Core Fixtures — Literals ───────────────────────────────────────────

describe("DSL-001: integer literal", () => {
  it("parses 42", () => {
    expect(parseDSL("42")).toBe(42);
  });
});

describe("DSL-002: negative number", () => {
  it("parses -7", () => {
    expect(parseDSL("-7")).toBe(-7);
  });
});

describe("DSL-003: float", () => {
  it("parses 3.14", () => {
    expect(parseDSL("3.14")).toBeCloseTo(3.14);
  });
});

describe("DSL-004: string literal", () => {
  it('parses "hello"', () => {
    expect(parseDSL('"hello"')).toBe("hello");
  });
});

describe("DSL-005: string with escape sequences", () => {
  it('parses "a\\nb"', () => {
    expect(parseDSL('"a\\nb"')).toBe("a\nb");
  });
});

describe("DSL-006: boolean true", () => {
  it("parses true", () => {
    expect(parseDSL("true")).toBe(true);
  });
});

describe("DSL-007: boolean false", () => {
  it("parses false", () => {
    expect(parseDSL("false")).toBe(false);
  });
});

describe("DSL-008: null", () => {
  it("parses null", () => {
    expect(parseDSL("null")).toBe(null);
  });
});

describe("DSL-009: empty array", () => {
  it("parses []", () => {
    expect(parseDSL("[]")).toEqual([]);
  });
});

describe("DSL-010: array of mixed literals", () => {
  it('parses [1, "two", true, null]', () => {
    expect(parseDSL('[1, "two", true, null]')).toEqual([1, "two", true, null]);
  });
});

// ── §11.5 Core Fixtures — Simple Constructors ─────────────────────────────────

describe("DSL-020: Ref", () => {
  it('parses Ref("x")', () => {
    const result = parseDSLSafe('Ref("x")');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ tisyn: "ref", name: "x" });
  });
  it("round-trips", () => roundTrip(Ref("x") as never));
});

describe("DSL-021: Add", () => {
  it("parses Add(1, 2)", () => {
    const expected = Add(1, 2);
    const result = parseDSLSafe("Add(1, 2)");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
});

describe("DSL-022: Not", () => {
  it("parses Not(true)", () => {
    const expected = Not(true as never);
    const result = parseDSLSafe("Not(true)");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
});

describe("DSL-023: Throw", () => {
  it('parses Throw("bad")', () => {
    const expected = Throw("bad" as never);
    const result = parseDSLSafe('Throw("bad")');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
});

// ── §11.6 Core Fixtures — Nested Constructors ────────────────────────────────

describe("DSL-030: Let + Ref", () => {
  it('parses Let("x", 1, Ref("x"))', () => {
    const expected = Let("x", 1, Ref("x"));
    const result = parseDSLSafe('Let("x", 1, Ref("x"))');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => roundTrip(Let("x", 1, Ref("x")) as never));
});

describe("DSL-031: If with else", () => {
  it('parses If(Eq(1, 2), "yes", "no")', () => {
    const expected = If(Eq(1, 2), "yes", "no");
    const result = parseDSLSafe('If(Eq(1, 2), "yes", "no")');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => roundTrip(If(Eq(1, 2), "yes", "no") as never));
});

describe("DSL-032: If without else", () => {
  it("parses If(true, 1)", () => {
    const expected = If(true as never, 1);
    const result = parseDSLSafe("If(true, 1)");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => roundTrip(If(true as never, 1) as never));
});

describe("DSL-033: nested binary ops", () => {
  it("parses Add(Add(1, 2), 3)", () => {
    const expected = Add(Add(1, 2) as never, 3);
    const result = parseDSLSafe("Add(Add(1, 2), 3)");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => roundTrip(Add(Add(1, 2) as never, 3) as never));
});

// ── §11.7 Core Fixtures — External Effects ────────────────────────────────────

describe("DSL-040: Eval with Ref payload", () => {
  it('parses Eval("svc.op", Ref("x"))', () => {
    const expected = Eval("svc.op", Ref("x"));
    const result = parseDSLSafe('Eval("svc.op", Ref("x"))');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => roundTrip(Eval("svc.op", Ref("x")) as never));
});

describe("DSL-041: Eval with array payload", () => {
  it('parses Eval("svc.op", [Ref("x"), 42])', () => {
    const expected = Eval("svc.op", [Ref("x"), 42]);
    const result = parseDSLSafe('Eval("svc.op", [Ref("x"), 42])');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => roundTrip(Eval("svc.op", [Ref("x"), 42]) as never));
});

describe("DSL-042: Eval with null payload", () => {
  it('parses Eval("svc.op", null)', () => {
    const expected = Eval("svc.op", null);
    const result = parseDSLSafe('Eval("svc.op", null)');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => roundTrip(Eval("svc.op", null) as never));
});

// ── §11.8 Core Fixtures — Compound and Data ──────────────────────────────────

describe("DSL-050: All", () => {
  it("parses All(...)", () => {
    const expected = All(Eval("a.b", null) as never, Eval("c.d", null) as never);
    const result = parseDSLSafe('All(Eval("a.b", null), Eval("c.d", null))');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => {
    roundTrip(All(Eval("a.b", null) as never, Eval("c.d", null) as never) as never);
  });
});

describe("DSL-051: Race", () => {
  it("parses Race(...)", () => {
    const expected = Race(Eval("a.b", null) as never, Eval("c.d", null) as never);
    const result = parseDSLSafe('Race(Eval("a.b", null), Eval("c.d", null))');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => {
    roundTrip(Race(Eval("a.b", null) as never, Eval("c.d", null) as never) as never);
  });
});

describe("DSL-052: Arr", () => {
  it("parses Arr(1, 2, 3)", () => {
    const expected = Arr(1, 2, 3);
    const result = parseDSLSafe("Arr(1, 2, 3)");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => roundTrip(Arr(1, 2, 3) as never));
});

describe("DSL-053: Construct", () => {
  it('parses Construct({ name: "test", value: 42 })', () => {
    const expected = Construct({ name: "test" as never, value: 42 as never });
    const result = parseDSLSafe('Construct({ name: "test", value: 42 })');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => {
    roundTrip(Construct({ name: "test" as never, value: 42 as never }) as never);
  });
});

// ── §11.9 Core Fixtures — Fn and Call ────────────────────────────────────────

describe('DSL-060: Fn(["x"], Add(Ref("x"), 1))', () => {
  it("parses", () => {
    const expected = Fn(["x"], Add(Ref("x"), 1) as never);
    const result = parseDSLSafe('Fn(["x"], Add(Ref("x"), 1))');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
  it("round-trips", () => {
    roundTrip(Fn(["x"], Add(Ref("x"), 1) as never) as never);
  });
});

describe("DSL-061: Let + Fn + Call", () => {
  it("parses", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expected = Let("f", Fn(["x"], Add(Ref("x"), 1) as never), (Call as any)(Ref("f"), [42]));
    const result = parseDSLSafe('Let("f", Fn(["x"], Add(Ref("x"), 1)), Call(Ref("f"), [42]))');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
});

// ── §11.10 Core Fixtures — Complex Workflow ───────────────────────────────────

describe("DSL-070: poll-job pattern", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const C = Call as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pollJobIR = (Fn as any)(
    ["jobId"],
    Let(
      "config",
      Eval("config-service.getRetryConfig", []),
      Let(
        "__loop_0",
        Fn(
          [],
          Let(
            "status",
            Eval("job-service.checkStatus", [Ref("jobId")]),
            If(
              Eq(Get(Ref("status"), "state") as never, "complete" as never),
              Eval("job-service.getResult", [Ref("jobId")]),
              If(
                Eq(Get(Ref("status"), "state") as never, "failed" as never),
                Throw("Job failed" as never),
                Let(
                  "__discard_0",
                  Eval("sleep", [Get(Ref("config"), "intervalMs")]),
                  C(Ref("__loop_0"), []),
                ),
              ),
            ),
          ),
        ),
        C(Ref("__loop_0"), []),
      ),
    ),
  );

  it("round-trips via print", () => {
    const src = print(pollJobIR);
    const result = parseDSLSafe(src);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(pollJobIR);
  });
});

// ── §11.11 Core Fixtures — Arity Enforcement ─────────────────────────────────

describe("DSL-080: too few args for Let", () => {
  it("reports arity error mentioning at least 3", () => {
    const result = parseDSLSafe('Let("x", 1)');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/at least 3/);
  });
});

describe("DSL-081: too many args for Add", () => {
  it("reports arity error mentioning at most 2", () => {
    const result = parseDSLSafe("Add(1, 2, 3)");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/at most 2/);
  });
});

describe("DSL-082: too few args for Ref", () => {
  it("reports arity error mentioning at least 1", () => {
    const result = parseDSLSafe("Ref()");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/at least 1/);
  });
});

// ── §11.12 Core Fixtures — Error Diagnostics ─────────────────────────────────

describe("DSL-090: unknown constructor", () => {
  it("reports unknown constructor error", () => {
    const result = parseDSLSafe("Foo(1, 2)");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Unknown constructor/);
  });
});

describe("DSL-091: bare identifier suggests Ref", () => {
  it('suggests Ref("orderId")', () => {
    const result = parseDSLSafe("orderId");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Ref\("orderId"\)/);
  });
});

describe("DSL-092: unterminated string", () => {
  it("reports a lexical error", () => {
    const result = parseDSLSafe('Ref("hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(DSLParseError);
  });
});

describe("DSL-093: unexpected character", () => {
  it("reports unexpected character error", () => {
    const result = parseDSLSafe("Add(1 @ 2)");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Unexpected character/);
  });
});

describe("DSL-094: trailing tokens after expression", () => {
  it("reports unexpected token error", () => {
    const result = parseDSLSafe("Add(1, 2) Add(3, 4)");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Unexpected token/);
  });
});

describe("DSL-095: error position is accurate", () => {
  it("reports error on line 3 for @@@", () => {
    const result = parseDSLSafe('Let("x",\n  1,\n  @@@)');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.line).toBe(3);
  });
});

// ── §11.13 Core Fixtures — Auto-Close Recovery ───────────────────────────────

describe("DSL-100: trailing parens closed", () => {
  const input = 'Let("x", Add(1, 2), Ref("x")';
  const expectedRepaired = 'Let("x", Add(1, 2), Ref("x"))';

  it("tryAutoClose returns repaired string", () => {
    expect(tryAutoClose(input)).toBe(expectedRepaired);
  });

  it("parseDSLWithRecovery recovers", () => {
    const result = parseDSLWithRecovery(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(expectedRepaired);
      expect(result.value).toEqual(Let("x", Add(1, 2), Ref("x")));
    }
  });
});

describe("DSL-101: nested parens and brackets closed", () => {
  const input = 'Eval("svc.op", [Ref("x"), 42';
  const expectedRepaired = 'Eval("svc.op", [Ref("x"), 42])';

  it("tryAutoClose returns repaired string", () => {
    expect(tryAutoClose(input)).toBe(expectedRepaired);
  });

  it("parseDSLWithRecovery recovers", () => {
    const result = parseDSLWithRecovery(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(expectedRepaired);
      expect(result.value).toEqual(Eval("svc.op", [Ref("x"), 42]));
    }
  });
});

describe("DSL-102: deeply nested recovery", () => {
  const input = 'Let("a", 1, Let("b", 2, Add(Ref("a"), Ref("b")';
  const expectedRepaired = 'Let("a", 1, Let("b", 2, Add(Ref("a"), Ref("b"))))';

  it("tryAutoClose returns repaired string", () => {
    expect(tryAutoClose(input)).toBe(expectedRepaired);
  });

  it("parseDSLWithRecovery recovers", () => {
    const result = parseDSLWithRecovery(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(expectedRepaired);
      expect(result.value).toEqual(
        Let("a", 1, Let("b", 2, Add(Ref("a") as never, Ref("b") as never))),
      );
    }
  });
});

describe("DSL-110: cannot recover missing semantic content", () => {
  it("tryAutoClose returns null when arity is insufficient", () => {
    // Let needs 3 args; only 2 present even after close
    expect(tryAutoClose('Let("x", Add(1, 2)')).toBe(null);
  });

  it("parseDSLWithRecovery reports arity error", () => {
    const result = parseDSLWithRecovery('Let("x", Add(1, 2)');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/at least 3/);
  });
});

describe("DSL-111: cannot recover mismatched delimiters", () => {
  it("tryAutoClose returns null for mismatched delimiters", () => {
    expect(tryAutoClose("Add(1, 2]")).toBe(null);
  });
});

describe("DSL-113: nested delimiters inside one arg do not inflate pending count", () => {
  // Let("x", [[1 has bracketDepth=2 but only 2 args will be present after repair —
  // the two open [ are nested and produce one completed expression, not two.
  it("parseDSLSafe: recovery.autoClosable is false", () => {
    const result = parseDSLSafe('Let("x", [[1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DSLParseError);
      expect((result.error as DSLParseError).recovery?.autoClosable).toBe(false);
    }
  });

  it("parseDSLWithRecovery: does not attempt repair and returns failure", () => {
    const result = parseDSLWithRecovery('Let("x", [[1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.repaired).toBeUndefined();
  });
});

describe("DSL-112: already balanced input passes through", () => {
  it("tryAutoClose returns source unchanged when balanced", () => {
    expect(tryAutoClose("Add(1, 2)")).toBe("Add(1, 2)");
  });

  it("parseDSLWithRecovery parses normally", () => {
    const result = parseDSLWithRecovery("Add(1, 2)");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBeUndefined();
      expect(result.value).toEqual(Add(1, 2));
    }
  });
});

// ── Error object properties ───────────────────────────────────────────────────

describe("DSLParseError carries position properties", () => {
  it("has line, column, offset", () => {
    const result = parseDSLSafe("@");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.error;
      expect(e).toBeInstanceOf(DSLParseError);
      expect(e.line).toBeGreaterThanOrEqual(1);
      expect(e.column).toBeGreaterThanOrEqual(1);
      expect(e.offset).toBeGreaterThanOrEqual(0);
    }
  });

  it("message includes line and col", () => {
    const result = parseDSLSafe("@");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/line 1/);
      expect(result.error.message).toMatch(/col 1/);
    }
  });
});

// ── Extended fixtures ─────────────────────────────────────────────────────────

describe("DSL-200: empty string value", () => {
  it('parses ""', () => {
    expect(parseDSL('""')).toBe("");
  });
});

describe("DSL-201: unicode escape in string", () => {
  it("parses \\u0041 as A", () => {
    expect(parseDSL('"\\u0041"')).toBe("A");
  });
});

describe("DSL-202: zero", () => {
  it("parses 0", () => {
    expect(parseDSL("0")).toBe(0);
  });
});

describe("DSL-203: scientific notation", () => {
  it("parses 1e10", () => {
    expect(parseDSL("1e10")).toBe(1e10);
  });
});

describe("DSL-204: Seq with zero args", () => {
  it("parses Seq()", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expected = (Seq as any)();
    const result = parseDSLSafe("Seq()");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
  });
});

describe("DSL-205: whitespace-only differences", () => {
  it("produces same IR as compact form", () => {
    const relaxed = parseDSLSafe('  Let( "x" , 1 , Ref( "x" ) )  ');
    const compact = parseDSLSafe('Let("x", 1, Ref("x"))');
    expect(relaxed.ok).toBe(true);
    expect(compact.ok).toBe(true);
    if (relaxed.ok && compact.ok) {
      expect(relaxed.ir).toEqual(compact.ir);
    }
  });
});

describe("DSL-206: trailing comma in array", () => {
  it("parses [1, 2, 3,] as [1, 2, 3]", () => {
    expect(parseDSL("[1, 2, 3,]")).toEqual([1, 2, 3]);
  });
});

// ── Malformed number literals ─────────────────────────────────────────────────

describe("Construct with 'tisyn' key in data object", () => {
  it("accepts Construct({ tisyn: 1 }) — plain object, not a tagged node", () => {
    const result = parseDSLSafe("Construct({ tisyn: 1 })");
    expect(result.ok).toBe(true);
  });

  it("round-trips Construct({ tisyn: 1 })", () => {
    const expected = Construct({ tisyn: 1 as never });
    roundTrip(expected);
  });

  it("rejects Construct(Ref('x')) — tagged node, not a plain object", () => {
    const result = parseDSLSafe('Construct(Ref("x"))');
    expect(result.ok).toBe(false);
  });
});

describe("Malformed numbers rejected by tokenizer", () => {
  it("rejects 01 (leading zero)", () => {
    expect(parseDSLSafe("01").ok).toBe(false);
  });

  it("rejects -01 (leading zero after minus)", () => {
    expect(parseDSLSafe("-01").ok).toBe(false);
  });

  it("accepts 0 (bare zero is valid)", () => {
    expect(parseDSL("0")).toBe(0);
  });

  it("accepts 0.5 (zero before decimal is valid)", () => {
    expect(parseDSL("0.5")).toBeCloseTo(0.5);
  });

  it("rejects 1. (no digits after decimal point)", () => {
    expect(parseDSLSafe("Add(1., 2)").ok).toBe(false);
  });

  it("rejects 1e (no digits after exponent)", () => {
    expect(parseDSLSafe("Add(1e, 2)").ok).toBe(false);
  });

  it("rejects 1e+ (sign but no exponent digits)", () => {
    expect(parseDSLSafe("Add(1e+, 2)").ok).toBe(false);
  });

  it("rejects 1E- (sign but no exponent digits)", () => {
    expect(parseDSLSafe("Add(1E-, 2)").ok).toBe(false);
  });

  it("accepts 1.5 (valid float)", () => {
    expect(parseDSLSafe("Add(1.5, 2)").ok).toBe(true);
  });

  it("accepts 1e10 (valid exponent)", () => {
    expect(parseDSLSafe("Add(1e10, 2)").ok).toBe(true);
  });

  it("accepts 1e+10 (valid signed exponent)", () => {
    expect(parseDSLSafe("Add(1e+10, 2)").ok).toBe(true);
  });
});

// ── ArgList: no trailing comma ────────────────────────────────────────────────

describe("ArgList: trailing comma is rejected", () => {
  it("rejects Add(1, 2,)", () => {
    const result = parseDSLSafe("Add(1, 2,)");
    expect(result.ok).toBe(false);
  });
});

// ── All constructors round-trip ───────────────────────────────────────────────

describe("All constructors round-trip via print", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cases: [string, any][] = [
    ["Add", Add(Ref("a") as never, Ref("b") as never)],
    ["Sub", Sub(Ref("a") as never, Ref("b") as never)],
    ["Mul", Mul(Ref("a") as never, Ref("b") as never)],
    ["Div", Div(Ref("a") as never, Ref("b") as never)],
    ["Mod", Mod(Ref("a") as never, Ref("b") as never)],
    ["Neg", Neg(Ref("a") as never)],
    ["Gt", Gt(Ref("a") as never, Ref("b") as never)],
    ["Gte", Gte(Ref("a") as never, Ref("b") as never)],
    ["Lt", Lt(Ref("a") as never, Ref("b") as never)],
    ["Lte", Lte(Ref("a") as never, Ref("b") as never)],
    ["Eq", Eq(Ref("a") as never, Ref("b") as never)],
    ["Neq", Neq(Ref("a") as never, Ref("b") as never)],
    ["And", And(Ref("a") as never, Ref("b") as never)],
    ["Or", Or(Ref("a") as never, Ref("b") as never)],
    ["Not", Not(true as never)],
    ["Arr", Arr(1, 2, 3)],
    ["Arr empty", Arr()],
    ["Concat", Concat("a" as never, "b" as never)],
    ["ConcatArrays", ConcatArrays(Arr(1) as never, Arr(2) as never)],
    ["MergeObjects", MergeObjects(Construct({ a: 1 as never }) as never)],
    ["Seq", Seq(1 as never, 2 as never, 3 as never)],
    ["Q", Q(42)],
    ["While", While(true as never, [1, 2])],
    ["Get", Get(Ref("obj"), "key")],
  ];

  for (const [name, expr] of cases) {
    it(name, () => roundTrip(expr));
  }
});
