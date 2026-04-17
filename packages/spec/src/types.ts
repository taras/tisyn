// v2 Spec data model per §4–§12 of tisyn-spec-system-specification.source.md.
// All authored values live in the portable serializable data domain (§4.2):
// null, boolean, finite number, string, plain objects and arrays thereof.
// ReadonlyMap values on CorpusRegistry are the one documented exception.
//
// Only the root SpecModule and TestPlanModule carry a tisyn_spec discriminant
// (V1, I8). Nested nodes (Section, Rule, Relationship, TermDefinition,
// ErrorCode, ConceptExport, InvariantDeclaration, OpenQuestion,
// TestPlanSection, TestCategory, TestCase, CoverageEntry) are plain data.

import type {
  CoverageStatus,
  OpenQuestionStatus,
  RelationshipType,
  RuleLevel,
  SpecStatus,
  TestPriority,
  TestType,
} from "./enums.ts";

// Local Operation alias. The v2 spec pins the name and the `function*` form
// (§7.1) but does not pin the module. Bodies `yield` Promises; any effect
// runtime that resolves yielded Promises (effection does) can drive them.
// Defining this locally keeps @tisyn/spec free of runtime dependencies (§1.2).
export type Operation<T> = Generator<unknown, T, unknown>;

// §4.3 SpecModule — the primary canonical entity.
export interface SpecModule {
  readonly tisyn_spec: "spec";
  readonly id: string;
  readonly title: string;
  readonly status: SpecStatus;
  readonly relationships: readonly Relationship[];
  readonly sections: readonly Section[];
  readonly openQuestions?: readonly OpenQuestion[];
  readonly implementationPackage?: string;
}

// §4.4 Section — recursive prose-and-content division. Section.id is
// `number | string` per D5 / D7. V2's non-empty requirement applies only
// to the string branch; the number branch's shape is handled by V8 (finite).
export interface Section {
  readonly id: number | string;
  readonly title: string;
  readonly prose: string;
  readonly rules?: readonly Rule[];
  readonly errorCodes?: readonly ErrorCode[];
  readonly conceptExports?: readonly ConceptExport[];
  readonly termDefinitions?: readonly TermDefinition[];
  readonly invariants?: readonly InvariantDeclaration[];
  readonly subsections?: readonly Section[];
}

// §4.5 Rule — atomic unit of normative content.
export interface Rule {
  readonly id: string;
  readonly level: RuleLevel;
  readonly text: string;
}

// §4.6 TermDefinition.
export interface TermDefinition {
  readonly term: string;
  readonly definition: string;
}

// §4.7 Relationship — typed directed edge from one spec to another.
export interface Relationship {
  readonly type: RelationshipType;
  readonly target: string;
  readonly qualifier?: string;
}

// §4.8 OpenQuestion — deferred design question.
export interface OpenQuestion {
  readonly id: string;
  readonly text: string;
  readonly status: OpenQuestionStatus;
  readonly blocksTarget?: string;
  readonly resolvedIn?: string;
}

// §4.9 ErrorCode — diagnostic code.
export interface ErrorCode {
  readonly code: string;
  readonly trigger: string;
  readonly requiredContent?: string;
}

// §4.10 ConceptExport — concept exported for cross-spec use.
export interface ConceptExport {
  readonly name: string;
  readonly description: string;
}

// §4.11 InvariantDeclaration — named invariant.
export interface InvariantDeclaration {
  readonly id: string;
  readonly text: string;
}

// §4.12 TestPlanModule — companion test plan for a spec.
export interface TestPlanModule {
  readonly tisyn_spec: "test-plan";
  readonly id: string;
  readonly title: string;
  readonly validatesSpec: string;
  readonly styleReference?: string;
  readonly sections: readonly TestPlanSection[];
  readonly categories: readonly TestCategory[];
  readonly categoriesSectionId: string | number;
  readonly coverageMatrix: readonly CoverageEntry[];
}

// §4.13 TestPlanSection — prose section of a test plan.
export interface TestPlanSection {
  readonly id: string | number;
  readonly title: string;
  readonly number?: number;
  readonly prose: string;
  readonly subsections?: readonly TestPlanSection[];
  readonly precedingDivider?: boolean;
}

