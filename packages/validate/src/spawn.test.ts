import { validateIr } from "./index.js";
import { it, expect } from "vitest";

// ── Acceptance ──

it("validates spawn with literal body", () => {
  expect(
    validateIr({
      tisyn: "eval",
      id: "spawn",
      data: { tisyn: "quote", expr: { body: 42 } },
    }).ok,
  ).toBe(true);
});

it("validates spawn with ref body", () => {
  expect(
    validateIr({
      tisyn: "eval",
      id: "spawn",
      data: { tisyn: "quote", expr: { body: { tisyn: "ref", name: "x" } } },
    }).ok,
  ).toBe(true);
});

it("validates join with ref data", () => {
  expect(
    validateIr({
      tisyn: "eval",
      id: "join",
      data: { tisyn: "ref", name: "task" },
    }).ok,
  ).toBe(true);
});

// ── Rejection ──

it("rejects spawn when data is not a Quote", () => {
  expect(validateIr({ tisyn: "eval", id: "spawn", data: 42 }).ok).toBe(false);
});

it("rejects spawn without body", () => {
  const result = validateIr({
    tisyn: "eval",
    id: "spawn",
    data: { tisyn: "quote", expr: {} },
  });
  expect(result.ok).toBe(false);
});

it("rejects spawn when body is a Quote (eval-position violation)", () => {
  const result = validateIr({
    tisyn: "eval",
    id: "spawn",
    data: {
      tisyn: "quote",
      expr: { body: { tisyn: "quote", expr: 42 } },
    },
  });
  expect(result.ok).toBe(false);
  expect((result as any).errors[0].code).toBe("QUOTE_AT_EVAL_POSITION");
});

it("rejects join when data is not a Ref", () => {
  const result = validateIr({
    tisyn: "eval",
    id: "join",
    data: { tisyn: "quote", expr: { body: 42 } },
  });
  expect(result.ok).toBe(false);
});

it("rejects join when data is a literal", () => {
  expect(validateIr({ tisyn: "eval", id: "join", data: 42 }).ok).toBe(false);
});
