/**
 * Parity tests — verifies that @tisyn/validate produces the same
 * accept/reject outcomes as classifyNode from @tisyn/ir.
 *
 * Also exercises validateIr against a shared fixture set to confirm
 * expected semantic outcomes.
 *
 * These tests check outcome and error class/code, NOT exact error
 * message strings. Behavioral parity, not string-level compatibility.
 */

import { describe, it, expect } from "vitest";
import { classifyNode } from "@tisyn/ir";
import { validateGrammar, validateIr } from "./validate.js";

// ── Fixture definitions ──

interface Fixture {
  name: string;
  input: unknown;
  /** Whether classifyNode (recursively) accepts this input */
  grammarAccepted: boolean;
  /** Whether full IR validation (grammar + semantic) accepts this input */
  semanticAccepted: boolean;
}

const fixtures: Fixture[] = [
  // ── Primitives (always accepted) ──
  { name: "number literal", input: 42, grammarAccepted: true, semanticAccepted: true },
  { name: "string literal", input: "hello", grammarAccepted: true, semanticAccepted: true },
  { name: "boolean literal", input: true, grammarAccepted: true, semanticAccepted: true },
  { name: "null literal", input: null, grammarAccepted: true, semanticAccepted: true },

  // ── Arrays ──
  { name: "empty array", input: [], grammarAccepted: true, semanticAccepted: true },
  {
    name: "array of literals",
    input: [1, "a", null],
    grammarAccepted: true,
    semanticAccepted: true,
  },

  // ── Object literals ──
  { name: "plain object", input: { a: 1, b: 2 }, grammarAccepted: true, semanticAccepted: true },
  {
    name: "object with unknown tisyn",
    input: { tisyn: "unknown", x: 1 },
    grammarAccepted: true,
    semanticAccepted: true,
  },
  { name: "empty object", input: {}, grammarAccepted: true, semanticAccepted: true },

  // ── Valid tagged nodes ──
  {
    name: "valid eval",
    input: { tisyn: "eval", id: "custom", data: 1 },
    grammarAccepted: true,
    semanticAccepted: true,
  },
  {
    name: "valid quote",
    input: { tisyn: "quote", expr: 42 },
    grammarAccepted: true,
    semanticAccepted: true,
  },
  {
    name: "valid ref",
    input: { tisyn: "ref", name: "x" },
    grammarAccepted: true,
    semanticAccepted: true,
  },
  {
    name: "valid fn",
    input: { tisyn: "fn", params: ["x", "y"], body: 1 },
    grammarAccepted: true,
    semanticAccepted: true,
  },
  {
    name: "fn with empty params array",
    input: { tisyn: "fn", params: [], body: 1 },
    grammarAccepted: true,
    semanticAccepted: true,
  },

  // ── Extra fields on tagged nodes (accepted) ──
  {
    name: "eval with extra fields",
    input: { tisyn: "eval", id: "x", data: 1, extra: true },
    grammarAccepted: true,
    semanticAccepted: true,
  },
  {
    name: "ref with extra fields",
    input: { tisyn: "ref", name: "x", extra: true },
    grammarAccepted: true,
    semanticAccepted: true,
  },

  // ── Malformed tagged nodes (grammar rejected) ──
  {
    name: "eval missing id",
    input: { tisyn: "eval", data: 1 },
    grammarAccepted: false,
    semanticAccepted: false,
  },
  {
    name: "eval empty id",
    input: { tisyn: "eval", id: "", data: 1 },
    grammarAccepted: false,
    semanticAccepted: false,
  },
  {
    name: "eval non-string id",
    input: { tisyn: "eval", id: 42, data: 1 },
    grammarAccepted: false,
    semanticAccepted: false,
  },
  {
    name: "eval missing data",
    input: { tisyn: "eval", id: "x" },
    grammarAccepted: false,
    semanticAccepted: false,
  },
  {
    name: "quote missing expr",
    input: { tisyn: "quote" },
    grammarAccepted: false,
    semanticAccepted: false,
  },
  {
    name: "ref missing name",
    input: { tisyn: "ref" },
    grammarAccepted: false,
    semanticAccepted: false,
  },
  {
    name: "ref empty name",
    input: { tisyn: "ref", name: "" },
    grammarAccepted: false,
    semanticAccepted: false,
  },
  {
    name: "ref non-string name",
    input: { tisyn: "ref", name: 42 },
    grammarAccepted: false,
    semanticAccepted: false,
  },
  {
    name: "fn non-array params",
    input: { tisyn: "fn", params: "x", body: 1 },
    grammarAccepted: false,
    semanticAccepted: false,
  },
  {
    name: "fn empty string param",
    input: { tisyn: "fn", params: [""], body: 1 },
    grammarAccepted: false,
    semanticAccepted: false,
  },
  {
    name: "fn duplicate params",
    input: { tisyn: "fn", params: ["x", "x"], body: 1 },
    grammarAccepted: false,
    semanticAccepted: false,
  },
  {
    name: "fn missing body",
    input: { tisyn: "fn", params: ["x"] },
    grammarAccepted: false,
    semanticAccepted: false,
  },

  // ── Structural ops: semantic accepted ──
  {
    name: "structural add with quote data",
    input: { tisyn: "eval", id: "add", data: { tisyn: "quote", expr: { a: 1, b: 2 } } },
    grammarAccepted: true,
    semanticAccepted: true,
  },
  {
    name: "structural let with quote data",
    input: {
      tisyn: "eval",
      id: "let",
      data: { tisyn: "quote", expr: { name: "x", value: 1, body: 2 } },
    },
    grammarAccepted: true,
    semanticAccepted: true,
  },

  // ── Structural ops: semantic rejected ──
  {
    name: "structural add without quote data",
    input: { tisyn: "eval", id: "add", data: { a: 1, b: 2 } },
    grammarAccepted: true,
    semanticAccepted: false,
  },
  {
    name: "structural add with quote at eval position",
    input: {
      tisyn: "eval",
      id: "add",
      data: { tisyn: "quote", expr: { a: { tisyn: "quote", expr: 1 }, b: 2 } },
    },
    grammarAccepted: true,
    semanticAccepted: false,
  },

  // ── Nested structures ──
  {
    name: "nested valid structure",
    input: {
      tisyn: "eval",
      id: "call",
      data: {
        tisyn: "quote",
        expr: {
          fn: { tisyn: "ref", name: "f" },
          args: [1, { tisyn: "ref", name: "x" }],
        },
      },
    },
    grammarAccepted: true,
    semanticAccepted: true,
  },
  {
    name: "array containing malformed node",
    input: [1, { tisyn: "eval" }, 3],
    grammarAccepted: false,
    semanticAccepted: false,
  },
];

