import { describe, it, expect } from "vitest";
import {
  validateGrammar,
  validateIr,
  assertValidIr,
  MalformedIR,
  MALFORMED_EVAL,
  MALFORMED_QUOTE,
  MALFORMED_REF,
  MALFORMED_FN_PARAMS,
  MALFORMED_FN_BODY,
  STRUCTURAL_REQUIRES_QUOTE,
  QUOTE_AT_EVAL_POSITION,
  tisynExprSchema,
  evalSchema,
  quoteSchema,
  refSchema,
  fnSchema,
} from "./index.js";

// ── Level 1: Grammar ──

describe("validateGrammar", () => {
  describe("primitives", () => {
    it("accepts strings", () => {
      expect(validateGrammar("hello")).toEqual({ ok: true, node: "hello" });
    });
    it("accepts numbers", () => {
      expect(validateGrammar(42)).toEqual({ ok: true, node: 42 });
    });
    it("accepts booleans", () => {
      expect(validateGrammar(true)).toEqual({ ok: true, node: true });
    });
    it("accepts null", () => {
      expect(validateGrammar(null)).toEqual({ ok: true, node: null });
    });
  });

  describe("arrays", () => {
    it("accepts plain arrays", () => {
      expect(validateGrammar([1, 2, 3])).toEqual({
        ok: true,
        node: [1, 2, 3],
      });
    });
    it("rejects arrays with malformed nodes", () => {
      const result = validateGrammar([{ tisyn: "eval" }]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].path).toEqual(["0"]);
      }
    });
  });

  describe("object literals", () => {
    it("accepts plain objects", () => {
      expect(validateGrammar({ a: 1, b: "two" }).ok).toBe(true);
    });
    it("accepts objects with unknown tisyn value", () => {
      expect(validateGrammar({ tisyn: "unknown", x: 1 }).ok).toBe(true);
    });
    it("accepts objects without tisyn field", () => {
      expect(validateGrammar({ foo: "bar" }).ok).toBe(true);
    });
    it("recurses into literal object values", () => {
      const result = validateGrammar({ nested: { tisyn: "eval" } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].path).toEqual(["nested"]);
      }
    });
  });

  describe("eval nodes", () => {
    it("accepts valid eval", () => {
      expect(validateGrammar({ tisyn: "eval", id: "add", data: 1 }).ok).toBe(
        true,
      );
    });
    it("accepts eval with extra fields", () => {
      expect(
        validateGrammar({ tisyn: "eval", id: "add", data: 1, extra: 2 }).ok,
      ).toBe(true);
    });
    it("rejects eval missing id", () => {
      const result = validateGrammar({ tisyn: "eval", data: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_EVAL);
      }
    });
    it("rejects eval with empty id", () => {
      const result = validateGrammar({ tisyn: "eval", id: "", data: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_EVAL);
      }
    });
    it("rejects eval with non-string id", () => {
      const result = validateGrammar({ tisyn: "eval", id: 42, data: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_EVAL);
      }
    });
    it("rejects eval missing data", () => {
      const result = validateGrammar({ tisyn: "eval", id: "add" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_EVAL);
      }
    });
  });

  describe("quote nodes", () => {
    it("accepts valid quote", () => {
      expect(validateGrammar({ tisyn: "quote", expr: 1 }).ok).toBe(true);
    });
    it("rejects quote missing expr", () => {
      const result = validateGrammar({ tisyn: "quote" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_QUOTE);
      }
    });
  });

  describe("ref nodes", () => {
    it("accepts valid ref", () => {
      expect(validateGrammar({ tisyn: "ref", name: "x" }).ok).toBe(true);
    });
    it("rejects ref with empty name", () => {
      const result = validateGrammar({ tisyn: "ref", name: "" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_REF);
      }
    });
    it("rejects ref missing name", () => {
      const result = validateGrammar({ tisyn: "ref" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_REF);
      }
    });
    it("rejects ref with non-string name", () => {
      const result = validateGrammar({ tisyn: "ref", name: 42 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_REF);
      }
    });
  });

  describe("fn nodes", () => {
    it("accepts valid fn", () => {
      expect(
        validateGrammar({ tisyn: "fn", params: ["x"], body: 1 }).ok,
      ).toBe(true);
    });
    it("accepts fn with empty params array", () => {
      expect(validateGrammar({ tisyn: "fn", params: [], body: 1 }).ok).toBe(
        true,
      );
    });
    it("rejects fn with non-array params", () => {
      const result = validateGrammar({
        tisyn: "fn",
        params: "x",
        body: 1,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_FN_PARAMS);
      }
    });
    it("rejects fn with empty string param", () => {
      const result = validateGrammar({ tisyn: "fn", params: [""], body: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_FN_PARAMS);
      }
    });
    it("rejects fn with non-string param", () => {
      const result = validateGrammar({ tisyn: "fn", params: [42], body: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_FN_PARAMS);
      }
    });
    it("rejects fn with duplicate params", () => {
      const result = validateGrammar({
        tisyn: "fn",
        params: ["x", "x"],
        body: 1,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_FN_PARAMS);
      }
    });
    it("rejects fn missing body", () => {
      const result = validateGrammar({ tisyn: "fn", params: ["x"] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_FN_BODY);
      }
    });
  });

  describe("nested validation", () => {
    it("validates eval data recursively", () => {
      const result = validateGrammar({
        tisyn: "eval",
        id: "call",
        data: { tisyn: "quote", expr: { fn: { tisyn: "ref" } } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_REF);
        expect(result.errors[0].path).toEqual(["data", "expr", "fn"]);
      }
    });

    it("validates fn body recursively", () => {
      const result = validateGrammar({
        tisyn: "fn",
        params: ["x"],
        body: { tisyn: "eval" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(MALFORMED_EVAL);
        expect(result.errors[0].path).toEqual(["body"]);
      }
    });
  });
});

// ── Level 2: Semantic ──

describe("validateIr", () => {
  describe("structural operations require Quote data", () => {
    it("accepts structural eval with Quote data", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "add",
        data: { tisyn: "quote", expr: { a: 1, b: 2 } },
      });
      expect(result.ok).toBe(true);
    });

    it("rejects structural eval without Quote data", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "add",
        data: { a: 1, b: 2 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(STRUCTURAL_REQUIRES_QUOTE);
        expect(result.errors[0].level).toBe(2);
      }
    });

    it("accepts external eval without Quote data", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "custom-op",
        data: 42,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("single-Quote rule — no Quote at evaluation positions", () => {
    it("rejects Quote at binary evaluation position (add.a)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "add",
        data: {
          tisyn: "quote",
          expr: { a: { tisyn: "quote", expr: 1 }, b: 2 },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(QUOTE_AT_EVAL_POSITION);
      }
    });

    it("rejects Quote at binary evaluation position (add.b)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "add",
        data: {
          tisyn: "quote",
          expr: { a: 1, b: { tisyn: "quote", expr: 2 } },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(QUOTE_AT_EVAL_POSITION);
      }
    });

    it("rejects Quote at unary evaluation position (neg.a)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "neg",
        data: {
          tisyn: "quote",
          expr: { a: { tisyn: "quote", expr: 1 } },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(QUOTE_AT_EVAL_POSITION);
      }
    });

    it("allows Quote at non-evaluation position (get.key is not eval position)", () => {
      // get.obj is an evaluation position, get.key is not
      const result = validateIr({
        tisyn: "eval",
        id: "get",
        data: {
          tisyn: "quote",
          expr: { obj: { tisyn: "ref", name: "x" }, key: "prop" },
        },
      });
      expect(result.ok).toBe(true);
    });

    it("rejects Quote at get.obj evaluation position", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "get",
        data: {
          tisyn: "quote",
          expr: { obj: { tisyn: "quote", expr: 1 }, key: "prop" },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(QUOTE_AT_EVAL_POSITION);
      }
    });
  });

  describe("structural operations — positions table coverage", () => {
    it("validates let (value and body are eval positions)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "let",
        data: {
          tisyn: "quote",
          expr: {
            name: "x",
            value: { tisyn: "quote", expr: 1 },
            body: 2,
          },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].code).toBe(QUOTE_AT_EVAL_POSITION);
      }
    });

    it("accepts valid let", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "let",
        data: {
          tisyn: "quote",
          expr: { name: "x", value: 1, body: { tisyn: "ref", name: "x" } },
        },
      });
      expect(result.ok).toBe(true);
    });

    it("validates seq (exprs are eval positions)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "seq",
        data: {
          tisyn: "quote",
          expr: { exprs: [{ tisyn: "quote", expr: 1 }] },
        },
      });
      expect(result.ok).toBe(false);
    });

    it("accepts valid seq", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "seq",
        data: { tisyn: "quote", expr: { exprs: [1, 2, 3] } },
      });
      expect(result.ok).toBe(true);
    });

    it("validates if (condition, then, else are eval positions)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "if",
        data: {
          tisyn: "quote",
          expr: {
            condition: { tisyn: "quote", expr: true },
            then: 1,
            else: 2,
          },
        },
      });
      expect(result.ok).toBe(false);
    });

    it("accepts valid if", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "if",
        data: {
          tisyn: "quote",
          expr: { condition: true, then: 1, else: 2 },
        },
      });
      expect(result.ok).toBe(true);
    });

    it("validates while (condition and exprs are eval positions)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "while",
        data: {
          tisyn: "quote",
          expr: {
            condition: { tisyn: "quote", expr: true },
            exprs: [],
          },
        },
      });
      expect(result.ok).toBe(false);
    });

    it("validates call (fn and args are eval positions)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "call",
        data: {
          tisyn: "quote",
          expr: {
            fn: { tisyn: "quote", expr: 1 },
            args: [],
          },
        },
      });
      expect(result.ok).toBe(false);
    });

    it("accepts valid call", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "call",
        data: {
          tisyn: "quote",
          expr: { fn: { tisyn: "ref", name: "f" }, args: [1, 2] },
        },
      });
      expect(result.ok).toBe(true);
    });

    it("validates construct (values are eval positions)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "construct",
        data: {
          tisyn: "quote",
          expr: { x: { tisyn: "quote", expr: 1 } },
        },
      });
      expect(result.ok).toBe(false);
    });

    it("accepts valid construct", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "construct",
        data: { tisyn: "quote", expr: { x: 1, y: 2 } },
      });
      expect(result.ok).toBe(true);
    });

    it("validates array (items are eval positions)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "array",
        data: {
          tisyn: "quote",
          expr: { items: [{ tisyn: "quote", expr: 1 }] },
        },
      });
      expect(result.ok).toBe(false);
    });

    it("validates concat (parts are eval positions)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "concat",
        data: {
          tisyn: "quote",
          expr: { parts: [{ tisyn: "quote", expr: "a" }] },
        },
      });
      expect(result.ok).toBe(false);
    });

    it("validates throw (message is eval position)", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "throw",
        data: {
          tisyn: "quote",
          expr: { message: { tisyn: "quote", expr: "err" } },
        },
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("staged error behavior", () => {
    it("returns only Level 1 errors when grammar fails", () => {
      // This has a grammar error (missing id) AND would have a semantic error
      const result = validateIr({ tisyn: "eval", data: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.every((e) => e.level === 1)).toBe(true);
      }
    });

    it("returns only Level 2 errors when grammar passes but semantics fail", () => {
      const result = validateIr({
        tisyn: "eval",
        id: "add",
        data: { a: 1, b: 2 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.every((e) => e.level === 2)).toBe(true);
      }
    });
  });
});

