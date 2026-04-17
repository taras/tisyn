// SS-QL: point lookups return undefined on misses (never throw) and are
// case-sensitive for terms (SS-QL-023).

import { describe, expect, it } from "vitest";
import {
  findErrorCode,
  findOpenQuestion,
  findRule,
  findSpec,
  findTerm,
  findTestCase,
} from "./lookup.ts";
import { buildTestRegistry } from "../__fixtures__/registry.ts";
import {
  fixtureAlpha,
  fixtureAlphaPlan,
  fixtureDelta,
} from "../__fixtures__/index.ts";

const r = buildTestRegistry(
  [fixtureAlpha, fixtureDelta],
  [fixtureAlphaPlan],
);

describe("SS-QL lookup", () => {
  it("findSpec returns the spec by id", () => {
    expect(findSpec(r, "fixture-alpha")?.id).toBe("fixture-alpha");
  });

  it("findSpec returns undefined on miss", () => {
    expect(findSpec(r, "missing")).toBeUndefined();
  });

  it("findRule returns RuleLocation with specId + rule", () => {
    const loc = findRule(r, "A1");
    expect(loc?.specId).toBe("fixture-alpha");
    expect(loc?.rule.id).toBe("A1");
  });

  it("findTerm is case-sensitive", () => {
    expect(findTerm(r, "Alpha")).toBeDefined();
    expect(findTerm(r, "alpha")).toBeUndefined();
  });

  it("findTestCase walks every plan", () => {
    expect(findTestCase(r, "T-A-001")).toBeDefined();
  });

  it("findErrorCode returns undefined when no error codes exist", () => {
    expect(findErrorCode(r, "E-999")).toBeUndefined();
  });

  it("findOpenQuestion finds open questions on specs", () => {
    expect(findOpenQuestion(r, "OQ-D-1")?.specId).toBe("fixture-delta");
  });
});