// ── Helper: recursive classifyNode walk ──

function classifyAccepts(input: unknown): boolean {
  if (input === null || typeof input !== "object") {
    return true;
  }
  if (Array.isArray(input)) {
    return input.every(classifyAccepts);
  }

  const obj = input as Record<string, unknown>;
  const classification = classifyNode(obj);
  if (classification === "malformed") {
    return false;
  }

  if (classification === "literal") {
    return Object.values(obj).every(classifyAccepts);
  }

  switch (classification) {
    case "eval":
      return classifyAccepts(obj["data"]);
    case "quote":
      return classifyAccepts(obj["expr"]);
    case "fn":
      return classifyAccepts(obj["body"]);
    case "ref":
      return true;
    default:
      return true;
  }
}

// ── Parity test suites ──

describe("parity with classifyNode (Level 1 grammar)", () => {
  for (const fixture of fixtures) {
    it(`${fixture.name}: validateGrammar ${fixture.grammarAccepted ? "accepts" : "rejects"}`, () => {
      const classifyResult = classifyAccepts(fixture.input);
      const validateResult = validateGrammar(fixture.input);

      expect(classifyResult).toBe(fixture.grammarAccepted);
      expect(validateResult.ok).toBe(fixture.grammarAccepted);
      expect(validateResult.ok).toBe(classifyResult);
    });
  }
});

describe("validateIr fixture outcomes (Level 1 + Level 2)", () => {
  for (const fixture of fixtures) {
    it(`${fixture.name}: validateIr ${fixture.semanticAccepted ? "accepts" : "rejects"}`, () => {
      const result = validateIr(fixture.input);
      expect(result.ok).toBe(fixture.semanticAccepted);
    });
  }
});
