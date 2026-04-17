// Public surface of @tisyn/spec per §4–§11 of
// tisyn-spec-system-specification.source.md. Exports grow as each phase lands;
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
  concept,
  coverageEntry,
  errorCode,
  invariant,
  openQuestion,
  relationship,
  rule,
  section,
  spec,
  term,
  testCase,
  testCategory,
  testPlan,
  testPlanSection,
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
  CoverageEntry,
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
  ErrorCode,
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
  OpenQuestion,
  OpenQuestionLocation,
  Operation,
  ReadinessResult,
  Relationship,
  RelationshipEdge,
  ReviewContext,
  Rule,
  RuleLocation,
  Scope,
  Section,
  SpecModule,
  StaleReference,
  TaskContext,
  TaskContextQuery,
  TermConflict,
  TermDefinition,
  TermLocation,
  TestCase,
  TestCaseLocation,
  TestCategory,
  TestPlanContext,
  TestPlanModule,
  TestPlanSection,
  UncoveredRule,
} from "./types.ts";
