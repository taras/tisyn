import { validateIr, assertValidIr } from "./index.js";
import { it, expect } from "vitest";

// ── Acceptance ──
it("validates scope with null handler and literal body", () => {
  expect(
    validateIr({ tisyn: "eval", id: "scope", data: { tisyn: "quote", expr: { handler: null, bindings: {}, body: 42 } } }).ok,
  ).toBe(true);
});

it("validates scope with fn handler and ref bindings", () => {
  const node = {
    tisyn: "eval",
    id: "scope",
    data: {
      tisyn: "quote",
      expr: {
        handler: { tisyn: "fn", params: ["a", "b"], body: { tisyn: "ref", name: "a" } },
        bindings: { "my-agent": { tisyn: "ref", name: "factoryVar" } },
        body: { tisyn: "ref", name: "x" },
      },
    },
  };
  expect(validateIr(node).ok).toBe(true);
});

// ── Rejection ──
it("rejects scope when data is not a Quote", () => {
  expect(validateIr({ tisyn: "eval", id: "scope", data: 42 }).ok).toBe(false);
});

it("rejects scope when body is a Quote (eval-position violation)", () => {
  const node = {
    tisyn: "eval",
    id: "scope",
    data: {
      tisyn: "quote",
      expr: {
        handler: null,
        bindings: {},
        body: { tisyn: "quote", expr: 42 },
      },
    },
  };
  const result = validateIr(node);
  expect(result.ok).toBe(false);
  expect((result as any).errors[0].code).toBe("QUOTE_AT_EVAL_POSITION");
});

it("rejects scope when handler is not null/fn", () => {
  const node = {
    tisyn: "eval",
    id: "scope",
    data: {
      tisyn: "quote",
      expr: {
        handler: { tisyn: "ref", name: "x" },
        bindings: {},
        body: 42,
      },
    },
  };
  expect(validateIr(node).ok).toBe(false);
});

it("rejects scope when a binding value is not a Ref", () => {
  const node = {
    tisyn: "eval",
    id: "scope",
    data: {
      tisyn: "quote",
      expr: {
        handler: null,
        bindings: { "my-agent": 42 },
        body: 42,
      },
    },
  };
  expect(validateIr(node).ok).toBe(false);
});

// ── assertValidIr used by execute() ──
it("assertValidIr passes for valid scope node", () => {
  expect(() =>
    assertValidIr({
      tisyn: "eval",
      id: "scope",
      data: { tisyn: "quote", expr: { handler: null, bindings: {}, body: 42 } },
    }),
  ).not.toThrow();
});
