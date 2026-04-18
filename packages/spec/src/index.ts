// Public surface of @tisyn/spec per §4–§11 of
// specs/tisyn-spec-system-specification.md. Exports grow as each phase lands;
// this barrel re-exports only modules that exist at this point in the v2
// realignment track.

export {
  COVERAGE_STATUS,
  OPEN_QUESTION_STATUS,
  RELATIONSHIP_TYPES,
  RULE_LEVELS,
  SPEC_STATUS,
  TEST_PRIORITY,
  TEST_TYPE,
} from "./enums.ts";
export type {
  CoverageStatus,
  OpenQuestionStatus,
  RelationshipType,
  RuleLevel,
  SpecStatus,
  TestPriority,
  TestType,
} from "./enums.ts";

export {
  Concept,
  CoverageEntry,
  ErrorCode,
  Invariant,
  OpenQuestion,
  Relationship,
  Rule,
  Section,
  Spec,
  Term,
  TestCase,
  TestCategory,
  TestPlan,
  TestPlanSection,
} from "./constructors.ts";

export { normalizeSpec, normalizeTestPlan } from "./normalize.ts";

export { buildRegistry } from "./registry.ts";

export { acquireCorpusRegistry, createAcquire } from "./acquire.ts";
export type { AcquireAPI, AcquireOptions } from "./acquire.ts";

export { manifest } from "./manifest.ts";
export type { ManifestEntry } from "./manifest.ts";

export * from "./queries/index.ts";

export * from "./context/index.ts";

export {
  GENERATED_BANNER,
  stripBanner,
  renderSpecMarkdown,
  renderTestPlanMarkdown,
  compareMarkdown,
  renderDiscoveryPackText,
} from "./markdown/index.ts";
export type { RenderSpecOptions, RenderTestPlanOptions } from "./markdown/index.ts";

export { AcquisitionError } from "./types.ts";

// Nine names (CoverageEntry, ErrorCode, OpenQuestion, Relationship, Rule,
// Section, TestCase, TestCategory, TestPlanSection) are intentionally omitted
// from this re-export block — their interfaces are re-exported by
// ./constructors.ts as type aliases that declaration-merge with the matching
// PascalCase constructor functions, giving consumers a single name that
// resolves to the function in value position and the interface in type
// position.
export type {
  AcquisitionFailureEntry,
  AcquisitionFailureKind,
  AcquisitionScope,
  AmendmentContext,
  AuthoringContext,
  CompareResult,
  ConceptExport,
  ConceptLocation,
  ConsistencyContext,
  ConsistencySummaryCoverage,
  ConsistencySummaryReadiness,
  ConstraintDocument,
  CorpusRegistry,
  CoverageResult,
  CoveredRule,
  DeferredRule,
  DependencyEntry,
  DependentEntry,
  DiscoveryPack,
  DiscoveryPackConsistency,
  DiscoveryPackOQ,
  DiscoveryPackSpec,
  DiscoveryPackTerm,
  DuplicateRule,
  ErrorCodeCollision,
  ErrorCodeLocation,
  ImpactEntry,
  InvariantDeclaration,
  MarkdownDifference,
  MarkdownDifferenceKind,
  NormalizationError,
  NormalizeResult,
  NormalizedSpecModule,
  NormalizedTestPlanModule,
  OpenQuestionLocation,
  Operation,
  ReadinessResult,
  RelationshipEdge,
  ReviewContext,
  RuleLocation,
  Scope,
  SpecModule,
  StaleReference,
  TaskContext,
  TaskContextQuery,
  TermConflict,
  TermDefinition,
  TermLocation,
  TestCaseLocation,
  TestPlanContext,
  TestPlanModule,
  UncoveredRule,
} from "./types.ts";