// §4.14 TestCategory — group of test cases.
export interface TestCategory {
  readonly id: string;
  readonly title: string;
  readonly notes?: string;
  readonly cases: readonly TestCase[];
}

// §4.15 TestCase — single test assertion.
export interface TestCase {
  readonly id: string;
  readonly priority: TestPriority;
  readonly type: TestType;
  readonly specRef: string;
  readonly assertion: string;
}

// §4.16 CoverageEntry — one row of the coverage matrix.
export interface CoverageEntry {
  readonly rule: string;
  readonly testIds: readonly string[];
  readonly status: CoverageStatus;
}

// §5.1–§5.2 Normalization result.
export interface NormalizedSpecModule extends SpecModule {
  readonly _hash: string;
  readonly _normalizedAt: string;
}

export interface NormalizedTestPlanModule extends TestPlanModule {
  readonly _hash: string;
  readonly _normalizedAt: string;
}

// §5.1 normalization never throws — it returns a discriminated union.
export interface NormalizationError {
  // Names the violated V- or D-rule: e.g. "V2", "V3", "D5", "D27".
  readonly constraint: string;
  readonly message: string;
  readonly path?: readonly (string | number)[];
}

export type NormalizeResult<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "error"; readonly errors: readonly NormalizationError[] };

// §6.1 Scope — records whether the registry was built from the full corpus
// or a filtered subset. R7 / I9 require verbatim preservation.
export type Scope =
  | { readonly kind: "full" }
  | { readonly kind: "filtered"; readonly specIds: readonly string[] };

// §6.1 Location types — each carries the entity and its position.
export interface RuleLocation {
  readonly specId: string;
  readonly sectionId: string | number;
  readonly rule: Rule;
}

export interface TermLocation {
  readonly specId: string;
  readonly sectionId: string | number;
  readonly definition: TermDefinition;
}

export interface ConceptLocation {
  readonly specId: string;
  readonly sectionId: string | number;
  readonly concept: ConceptExport;
}

export interface ErrorCodeLocation {
  readonly specId: string;
  readonly sectionId: string | number;
  readonly errorCode: ErrorCode;
}

export interface OpenQuestionLocation {
  readonly specId: string;
  readonly openQuestion: OpenQuestion;
}

// §8.3 TestCaseLocation.
export interface TestCaseLocation {
  readonly planId: string;
  readonly categoryId: string;
  readonly testCase: TestCase;
}

// §6.1 RelationshipEdge.
export interface RelationshipEdge {
  readonly source: string;
  readonly target: string;
  readonly type: RelationshipType;
  readonly qualifier?: string;
}

// §6.1 CorpusRegistry.
export interface CorpusRegistry {
  readonly specs: ReadonlyMap<string, NormalizedSpecModule>;
  readonly plans: ReadonlyMap<string, NormalizedTestPlanModule>;
  readonly ruleIndex: ReadonlyMap<string, RuleLocation>;
  readonly termIndex: ReadonlyMap<string, TermLocation>;
  readonly conceptIndex: ReadonlyMap<string, ConceptLocation>;
  readonly errorCodeIndex: ReadonlyMap<string, ErrorCodeLocation>;
  readonly openQuestionIndex: ReadonlyMap<string, OpenQuestionLocation>;
  readonly edges: readonly RelationshipEdge[];
  readonly dependencyOrder: readonly string[];
  readonly scope: Scope;
}

// §7.1 AcquisitionScope — caller-facing scope.
export interface AcquisitionScope {
  readonly specIds?: readonly string[];
}

// §7.5 Failure model — three failure kinds.
export type AcquisitionFailureKind = "F1" | "F2" | "F3";

export interface AcquisitionFailureEntry {
  readonly id: string;
  readonly reason: string;
}

