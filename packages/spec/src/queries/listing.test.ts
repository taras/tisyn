// SS-QS: listing queries return arrays in deterministic order. Missing specs
// yield empty arrays (SS-QS-003). Dependencies are declared regardless of
// scope (SS-QS-004). Dependents are scope-relative.

import { describe, expect, it } from "vitest";
import {
  listDependencies,
  listDependents,
  listErrorCodes,
  listOpenQuestions,
  listRules,
  listRulesByLevel,
  listTerms,
} from "./listing.ts";
import { buildTestRegistry } from "../__fixtures__/registry.ts";
import {
  fixtureAlpha,
  fixtureAlphaPlan,
  fixtureBeta,
  fixtureDelta,
} from "../__fixtures__/index.ts";

describe("SS-QS listing", () => {
  const r = buildTestRegistry(
    [fixtureAlpha, fixtureBeta, fixtureDelta],
    [fixtureAlphaPlan],
  );

  it("listRules returns rules in section order", () => {
    const rules = listRules(r, "fixture-alpha");
    expect(rules.map((l) => l.rule.id)).toEqual(["A1", "A2"]);
  });

  it("listRules returns [] for unknown spec", () => {
    expect(listRules(r, "missing")).toEqual([]);
  });

  it("listRulesByLevel filters by level across all specs", () => {
    const musts = listRulesByLevel(r, "must").map((l) => l.rule.id);
    expect(musts).toContain("A1");
    expect(musts).toContain("B1");
    expect(musts).toContain("D1");
    expect(musts).not.toContain("A2");
  });

  it("listDependencies returns declared dependencies regardless of scope", () => {
    const deps = listDependencies(r, "fixture-beta");
    expect(deps.map((d) => d.specId)).toEqual(["fixture-alpha"]);
  });

  it("listDependents returns in-scope dependents only", () => {
    const dependents = listDependents(r, "fixture-alpha").map((d) => d.specId);
    expect(dependents).toContain("fixture-beta");
    expect(dependents).toContain("fixture-delta");
  });

  it("listOpenQuestions supports status + blocksTarget filters", () => {
    const open = listOpenQuestions(r, { status: "open" });
    expect(open.map((l) => l.openQuestion.id)).toEqual(["OQ-D-1"]);
    const blocking = listOpenQuestions(r, { blocksTarget: "fixture-delta" });
    expect(blocking).toHaveLength(1);
    const resolved = listOpenQuestions(r, { status: "resolved" });
    expect(resolved).toEqual([]);
  });

  it("listTerms walks every spec", () => {
    expect(listTerms(r).map((l) => l.definition.term)).toContain("Alpha");
  });

  it("listErrorCodes returns [] when none exist", () => {
    expect(listErrorCodes(r)).toEqual([]);
  });
});
