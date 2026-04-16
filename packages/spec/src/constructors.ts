// PascalCase constructors per §4.2 of spec-system-specification.source.md.
// Each constructor is a pure function (A4) that returns a value in the
// serializable data domain (A5). `undefined` is banned (§3.2), so optional
// fields are spread conditionally rather than assigned `undefined`.

import type { ChangeType, EvidenceTier, Resolution, Status, Strength, Tier } from "./enums.ts";
import { EvidenceTier as EvidenceTierEnum } from "./enums.ts";
import type {
  AmbiguityFinding,
  AmendmentDetail,
  AmendmentRef,
  ConceptExport,
  CoverageEntry,
  ErrorCodeDeclaration,
  InvariantDeclaration,
  NonTestEntry,
  RuleDeclaration,
  SectionChange,
  SectionPreservation,
  SpecModule,
  SpecRef,
  SpecSection,
  TermDefinition,
  TestCase as TestCaseType,
  TestCategory as TestCategoryType,
  TestPlanModule,
  TestPlanSection as TestPlanSectionType,
} from "./types.ts";

// Re-declare TestCase/TestCategory as locally-merged interface+function pairs
// so the barrel can re-export them once and carry both the value constructor
// and the interface type through a single `export { TestCase, TestCategory }`.
// Without this, `import type { TestCase } from "@tisyn/spec"` would resolve to
// the constructor function's call signature, not the TestCase interface.
export interface TestCase extends TestCaseType {}
export interface TestCategory extends TestCategoryType {}
export interface TestPlanSection extends TestPlanSectionType {}

// ── Spec ──

export function Spec(config: {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly status: Status;
  readonly dependsOn?: readonly SpecRef[];
  readonly amends?: readonly AmendmentRef[];
  readonly complements?: readonly SpecRef[];
  readonly implements?: readonly SpecRef[];
  readonly sections: readonly SpecSection[];
  readonly rules?: readonly RuleDeclaration[];
  readonly errorCodes?: readonly ErrorCodeDeclaration[];
  readonly concepts?: readonly ConceptExport[];
  readonly invariants?: readonly InvariantDeclaration[];
  readonly terms?: readonly TermDefinition[];
  readonly amendment?: AmendmentDetail;
}): SpecModule {
  return {
    tisyn_spec: "spec",
    id: config.id,
    title: config.title,
    version: config.version,
    status: config.status,
    dependsOn: config.dependsOn ?? [],
    amends: config.amends ?? [],
    complements: config.complements ?? [],
    implements: config.implements ?? [],
    sections: config.sections,
    rules: config.rules ?? [],
    errorCodes: config.errorCodes ?? [],
    concepts: config.concepts ?? [],
    invariants: config.invariants ?? [],
    terms: config.terms ?? [],
    ...(config.amendment != null ? { amendment: config.amendment } : {}),
  };
}

// ── Section ──

export function Section(config: {
  readonly id: string;
  readonly title: string;
  readonly normative: boolean;
  readonly prose: string;
  readonly subsections?: readonly SpecSection[];
}): SpecSection {
  return {
    tisyn_spec: "section",
    id: config.id,
    title: config.title,
    normative: config.normative,
    prose: config.prose,
    subsections: config.subsections ?? [],
  };
}

// ── Rule ──

export function Rule(config: {
  readonly id: string;
  readonly section: string;
  readonly strength: Strength;
  readonly statement: string;
  readonly prose?: string;
}): RuleDeclaration {
  return {
    tisyn_spec: "rule",
    id: config.id,
    section: config.section,
    strength: config.strength,
    statement: config.statement,
    ...(config.prose != null ? { prose: config.prose } : {}),
  };
}

// ── ErrorCode ──

export function ErrorCode(config: {
  readonly code: string;
  readonly section: string;
  readonly trigger: string;
  readonly requiredContent?: readonly string[];
}): ErrorCodeDeclaration {
  return {
    tisyn_spec: "error-code",
    code: config.code,
    section: config.section,
    trigger: config.trigger,
    ...(config.requiredContent != null ? { requiredContent: config.requiredContent } : {}),
  };
}

// ── Concept ──

export function Concept(config: {
  readonly name: string;
  readonly section: string;
  readonly description: string;
}): ConceptExport {
  return {
    tisyn_spec: "concept",
    name: config.name,
    section: config.section,
    description: config.description,
  };
}

// ── Invariant ──

export function Invariant(config: {
  readonly id: string;
  readonly section: string;
  readonly statement: string;
}): InvariantDeclaration {
  return {
    tisyn_spec: "invariant",
    id: config.id,
    section: config.section,
    statement: config.statement,
  };
}

// ── Term ──

export function Term(config: {
  readonly term: string;
  readonly section: string;
  readonly definition: string;
}): TermDefinition {
  return {
    tisyn_spec: "term",
    term: config.term,
    section: config.section,
    definition: config.definition,
  };
}

// ── Relationship constructors ──

export function DependsOn(specId: string, version?: string): SpecRef {
  return version != null ? { specId, version } : { specId };
}