export class AcquisitionError extends Error {
  readonly kind: AcquisitionFailureKind;
  readonly modules: readonly AcquisitionFailureEntry[];
  constructor(
    kind: AcquisitionFailureKind,
    message: string,
    modules: readonly AcquisitionFailureEntry[],
  ) {
    super(message);
    this.name = "AcquisitionError";
    this.kind = kind;
    this.modules = modules;
  }
}

// §8.6 Analysis result types.
export interface CoveredRule {
  readonly rule: Rule;
  readonly sectionId: string | number;
  readonly testIds: readonly string[];
}

export interface UncoveredRule {
  readonly rule: Rule;
  readonly sectionId: string | number;
}

export interface DeferredRule {
  readonly rule: Rule;
  readonly sectionId: string | number;
  readonly reason: string;
}

export interface CoverageResult {
  readonly specId: string;
  readonly companionPlanId: string | undefined;
  readonly coveredRules: readonly CoveredRule[];
  readonly uncoveredRules: readonly UncoveredRule[];
  readonly deferredRules: readonly DeferredRule[];
  readonly stats: {
    readonly total: number;
    readonly covered: number;
    readonly uncovered: number;
    readonly deferred: number;
  };
}

// §8.6 ReadinessResult — verbatim per spec.
export interface ReadinessResult {
  readonly specId: string;
  readonly ready: boolean;
  readonly blocking: readonly string[];
}

export interface TermConflict {
  readonly term: string;
  readonly definitions: readonly TermLocation[];
}

export interface StaleReference {
  readonly sourceSpecId: string;
  readonly referencedSpecId: string;
  readonly referencedSection?: string;
  readonly problem: "missing-spec" | "missing-section" | "superseded-spec";
}

export interface ErrorCodeCollision {
  readonly code: string;
  readonly locations: readonly ErrorCodeLocation[];
}

export interface DuplicateRule {
  readonly ruleId: string;
  readonly locations: readonly RuleLocation[];
}

// §8.4 Listing result helpers.
export interface DependencyEntry {
  readonly specId: string;
  readonly relationship: Relationship;
}

export interface DependentEntry {
  readonly specId: string;
  readonly relationship: Relationship;
}

// §8.5 Relationship query result.
export interface ImpactEntry {
  readonly specId: string;
  readonly relationship: Relationship;
  readonly referencedSection?: string | number;
  readonly impactType:
    | "depends-on"
    | "amends"
    | "test-references"
    | "prose-references";
}

// §8.7 Projection types.
export interface DiscoveryPackSpec {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly implementationPackage?: string;
  readonly relationships: readonly Relationship[];
  readonly ruleCount: number;
  readonly coverage: {
    readonly total: number;
    readonly covered: number;
    readonly uncovered: number;
  };
  readonly ready: boolean;
}

export interface DiscoveryPackTerm {
  readonly term: string;
  readonly specId: string;
  readonly definition: string;
}

export interface DiscoveryPackOQ {
  readonly id: string;
  readonly specId: string;
  readonly status: string;
  readonly blocksTarget?: string;
}

export interface DiscoveryPackConsistency {
  readonly staleReferences: number;
  readonly termConflicts: number;
  readonly errorCodeCollisions: number;
  readonly duplicateRules: number;
  readonly cycles: boolean;
}

export interface DiscoveryPack {
  readonly generatedAt: string;
  readonly specCount: number;
  readonly scopeKind: "full" | "filtered";
  readonly specs: readonly DiscoveryPackSpec[];
  readonly terms: readonly DiscoveryPackTerm[];
  readonly openQuestions: readonly DiscoveryPackOQ[];
  readonly consistency: DiscoveryPackConsistency;
}

export interface ConstraintDocument {
  readonly targetSpecId: string;
  readonly targetTitle: string;
  readonly scopeKind: "full" | "filtered";
  readonly upstreamDependencies: readonly DependencyEntry[];
  readonly downstreamDependents: readonly DependentEntry[];
  readonly exportedConcepts: readonly ConceptExport[];
  readonly definedTerms: readonly TermDefinition[];
  readonly openQuestions: readonly OpenQuestion[];
  readonly ruleCount: number;
  readonly coverageStatus: CoverageResult;
}

