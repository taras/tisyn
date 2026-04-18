// SS-AQ: acquisition via createAcquire with in-memory manifests. Covers full
// and filtered scopes plus F1 / F2 / F3 failure modes.

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { createAcquire } from "./acquire.ts";
import { buildTestManifest } from "./__fixtures__/manifest.ts";
import {
  fixtureAlpha,
  fixtureAlphaPlan,
  fixtureBeta,
  fixtureMalformed,
} from "./__fixtures__/index.ts";
import { AcquisitionError, type SpecModule, type TestPlanModule } from "./types.ts";

describe("SS-AQ acquireCorpusRegistry", () => {
  it("full scope loads every manifest entry", function* () {
    const api = createAcquire({
      manifest: buildTestManifest([
        { id: "fixture-alpha", spec: fixtureAlpha, plan: fixtureAlphaPlan },
        { id: "fixture-beta", spec: fixtureBeta },
      ]),
    });
    const registry = yield* api.acquireCorpusRegistry();
    expect(registry.scope).toEqual({ kind: "full" });
    expect(registry.specs.has("fixture-alpha")).toBe(true);
    expect(registry.specs.has("fixture-beta")).toBe(true);
    expect(registry.plans.has("fixture-alpha-plan")).toBe(true);
  });

  it("filtered scope loads only requested specs", function* () {
    const api = createAcquire({
      manifest: buildTestManifest([
        { id: "fixture-alpha", spec: fixtureAlpha },
        { id: "fixture-beta", spec: fixtureBeta },
      ]),
    });
    const registry = yield* api.acquireCorpusRegistry({ specIds: ["fixture-alpha"] });
    expect(registry.scope).toEqual({
      kind: "filtered",
      specIds: ["fixture-alpha"],
    });
    expect(registry.specs.has("fixture-alpha")).toBe(true);
    expect(registry.specs.has("fixture-beta")).toBe(false);
  });

  it("ignores unknown requested spec ids (A6 / RI3)", function* () {
    const api = createAcquire({
      manifest: buildTestManifest([{ id: "fixture-alpha", spec: fixtureAlpha }]),
    });
    const registry = yield* api.acquireCorpusRegistry({
      specIds: ["fixture-alpha", "fixture-does-not-exist"],
    });
    expect(registry.specs.has("fixture-alpha")).toBe(true);
  });
});

describe("SS-AQ F1 — normalization failure", () => {
  it("raises AcquisitionError(kind=F1) listing the failing module", function* () {
    const api = createAcquire({
      manifest: buildTestManifest([{ id: "fixture-malformed", spec: fixtureMalformed }]),
    });
    let caught: unknown;
    try {
      yield* api.acquireCorpusRegistry();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AcquisitionError);
    expect((caught as AcquisitionError).kind).toBe("F1");
    expect((caught as AcquisitionError).modules.map((m) => m.id)).toContain("fixture-malformed");
  });
});

describe("SS-AQ F2 — source unavailable", () => {
  it("raises AcquisitionError(kind=F2) when loadSpec rejects", function* () {
    const api = createAcquire({
      manifest: [
        {
          id: "broken",
          loadSpec: () => Promise.reject(new Error("boom")),
        },
      ],
    });
    let caught: unknown;
    try {
      yield* api.acquireCorpusRegistry();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AcquisitionError);
    expect((caught as AcquisitionError).kind).toBe("F2");
  });
});

describe("SS-AQ F3 — duplicate id", () => {
  it("raises AcquisitionError(kind=F3) when two manifest entries yield the same spec id", function* () {
    const dup: SpecModule = { ...fixtureAlpha, id: "fixture-alpha" };
    const api = createAcquire({
      manifest: [
        { id: "first", loadSpec: () => Promise.resolve(fixtureAlpha) },
        { id: "second", loadSpec: () => Promise.resolve(dup) },
      ],
    });
    let caught: unknown;
    try {
      yield* api.acquireCorpusRegistry();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AcquisitionError);
    const err = caught as AcquisitionError;
    expect(err.kind).toBe("F3");
    expect(err.modules).toHaveLength(2);
    expect(err.modules.every((m) => m.id === "fixture-alpha")).toBe(true);
    const reasons = err.modules.map((m) => m.reason).join(" | ");
    expect(reasons).toMatch(/"first"/);
    expect(reasons).toMatch(/"second"/);
  });

  it("raises AcquisitionError(kind=F3) when a spec and a test-plan share an id (D2 + D18)", function* () {
    const collidingPlan: TestPlanModule = {
      ...fixtureAlphaPlan,
      id: "fixture-beta",
    };
    const api = createAcquire({
      manifest: [
        { id: "beta-entry", loadSpec: () => Promise.resolve(fixtureBeta) },
        {
          id: "plan-entry",
          loadSpec: () => Promise.resolve(fixtureAlpha),
          loadPlan: () => Promise.resolve(collidingPlan),
        },
      ],
    });
    let caught: unknown;
    try {
      yield* api.acquireCorpusRegistry();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AcquisitionError);
    const err = caught as AcquisitionError;
    expect(err.kind).toBe("F3");
    expect(err.modules).toHaveLength(2);
    expect(err.modules.every((m) => m.id === "fixture-beta")).toBe(true);
    const reasons = err.modules.map((m) => m.reason).join(" | ");
    expect(reasons).toMatch(/spec from manifest entry "beta-entry"/);
    expect(reasons).toMatch(/test-plan from manifest entry "plan-entry"/);
  });

  it("F3 error identifies both colliding modules in `modules`", function* () {
    const dup: SpecModule = { ...fixtureAlpha, id: "fixture-alpha" };
    const api = createAcquire({
      manifest: [
        { id: "first", loadSpec: () => Promise.resolve(fixtureAlpha) },
        { id: "second", loadSpec: () => Promise.resolve(dup) },
      ],
    });
    let caught: unknown;
    try {
      yield* api.acquireCorpusRegistry();
    } catch (e) {
      caught = e;
    }
    const err = caught as AcquisitionError;
    expect(err.modules).toHaveLength(2);
    expect(err.modules[0]!.id).toBe("fixture-alpha");
    expect(err.modules[1]!.id).toBe("fixture-alpha");
    expect(err.modules[0]!.reason).not.toBe(err.modules[1]!.reason);
  });
});

describe("SS-AQ auxiliary readers are isolated", () => {
  it("acquireFixture uses the injected reader", function* () {
    function* fakeReadFixture(): Generator<unknown, string, unknown> {
      return "FIXTURE_TEXT";
    }
    const api = createAcquire({
      manifest: [],
      readFixture: fakeReadFixture,
    });
    const text = yield* api.acquireFixture("any", "spec");
    expect(text).toBe("FIXTURE_TEXT");
  });
});
