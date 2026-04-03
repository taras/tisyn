import { validateIr, TIMEBOX_DURATION_EXTERNAL, MALFORMED_EVAL } from "./index.js";
import { describe, it, expect } from "vitest";

// ── Acceptance ──

describe("timebox validation — acceptance", () => {
  it("TIV-01: validates timebox with literal duration", () => {
    expect(
      validateIr({
        tisyn: "eval",
        id: "timebox",
        data: { tisyn: "quote", expr: { duration: 5000, body: 42 } },
      }).ok,
    ).toBe(true);
  });

  it("TIV-02: validates timebox with Ref duration", () => {
    expect(
      validateIr({
        tisyn: "eval",
        id: "timebox",
        data: {
          tisyn: "quote",
          expr: { duration: { tisyn: "ref", name: "t" }, body: 42 },
        },
      }).ok,
    ).toBe(true);
  });

  it("TIV-03: validates timebox with structural expression duration", () => {
    expect(
      validateIr({
        tisyn: "eval",
        id: "timebox",
        data: {
          tisyn: "quote",
          expr: {
            duration: {
              tisyn: "eval",
              id: "mul",
              data: { tisyn: "quote", expr: { a: 5000, b: 2 } },
            },
            body: 42,
          },
        },
      }).ok,
    ).toBe(true);
  });

  it("TIV-06: validates timebox with external Evals in body", () => {
    expect(
      validateIr({
        tisyn: "eval",
        id: "timebox",
        data: {
          tisyn: "quote",
          expr: {
            duration: 5000,
            body: { tisyn: "eval", id: "agent.work", data: [] },
          },
        },
      }).ok,
    ).toBe(true);
  });
});

// ── Rejection: duration subtree ──

describe("timebox validation — duration subtree", () => {
  it("TIV-04: rejects external Eval in duration", () => {
    const result = validateIr({
      tisyn: "eval",
      id: "timebox",
      data: {
        tisyn: "quote",
        expr: {
          duration: { tisyn: "eval", id: "config.getTimeout", data: [] },
          body: 42,
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe(TIMEBOX_DURATION_EXTERNAL);
    }
  });

  it("TIV-05: rejects external Eval nested inside structural duration", () => {
    const result = validateIr({
      tisyn: "eval",
      id: "timebox",
      data: {
        tisyn: "quote",
        expr: {
          duration: {
            tisyn: "eval",
            id: "add",
            data: {
              tisyn: "quote",
              expr: {
                a: { tisyn: "eval", id: "config.getBase", data: [] },
                b: 1000,
              },
            },
          },
          body: 42,
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === TIMEBOX_DURATION_EXTERNAL)).toBe(true);
    }
  });
});

// ── Rejection: structural ──

describe("timebox validation — structural", () => {
  it("rejects timebox when data is not a Quote", () => {
    expect(validateIr({ tisyn: "eval", id: "timebox", data: 42 }).ok).toBe(false);
  });

  it("rejects timebox without duration field", () => {
    const result = validateIr({
      tisyn: "eval",
      id: "timebox",
      data: { tisyn: "quote", expr: { body: 42 } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === MALFORMED_EVAL)).toBe(true);
    }
  });

  it("rejects timebox without body field", () => {
    const result = validateIr({
      tisyn: "eval",
      id: "timebox",
      data: { tisyn: "quote", expr: { duration: 5000 } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === MALFORMED_EVAL)).toBe(true);
    }
  });
});
