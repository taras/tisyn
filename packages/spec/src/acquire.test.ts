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
import { AcquisitionError, type SpecModule } from "./types.ts";

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
      manifest: buildTestManifest([
        { id: "fixture-alpha", spec: fixtureAlpha },
      ]),
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
      manifest: buildTestManifest([
        { id: "fixture-malformed", spec: fixtureMalformed },
      ]),
    });
    let caught: unknown;
    try {
      yield* api.acquireCorpusRegistry();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AcquisitionError);
    expect((caught as AcquisitionError).kind).toBe("F1");
    expect((caught as AcquisitionError).modules.map((m) => m.id)).toContain(
      "fixture-malformed",
    );
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
    expect((caught as AcquisitionError).kind).toBe("F3");
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