export function Complements(specId: string, version?: string): SpecRef {
  return version != null ? { specId, version } : { specId };
}

export function ImplementsSpec(specId: string, version?: string): SpecRef {
  return version != null ? { specId, version } : { specId };
}

export function Amends(
  specId: string,
  version?: string,
  sections?: readonly string[],
): AmendmentRef {
  return {
    specId,
    ...(version != null ? { version } : {}),
    ...(sections != null ? { sections } : {}),
  };
}

// ── Amendment detail ──

export function Amendment(config: {
  readonly changedSections: readonly SectionChange[];
  readonly unchangedSections: readonly SectionPreservation[];
  readonly preservedBehavior: readonly string[];
  readonly newBehavior: readonly string[];
}): AmendmentDetail {
  return {
    changedSections: config.changedSections,
    unchangedSections: config.unchangedSections,
    preservedBehavior: config.preservedBehavior,
    newBehavior: config.newBehavior,
  };
}

export function ChangedSection(config: {
  readonly targetSpec: string;
  readonly section: string;
  readonly changeType: ChangeType;
}): SectionChange {
  return {
    targetSpec: config.targetSpec,
    section: config.section,
    changeType: config.changeType,
  };
}

export function UnchangedSection(config: {
  readonly targetSpec: string;
  readonly section: string;
}): SectionPreservation {
  return { targetSpec: config.targetSpec, section: config.section };
}

// ── Test plan ──

export function TestPlan(config: {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly status: Status;
  readonly testsSpec: SpecRef;
  readonly styleReference?: string;
  readonly sections: readonly TestPlanSectionType[];
  readonly categoriesSectionId: string;
  readonly categories: readonly TestCategory[];
  readonly coverageMatrix?: readonly CoverageEntry[];
  readonly nonTests?: readonly NonTestEntry[];
  readonly ambiguitySurface?: readonly AmbiguityFinding[];
  readonly coreTier: number;
  readonly extendedTier: number;
}): TestPlanModule {
  return {
    tisyn_spec: "test-plan",
    id: config.id,
    title: config.title,
    version: config.version,
    status: config.status,
    testsSpec: config.testsSpec,
    ...(config.styleReference != null ? { styleReference: config.styleReference } : {}),
    sections: config.sections,
    categoriesSectionId: config.categoriesSectionId,
    categories: config.categories,
    coverageMatrix: config.coverageMatrix ?? [],
    nonTests: config.nonTests ?? [],
    ambiguitySurface: config.ambiguitySurface ?? [],
    coreTier: config.coreTier,
    extendedTier: config.extendedTier,
  };
}

export function TestPlanSection(config: {
  readonly id: string;
  readonly number?: string;
  readonly title: string;
  readonly prose: string;
  readonly subsections?: readonly TestPlanSectionType[];
  readonly precedingDivider?: boolean;
}): TestPlanSectionType {
  return {
    tisyn_spec: "test-plan-section",
    id: config.id,
    ...(config.number != null ? { number: config.number } : {}),
    title: config.title,
    prose: config.prose,
    subsections: config.subsections ?? [],
    ...(config.precedingDivider === true ? { precedingDivider: true } : {}),
  };
}

export function TestCategory(config: {
  readonly id: string;
  readonly title: string;
  readonly tests: readonly TestCase[];
  readonly notes?: string;
}): TestCategory {
  return {
    tisyn_spec: "test-category",
    id: config.id,
    title: config.title,
    tests: config.tests,
    ...(config.notes != null ? { notes: config.notes } : {}),
  };
}

export function TestCase(config: {
  readonly id: string;
  readonly tier: Tier;
  readonly rules: readonly string[];
  readonly description: string;
  readonly setup: string;
  readonly expected: string;
  readonly evidence?: EvidenceTier;
}): TestCase {
  // D33 / SS-AMB-005: evidence defaults to EvidenceTier.Normative when
  // omitted. The default is applied here (in the constructor) rather than in
  // normalizeTestPlan, so N2 (authored fields pass through unchanged) is
  // honored — the field is authored once and normalization never re-defaults
  // it, which would otherwise shift _hash on round-trip.
  return {
    tisyn_spec: "test",
    id: config.id,
    tier: config.tier,
    rules: config.rules,
    description: config.description,
    setup: config.setup,
    expected: config.expected,
    evidence: config.evidence ?? EvidenceTierEnum.Normative,
  };
}

export function Covers(ruleId: string, testIds: readonly string[]): CoverageEntry {
  return { ruleId, testIds };
}

export function NonTest(config: {
  readonly id: string;
  readonly description: string;
  readonly reason: string;
}): NonTestEntry {
  return {
    id: config.id,
    description: config.description,
    reason: config.reason,
  };
}

export function Ambiguity(config: {
  readonly id: string;
  readonly specSection: string;
  readonly description: string;
  readonly resolution: Resolution;
  readonly resolvedIn?: string;
}): AmbiguityFinding {
  return {
    id: config.id,
    specSection: config.specSection,
    description: config.description,
    resolution: config.resolution,
    ...(config.resolvedIn != null ? { resolvedIn: config.resolvedIn } : {}),
  };
}
