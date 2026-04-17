// SS-NM: normalization result shape, determinism, ISO-8601 timestamp, no-throw.

import { describe, expect, it } from "vitest";
import { normalizeSpec, normalizeTestPlan } from "./normalize.ts";
import { fixtureAlpha, fixtureAlphaPlan, fixtureMalformed } from "./__fixtures__/index.ts";

describe("SS-NM normalizeSpec", () => {
  it("returns { status: 'ok' } with _hash + _normalizedAt on valid input", () => {
    const r = normalizeSpec(fixtureAlpha);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.value._hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r.value._normalizedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("hash is deterministic — re-normalizing produces the same hash", () => {
    const a = normalizeSpec(fixtureAlpha);
    const b = normalizeSpec(fixtureAlpha);
    if (a.status !== "ok" || b.status !== "ok") throw new Error("expected ok");
    expect(a.value._hash).toBe(b.value._hash);
  });

  it("returns { status: 'error' } with constraint codes on malformed input (never throws)", () => {
    const r = normalizeSpec(fixtureMalformed);
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.errors.length).toBeGreaterThan(0);
    for (const e of r.errors) {
      expect(e.constraint).toMatch(/^(V\d|D\d|I\d)/);
    }
  });

  it("deep-freezes the ok value", () => {
    const r = normalizeSpec(fixtureAlpha);
    if (r.status !== "ok") throw new Error("expected ok");
    expect(Object.isFrozen(r.value)).toBe(true);
    expect(Object.isFrozen(r.value.sections)).toBe(true);
  });
});

describe("SS-NM normalizeTestPlan", () => {
  it("returns { status: 'ok' } on valid input", () => {
    const r = normalizeTestPlan(fixtureAlphaPlan);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.value._hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
