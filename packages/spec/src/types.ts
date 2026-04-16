// Spec data model per §4–§5, §7.3, §8.1 of spec-system-specification.source.md.
// All values live in the portable serializable data domain (§3) — no classes,
// functions, Date/Map/Set/RegExp, undefined, NaN, Infinity, Symbol, BigInt, or
// cycles. The sole exceptions are SpecRegistry's ReadonlyMap indices (§7.3),
// which are typed maps by design and not required to be serializable (R13).

import type { ChangeType, EvidenceTier, Resolution, Status, Strength, Tier } from "./enums.ts";

// §5.1 SpecModule
export interface SpecModule {
  readonly tisyn_spec: "spec";
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly status: Status;

  readonly dependsOn: readonly SpecRef[];
  readonly amends: readonly AmendmentRef[];
  readonly complements: readonly SpecRef[];
  readonly implements: readonly SpecRef[];

  readonly sections: readonly SpecSection[];

  readonly rules: readonly RuleDeclaration[];
  readonly errorCodes: readonly ErrorCodeDeclaration[];
  readonly concepts: readonly ConceptExport[];
  readonly invariants: readonly InvariantDeclaration[];
  readonly terms: readonly TermDefinition[];

  readonly amendment?: AmendmentDetail;
}

// §5.2 TestPlanModule
export interface TestPlanModule {
  readonly tisyn_spec: "test-plan";
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly status: Status;

  readonly testsSpec: SpecRef;

  // Optional `**Style reference:** …` metadata line emitted after `**Version:**`.
  readonly styleReference?: string;

  // Ordered outer prose sections (e.g. §1 Purpose, §2 Scope, …). One of them
  // is designated by `categoriesSectionId` as the wrapper for the test matrix,
  // which the renderer fills with category blocks at `depth + 1`.
  readonly sections: readonly TestPlanSection[];

  // Logical id of the section that wraps the test matrix. Must resolve to a
  // section somewhere in `sections` (structural validation rejects the module
  // if it does not).
  readonly categoriesSectionId: string;

  readonly categories: readonly TestCategory[];
  readonly coverageMatrix: readonly CoverageEntry[];
  readonly nonTests: readonly NonTestEntry[];
  readonly ambiguitySurface: readonly AmbiguityFinding[];

  readonly coreTier: number;
  readonly extendedTier: number;
}

// Recursive prose-section type used by TestPlanModule. Section identity
// (`id`), heading number (`number`), and heading title (`title`) are three
// independent fields: every section has `id` + `title`, only numbered sections
// carry `number`, and any section may request a preceding horizontal-rule
// divider via `precedingDivider`.
export interface TestPlanSection {
  readonly tisyn_spec: "test-plan-section";
  readonly id: string;
  readonly number?: string;
  readonly title: string;
  readonly prose: string;
  readonly subsections: readonly TestPlanSection[];
  readonly precedingDivider?: boolean;
}

// §5.3 SpecSection
export interface SpecSection {
  readonly tisyn_spec: "section";
  readonly id: string;
  readonly title: string;
  readonly normative: boolean;
  readonly prose: string;
  readonly subsections: readonly SpecSection[];
}

// §5.4 RuleDeclaration
export interface RuleDeclaration {
  readonly tisyn_spec: "rule";
  readonly id: string;
  readonly section: string;
  readonly strength: Strength;
  readonly statement: string;
  readonly prose?: string;
}

// §5.5 ErrorCodeDeclaration
export interface ErrorCodeDeclaration {
  readonly tisyn_spec: "error-code";
  readonly code: string;
  readonly section: string;
  readonly trigger: string;
  readonly requiredContent?: readonly string[];
}

// §5.6 ConceptExport
export interface ConceptExport {
  readonly tisyn_spec: "concept";
  readonly name: string;
  readonly section: string;
  readonly description: string;
}

// §5.7 InvariantDeclaration
export interface InvariantDeclaration {
  readonly tisyn_spec: "invariant";
  readonly id: string;
  readonly section: string;
  readonly statement: string;
}

