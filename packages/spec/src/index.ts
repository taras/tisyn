// Public surface of @tisyn/spec per §11 of spec-system-specification.source.md.

export {
  Ambiguity,
  Amendment,
  Amends,
  ChangedSection,
  Complements,
  Concept,
  Covers,
  DependsOn,
  ErrorCode,
  ImplementsSpec,
  Invariant,
  NonTest,
  Rule,
  Section,
  Spec,
  Term,
  TestCase,
  TestCategory,
  TestPlan,
  UnchangedSection,
} from "./constructors.ts";

export { ChangeType, EvidenceTier, Resolution, Status, Strength, Tier } from "./enums.ts";

export { normalizeSpec, normalizeTestPlan } from "./normalize.ts";

export { buildRegistry } from "./registry.ts";

export { checkCoverage, isReady, validateCorpus } from "./validate.ts";

export { collectErrorCodes, collectRules, collectTerms, walkSections } from "./walk.ts";

export type {
  AmbiguityFinding,
  AmendmentDetail,
  AmendmentRef,
  ConceptExport,
  ConceptLocation,
  CoverageEntry,
  CoverageReport,
  ErrorCodeDeclaration,
  ErrorCodeLocation,
  InvariantDeclaration,
  NonTestEntry,
  NormalizeResult,
  NormalizedSpecModule,
  NormalizedTestPlanModule,
  RuleDeclaration,
  RuleLocation,
  SectionChange,
  SectionPreservation,
  SpecModule,
  SpecRef,
  SpecRegistry,
  SpecSection,
  StructuralError,
  TermDefinition,
  TestPlanModule,
  ValidationError,
  ValidationReport,
} from "./types.ts";