// ── assertValidIr ──

describe("assertValidIr", () => {
  it("returns TisynExpr for valid input", () => {
    const node = assertValidIr(42);
    expect(node).toBe(42);
  });

  it("returns TisynExpr for valid eval", () => {
    const input = {
      tisyn: "eval",
      id: "add",
      data: { tisyn: "quote", expr: { a: 1, b: 2 } },
    };
    const node = assertValidIr(input);
    expect(node).toBe(input);
  });

  it("throws MalformedIR for invalid input", () => {
    expect(() => assertValidIr({ tisyn: "eval" })).toThrow(MalformedIR);
  });

  it("thrown error has name MalformedIR", () => {
    try {
      assertValidIr({ tisyn: "eval" });
    } catch (e) {
      expect((e as Error).name).toBe("MalformedIR");
    }
  });
});

// ── JSON Schema exports ──

describe("JSON Schema exports", () => {
  it("tisynExprSchema is serializable", () => {
    expect(() => JSON.stringify(tisynExprSchema)).not.toThrow();
  });

  it("evalSchema is serializable", () => {
    expect(() => JSON.stringify(evalSchema)).not.toThrow();
  });

  it("quoteSchema is serializable", () => {
    expect(() => JSON.stringify(quoteSchema)).not.toThrow();
  });

  it("refSchema is serializable", () => {
    expect(() => JSON.stringify(refSchema)).not.toThrow();
  });

  it("fnSchema is serializable", () => {
    expect(() => JSON.stringify(fnSchema)).not.toThrow();
  });

  it("schemas are plain objects", () => {
    expect(typeof tisynExprSchema).toBe("object");
    expect(typeof evalSchema).toBe("object");
  });
});