// §5.8 TermDefinition
export interface TermDefinition {
  readonly tisyn_spec: "term";
  readonly term: string;
  readonly section: string;
  readonly definition: string;
}

// §5.9 Relationship types
export interface SpecRef {
  readonly specId: string;
  readonly version?: string;
}

export interface AmendmentRef {
  readonly specId: string;
  readonly version?: string;
  readonly sections?: readonly string[];
}

// §5.10 Amendment detail
export interface AmendmentDetail {
  readonly changedSections: readonly SectionChange[];
  readonly unchangedSections: readonly SectionPreservation[];
  readonly preservedBehavior: readonly string[];
  readonly newBehavior: readonly string[];
}

export interface SectionChange {
  readonly targetSpec: string;
  readonly section: string;
  readonly changeType: ChangeType;
}

export interface SectionPreservation {
  readonly targetSpec: string;
  readonly section: string;
}

// §5.11 Test plan types
export interface TestCategory {
  readonly tisyn_spec: "test-category";
  readonly id: string;
  readonly title: string;
  readonly tests: readonly TestCase[];
  // Optional trailing markdown prose emitted after the test table — mirrors
  // `**Note on …**` paragraphs in handwritten test plans.
  readonly notes?: string;
}

export interface TestCase {
  readonly tisyn_spec: "test";
  readonly id: string;
  readonly tier: Tier;
  readonly rules: readonly string[];
  readonly description: string;
  readonly setup: string;
  readonly expected: string;
  readonly evidence?: EvidenceTier;
}

// §5.12 Coverage and ambiguity types
export interface CoverageEntry {
  readonly ruleId: string;
  readonly testIds: readonly string[];
}

export interface NonTestEntry {
  readonly id: string;
  readonly description: string;
  readonly reason: string;
}

export interface AmbiguityFinding {
  readonly id: string;
  readonly specSection: string;
  readonly description: string;
  readonly resolution: Resolution;
  readonly resolvedIn?: string;
}

// §5.13 Computed and index types
export interface NormalizedSpecModule extends SpecModule {
  readonly _sectionNumbering: Readonly<Record<string, string>>;
  readonly _ruleLocations: Readonly<Record<string, string>>;
  readonly _hash: string;
  readonly _normalizedAt: string;
}

export interface NormalizedTestPlanModule extends TestPlanModule {
  readonly _hash: string;
  readonly _normalizedAt: string;
}

export interface RuleLocation {
  readonly specId: string;
  readonly section: string;
  readonly strength: Strength;
}

export interface ErrorCodeLocation {
  readonly specId: string;
  readonly section: string;
  readonly trigger: string;
}

export interface ConceptLocation {
  readonly specId: string;
  readonly section: string;
  readonly description: string;
}

// §7.3 SpecRegistry
export interface SpecRegistry {
  readonly specs: ReadonlyMap<string, NormalizedSpecModule>;
  readonly testPlans: ReadonlyMap<string, NormalizedTestPlanModule>;
  readonly ruleIndex: ReadonlyMap<string, RuleLocation>;
  readonly errorCodeIndex: ReadonlyMap<string, ErrorCodeLocation>;
  readonly termAuthority: ReadonlyMap<string, string>;
  readonly conceptIndex: ReadonlyMap<string, ConceptLocation>;
}

// §8.1 Validation report
export interface ValidationReport {
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationError[];
}

export interface ValidationError {
  readonly group: string;
  readonly check: string;
  readonly message: string;
  readonly specId?: string;
  readonly testPlanId?: string;
  readonly ruleId?: string;
  readonly sectionId?: string;
}

// §5.13 CoverageReport (D43)
export interface CoverageReport {
  readonly specId: string;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationError[];
  readonly uncoveredRules: readonly string[];
}

// Commit-0 amendment (§11.2, §11.5, §13.2): normalization returns a
// discriminated result rather than throwing, to honor N8's "return an error
// result" wording.
export interface StructuralError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly detail?: Readonly<Record<string, string | number>>;
}

export type NormalizeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly StructuralError[] };
