import { validateIr } from "./index.js";
import { it, expect } from "vitest";

// ── Acceptance ──

it("validates resource with literal body", () => {
  expect(
    validateIr({
      tisyn: "eval",
      id: "resource",
      data: { tisyn: "quote", expr: { body: 42 } },
    }).ok,
  ).toBe(true);
});

it("validates resource with ref body", () => {
  expect(
    validateIr({
      tisyn: "eval",
      id: "resource",
      data: { tisyn: "quote", expr: { body: { tisyn: "ref", name: "x" } } },
    }).ok,
  ).toBe(true);
});

it("validates provide with literal data", () => {
  expect(
    validateIr({
      tisyn: "eval",
      id: "provide",
      data: 42,
    }).ok,
  ).toBe(true);
});

it("validates provide with ref data", () => {
  expect(
    validateIr({
      tisyn: "eval",
      id: "provide",
      data: { tisyn: "ref", name: "conn" },
    }).ok,
  ).toBe(true);
});

it("validates provide with eval data", () => {
  expect(
    validateIr({
      tisyn: "eval",
      id: "provide",
      data: { tisyn: "eval", id: "add", data: { tisyn: "quote", expr: { a: 1, b: 2 } } },
    }).ok,
  ).toBe(true);
});

// ── Rejection ──

it("rejects resource when data is not a Quote", () => {
  expect(validateIr({ tisyn: "eval", id: "resource", data: 42 }).ok).toBe(false);
});

it("rejects resource without body", () => {
  const result = validateIr({
    tisyn: "eval",
    id: "resource",
    data: { tisyn: "quote", expr: {} },
  });
  expect(result.ok).toBe(false);
});

it("rejects resource when body is a Quote (eval-position violation)", () => {
  const result = validateIr({
    tisyn: "eval",
    id: "resource",
    data: {
      tisyn: "quote",
      expr: { body: { tisyn: "quote", expr: 42 } },
    },
  });
  expect(result.ok).toBe(false);
  expect((result as any).errors[0].code).toBe("QUOTE_AT_EVAL_POSITION");
});
