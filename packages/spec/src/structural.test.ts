// SS-DM: structural V1–V9 + I8 validation surfaces exact constraint codes.

import { describe, expect, it } from "vitest";
import { normalizeSpec, normalizeTestPlan } from "./normalize.ts";
import type { SpecModule, TestPlanModule } from "./types.ts";
import { fixtureAlpha, fixtureAlphaPlan } from "./__fixtures__/index.ts";

function constraints(errs: readonly { constraint: string }[]): string[] {
  return errs.map((e) => e.constraint);
}

describe("SS-DM V1 — tisyn_spec discriminant on root module", () => {
  it("rejects root SpecModule missing tisyn_spec", () => {
    const bad = { ...fixtureAlpha, tisyn_spec: undefined } as unknown as SpecModule;
    const r = normalizeSpec(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("V1");
  });

  it("rejects root TestPlanModule missing tisyn_spec", () => {
    const bad = { ...fixtureAlphaPlan, tisyn_spec: undefined } as unknown as TestPlanModule;
    const r = normalizeTestPlan(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("V1");
  });
});

describe("SS-DM V2 — id non-emptiness", () => {
  it("rejects empty spec id (D1)", () => {
    const bad: SpecModule = { ...fixtureAlpha, id: "" };
    const r = normalizeSpec(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("V2");
  });

  it("rejects empty rule id (D8)", () => {
    const bad: SpecModule = {
      ...fixtureAlpha,
      sections: [
        {
          ...fixtureAlpha.sections[0],
          rules: [{ id: "", level: "must", text: "empty id" }],
        },
      ],
    };
    const r = normalizeSpec(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("V2");
  });
});

describe("SS-DM V3 — uniqueness for D-rules V3 names", () => {
  it("rejects duplicate section ids within a spec (D5)", () => {
    const bad: SpecModule = {
      ...fixtureAlpha,
      sections: [fixtureAlpha.sections[0], { id: 1, title: "Dup", prose: "" }],
    };
    const r = normalizeSpec(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("V3");
  });

  it("rejects duplicate rule ids within a spec (D8)", () => {
    const bad: SpecModule = {
      ...fixtureAlpha,
      sections: [
        {
          id: 1,
          title: "Core",
          prose: "",
          rules: [
            { id: "A1", level: "must", text: "one" },
            { id: "A1", level: "should", text: "duplicate" },
          ],
        },
      ],
    };
    const r = normalizeSpec(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("V3");
  });
});

describe("SS-DM V4/D27 — coverage status consistency", () => {
  it("rejects covered entry with empty testIds", () => {
    const bad: TestPlanModule = {
      ...fixtureAlphaPlan,
      coverageMatrix: [{ rule: "A1", testIds: [], status: "covered" }],
    };
    const r = normalizeTestPlan(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("D27");
  });

  it("rejects uncovered entry with non-empty testIds", () => {
    const bad: TestPlanModule = {
      ...fixtureAlphaPlan,
      coverageMatrix: [{ rule: "A1", testIds: ["T-A-001"], status: "uncovered" }],
    };
    const r = normalizeTestPlan(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("D27");
  });
});

describe("SS-DM V5 — categoriesSectionId resolves", () => {
  it("rejects categoriesSectionId that does not resolve to any section", () => {
    const bad: TestPlanModule = {
      ...fixtureAlphaPlan,
      categoriesSectionId: 999,
    };
    const r = normalizeTestPlan(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("V5");
  });
});

describe("SS-DM V9 — enum membership", () => {
  it("rejects unknown rule level", () => {
    const bad: SpecModule = {
      ...fixtureAlpha,
      sections: [
        {
          ...fixtureAlpha.sections[0],
          rules: [{ id: "A1", level: "whatever" as never, text: "x" }],
        },
      ],
    };
    const r = normalizeSpec(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("V9");
  });

  it("rejects unknown spec status", () => {
    const bad: SpecModule = { ...fixtureAlpha, status: "whenever" as never };
    const r = normalizeSpec(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("V9");
  });
});

describe("SS-DM I8 — root cannot carry both tisyn_spec and tisyn", () => {
  it("rejects a SpecModule carrying both discriminants", () => {
    const bad = { ...fixtureAlpha, tisyn: "other" } as unknown as SpecModule;
    const r = normalizeSpec(bad);
    expect(r.status).toBe("error");
    if (r.status !== "error") {
      return;
    }
    expect(constraints(r.errors)).toContain("I8");
  });
});