export interface TaskContextQuery {
  readonly specIds?: readonly string[];
  readonly rulePattern?: string;
  readonly termPattern?: string;
  readonly includeRelated?: boolean;
  readonly maxTokens?: number;
}

export interface TaskContext {
  readonly scopeKind: "full" | "filtered";
  readonly relevantSpecs: readonly DiscoveryPackSpec[];
  readonly matchingRules: readonly RuleLocation[];
  readonly matchingTerms: readonly TermLocation[];
  readonly relatedOpenQuestions: readonly OpenQuestionLocation[];
  readonly tokenEstimate: number;
}

// §9 Context assembly result types. All carry scopeKind (§9 CA3 +
// §8.8 scope-relative note).
export interface AuthoringContext {
  readonly task: "authoring";
  readonly scopeKind: "full" | "filtered";
  readonly targetSpec?: string;
  readonly topic?: string;
  readonly relevantSpecs: readonly DiscoveryPackSpec[];
  readonly rules: readonly RuleLocation[];
  readonly terms: readonly TermLocation[];
  readonly openQuestions: readonly OpenQuestionLocation[];
  readonly constraints?: ConstraintDocument;
  readonly tokenEstimate: number;
}

export interface AmendmentContext {
  readonly task: "amendment";
  readonly scopeKind: "full" | "filtered";
  readonly targetSpec: string;
  readonly targetSection?: string | number;
  readonly constraints: ConstraintDocument;
  readonly impact: readonly ImpactEntry[];
  readonly dependencies: readonly DependencyEntry[];
  readonly dependents: readonly DependentEntry[];
  readonly currentCoverage: CoverageResult;
  readonly blockingQuestions: readonly OpenQuestionLocation[];
}

export interface ReviewContext {
  readonly task: "review";
  readonly scopeKind: "full" | "filtered";
  readonly targetSpec: string;
  readonly dependencies: readonly DependencyEntry[];
  readonly dependents: readonly DependentEntry[];
  readonly terms: readonly TermLocation[];
  readonly corpusTermConflicts: readonly TermConflict[];
  readonly staleReferences: readonly StaleReference[];
  readonly coverage: CoverageResult;
  readonly readiness: ReadinessResult;
  readonly errorCodeConflicts: readonly ErrorCodeCollision[];
}

export interface TestPlanContext {
  readonly task: "test-plan";
  readonly scopeKind: "full" | "filtered";
  readonly targetSpec: string;
  readonly mustRules: readonly RuleLocation[];
  readonly shouldRules: readonly RuleLocation[];
  readonly mayRules: readonly RuleLocation[];
  readonly totalRuleCount: number;
  readonly existingCoverage: CoverageResult;
  readonly siblingPlanIds: readonly string[];
  readonly openQuestions: readonly OpenQuestionLocation[];
}

export interface ConsistencySummaryCoverage {
  readonly specId: string;
  readonly total: number;
  readonly covered: number;
  readonly uncovered: number;
  readonly deferred: number;
}

export interface ConsistencySummaryReadiness {
  readonly specId: string;
  readonly ready: boolean;
  readonly blocking: readonly string[];
}

export interface ConsistencyContext {
  readonly task: "consistency";
  readonly scopeKind: "full" | "filtered";
  readonly scope: string;
  readonly staleReferences: readonly StaleReference[];
  readonly termConflicts: readonly TermConflict[];
  readonly errorCodeCollisions: readonly ErrorCodeCollision[];
  readonly duplicateRules: readonly DuplicateRule[];
  readonly cycles: boolean;
  readonly coverageSummary: readonly ConsistencySummaryCoverage[];
  readonly readinessSummary: readonly ConsistencySummaryReadiness[];
}

// §11.2 compareMarkdown result.
export type MarkdownDifferenceKind =
  | "section-heading"
  | "relationship-line"
  | "test-id"
  | "coverage-ref";

export interface MarkdownDifference {
  readonly kind: MarkdownDifferenceKind;
  readonly expected: string;
  readonly actual: string;
}

export interface CompareResult {
  readonly match: boolean;
  readonly differences: readonly MarkdownDifference[];
}
