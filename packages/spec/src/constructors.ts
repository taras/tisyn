// Thin authoring helpers for the v2 data model. Each constructor returns the
// corresponding interface shape verbatim — the only value-add is auto-filling
// the `tisyn_spec` discriminant on the two root module types (V1 / I8).

import type {
  ConceptExport,
  CoverageEntry,
  ErrorCode,
  InvariantDeclaration,
  OpenQuestion,
  Relationship,
  Rule,
  Section,
  SpecModule,
  TermDefinition,
  TestCase,
  TestCategory,
  TestPlanModule,
  TestPlanSection,
} from "./types.ts";

export function spec(init: Omit<SpecModule, "tisyn_spec">): SpecModule {
  return { tisyn_spec: "spec", ...init };
}

export function testPlan(init: Omit<TestPlanModule, "tisyn_spec">): TestPlanModule {
  return { tisyn_spec: "test-plan", ...init };
}

export function section(init: Section): Section {
  return init;
}

export function rule(init: Rule): Rule {
  return init;
}

export function term(init: TermDefinition): TermDefinition {
  return init;
}

export function relationship(init: Relationship): Relationship {
  return init;
}

export function openQuestion(init: OpenQuestion): OpenQuestion {
  return init;
}

export function errorCode(init: ErrorCode): ErrorCode {
  return init;
}

export function concept(init: ConceptExport): ConceptExport {
  return init;
}

export function invariant(init: InvariantDeclaration): InvariantDeclaration {
  return init;
}

export function testPlanSection(init: TestPlanSection): TestPlanSection {
  return init;
}

export function testCategory(init: TestCategory): TestCategory {
  return init;
}

export function testCase(init: TestCase): TestCase {
  return init;
}

export function coverageEntry(init: CoverageEntry): CoverageEntry {
  return init;
}
