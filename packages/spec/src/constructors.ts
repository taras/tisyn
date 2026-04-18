// Thin authoring helpers for the v2 data model. Each constructor returns the
// corresponding interface shape verbatim — the only value-add is auto-filling
// the `tisyn_spec` discriminant on the two root module types (V1 / I8).
//
// Nine function names collide with interface names defined in ./types.ts
// (Section, Rule, Relationship, OpenQuestion, ErrorCode, TestCase, TestCategory,
// TestPlanSection, CoverageEntry). To expose a uniform PascalCase surface where
// `const s: Section = Section({...})` works, we declaration-merge each
// colliding function with a local type alias pointing back at the interface.
// The barrel re-exports these names from this module only; the non-colliding
// interface names (SpecModule, TestPlanModule, TermDefinition, ConceptExport,
// InvariantDeclaration) continue to be re-exported by the barrel from types.ts.

import type {
  ConceptExport,
  CoverageEntry as CoverageEntryInterface,
  ErrorCode as ErrorCodeInterface,
  InvariantDeclaration,
  OpenQuestion as OpenQuestionInterface,
  Relationship as RelationshipInterface,
  Rule as RuleInterface,
  Section as SectionInterface,
  SpecModule,
  TermDefinition,
  TestCase as TestCaseInterface,
  TestCategory as TestCategoryInterface,
  TestPlanModule,
  TestPlanSection as TestPlanSectionInterface,
} from "./types.ts";

export type Section = SectionInterface;
export type Rule = RuleInterface;
export type Relationship = RelationshipInterface;
export type OpenQuestion = OpenQuestionInterface;
export type ErrorCode = ErrorCodeInterface;
export type TestCase = TestCaseInterface;
export type TestCategory = TestCategoryInterface;
export type TestPlanSection = TestPlanSectionInterface;
export type CoverageEntry = CoverageEntryInterface;

export function Spec(init: Omit<SpecModule, "tisyn_spec">): SpecModule {
  return { tisyn_spec: "spec", ...init };
}

export function TestPlan(init: Omit<TestPlanModule, "tisyn_spec">): TestPlanModule {
  return { tisyn_spec: "test-plan", ...init };
}

export function Section(init: SectionInterface): SectionInterface {
  return init;
}

export function Rule(init: RuleInterface): RuleInterface {
  return init;
}

export function Term(init: TermDefinition): TermDefinition {
  return init;
}

export function Relationship(init: RelationshipInterface): RelationshipInterface {
  return init;
}

export function OpenQuestion(init: OpenQuestionInterface): OpenQuestionInterface {
  return init;
}

export function ErrorCode(init: ErrorCodeInterface): ErrorCodeInterface {
  return init;
}

export function Concept(init: ConceptExport): ConceptExport {
  return init;
}

export function Invariant(init: InvariantDeclaration): InvariantDeclaration {
  return init;
}

export function TestPlanSection(init: TestPlanSectionInterface): TestPlanSectionInterface {
  return init;
}

export function TestCategory(init: TestCategoryInterface): TestCategoryInterface {
  return init;
}

export function TestCase(init: TestCaseInterface): TestCaseInterface {
  return init;
}

export function CoverageEntry(init: CoverageEntryInterface): CoverageEntryInterface {
  return init;
}
