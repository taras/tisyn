# Tisyn Specification System Specification

**Version:** 0.1.0
**Package:** `@tisyn/spec`
**Status:** Draft

---

## 1. Overview

This specification defines `@tisyn/spec`, the package that owns
the Tisyn specification corpus lifecycle: authoring, normalization,
registry construction, validation, coverage analysis, and
readiness determination.

The package provides a TypeScript DSL for authoring specifications
and test plans as typed data, a normalization pass that produces
committed JSON artifacts, a registry that indexes the corpus and
resolves cross-module relationships, and validation functions that
check consistency, coverage, and readiness.

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are
used as defined in RFC 2119.

### 1.2 Normative Scope

This specification covers:

- the authored source model for specifications and test plans
- the serializable data domain for spec data
- the PascalCase constructor vocabulary
- the enum vocabulary for closed fields
- the `tisyn_spec` discriminant convention
- the normalization model and normalized artifact shape
- the registry model and its computed indices
- the validation inventory (10 groups, 30+ checks)
- the spec/test-plan pair semantics
- the coverage and readiness model
- the traceability model for rule IDs, test IDs, and error codes
- the MVP public API surface

### 1.3 What This Specification Does Not Cover

- rendered markdown generation (deferred past MVP)
- public graph-query APIs over the dependency graph (deferred)
- automated constraint-document generation (deferred)
- CLI command surfaces (deferred)
- graph visualization (deferred)
- RDF, OWL, SPARQL, or external knowledge-graph integration
- editor integrations
- multi-package decomposition of `@tisyn/spec`
- automated migration from markdown to TypeScript DSL
- semver-range constraints on dependency references

### 1.4 Relationship to Other Specifications

This specification complements the Tisyn System Specification.
It does not depend on, amend, or import from any other
`@tisyn/*` package specification.

The `@tisyn/spec` package defines its own types in the
`tisyn_spec` tagged domain, disjoint from `tisyn` (IR) and
`tisyn_config` (config). Spec nodes MUST NOT appear inside IR
expression trees. IR nodes MUST NOT appear inside spec data.
Config nodes MUST NOT appear inside spec data.

### 1.5 Architectural Position

`@tisyn/spec` follows the same architectural pattern as
`@tisyn/config` and `@tisyn/ir`: typed constructors produce
serializable tagged data; the resulting structure is walkable
and inspectable without execution; validation is a separate
concern operating on constructed data.

The package has zero `@tisyn/*` dependencies in the MVP. This
is a current simplification. If a future feature requires a
dependency on a lower-layer Tisyn package, the dependency MUST
follow normal dependency discipline: lower-layer only, no
cycles.

---

## 2. Architectural Model

### 2.1 Three Representation Layers

The system has three layers. Each layer has a distinct role,
a distinct artifact shape, and a distinct lifecycle.

**Layer 1 — Authored module.** A TypeScript file (`*.spec.ts`
or `*.test-plan.ts`) whose default export is a `SpecModule`
or `TestPlanModule` value. This is the source of truth. Authors
edit this layer.

**Layer 2 — Normalized artifact.** A JSON file produced by
running the normalization pass over an authored module's
default export. This is the reviewed artifact — committed to
the repository, diffed in PRs, consumed by downstream tools
without a TypeScript runtime. One JSON artifact per source
module.

**Layer 3 — Registry.** An in-memory corpus-level index built
from the set of normalized artifacts. Not persisted. Rebuilt
on demand. Provides validation, coverage, and readiness
queries.

### 2.2 Layer Boundary Rules

**LB1.** The authored module is the sole source of truth for
all semantic content.

**LB2.** The normalized artifact MUST contain all authored
fields unchanged, plus computed fields added by normalization.
Normalization MUST NOT modify authored fields.

**LB3.** The registry MUST be derivable entirely from the set
of normalized artifacts. It MUST NOT require access to
authored TypeScript source.

**LB4.** Validation, coverage, and readiness results MUST be
derivable entirely from the registry. They MUST NOT require
re-loading source modules or re-running normalization.

### 2.3 Build Pipeline

```
discover source files (glob)
  → load each module (evaluate TypeScript, extract default export)
    → normalize each module (structural check, section numbering, hash)
      → emit JSON artifact (one per source file)
        → build registry (collect all artifacts, compute indices)
          → validate corpus (cross-reference, coverage, readiness)
```

Each step in the pipeline depends only on the output of the
preceding step.

---

## 3. Serializable Data Domain

### 3.1 Definition

All values returned by `@tisyn/spec` constructors and all
values stored in normalized artifacts MUST belong to the
**portable serializable data domain**.

The portable serializable data domain consists of:

- `null`
- `boolean`
- `number` (finite; no `NaN`, no `Infinity`)
- `string`
- arrays of values from this domain
- plain objects with string keys and values from this domain
  (no prototype chain beyond `Object.prototype`, no Symbol
  keys, no methods)

Enum values backed by strings from this domain (e.g.,
`Status.Active` serializes as `"active"`) are permitted.

### 3.2 Excluded Values

The following MUST NOT appear in constructor output or
normalized artifacts:

- `undefined`
- `BigInt`
- `Symbol`
- `Date`, `RegExp`, `Map`, `Set`, `ArrayBuffer`
- class instances (any object whose prototype chain extends
  beyond `Object.prototype`)
- functions
- circular references

### 3.3 Relationship to Other Domains

This is the same domain defined by the Tisyn Configuration
Specification §3.1 and used by `@tisyn/ir`. JSON round-trip
(`JSON.parse(JSON.stringify(v))`) MAY be used as a practical
conformance check, but the normative definition is §3.1 above.

### 3.4 Constructors and Data

Constructor functions (e.g., `Spec()`, `Rule()`, `TestCase()`)
are ordinary TypeScript functions. They accept typed arguments
and return plain objects within the serializable data domain.
The functions themselves are not part of the emitted data.
Only their return values are.

---

## 4. Authoring Model

### 4.1 Source Files

Specification source files use the suffix `.spec.ts`. Test-plan
source files use the suffix `.test-plan.ts`. Both reside under
a configured specs directory (default: `specs/`).

**A1.** Every `.spec.ts` file MUST have a default export of
type `SpecModule`.

**A2.** Every `.test-plan.ts` file MUST have a default export
of type `TestPlanModule`.

**A3.** The default export MUST belong to the portable
serializable data domain (§3).

### 4.2 Constructor Convention

All authored constructors use PascalCase names:

| Constructor | Produces |
|---|---|
| `Spec(...)` | `SpecModule` |
| `Section(...)` | `SpecSection` |
| `Rule(...)` | `RuleDeclaration` |
| `ErrorCode(...)` | `ErrorCodeDeclaration` |
| `Concept(...)` | `ConceptExport` |
| `Invariant(...)` | `InvariantDeclaration` |
| `Term(...)` | `TermDefinition` |
| `DependsOn(...)` | `SpecRef` |
| `Amends(...)` | `AmendmentRef` |
| `Complements(...)` | `SpecRef` |
| `ImplementsSpec(...)` | `SpecRef` |
| `Amendment(...)` | `AmendmentDetail` |
| `ChangedSection(...)` | `SectionChange` |
| `UnchangedSection(...)` | `SectionPreservation` |
| `TestPlan(...)` | `TestPlanModule` |
| `TestCategory(...)` | `TestCategory` |
| `TestCase(...)` | `TestCase` |
| `Covers(...)` | `CoverageEntry` |
| `NonTest(...)` | `NonTestEntry` |
| `Ambiguity(...)` | `AmbiguityFinding` |

**A4.** Constructors MUST be pure functions. Calling a
constructor with the same arguments MUST produce structurally
identical return values.

**A5.** Constructors MUST return values within the serializable
data domain (§3). No constructor MAY return a value containing
functions, class instances, or any excluded type.

### 4.3 Discriminant Convention

Spec data nodes use `tisyn_spec` as the discriminant field.

| Discriminant value | Type |
|---|---|
| `"spec"` | `SpecModule` |
| `"test-plan"` | `TestPlanModule` |
| `"section"` | `SpecSection` |
| `"rule"` | `RuleDeclaration` |
| `"error-code"` | `ErrorCodeDeclaration` |
| `"concept"` | `ConceptExport` |
| `"invariant"` | `InvariantDeclaration` |
| `"term"` | `TermDefinition` |
| `"test-category"` | `TestCategory` |
| `"test"` | `TestCase` |

Not every type in the spec data model carries a discriminant.
Types that appear only as embedded fields within a
discriminated parent (e.g., `SpecRef`, `AmendmentRef`,
`CoverageEntry`, `NonTestEntry`, `AmbiguityFinding`,
`SectionChange`, `SectionPreservation`) do not require a
`tisyn_spec` discriminant.

**A6.** Discriminant values MUST be string literals, not enum
values.

**A7.** An object MUST NOT carry both a `tisyn_spec` field and
a `tisyn` or `tisyn_config` field. The three tagged domains are
disjoint.

### 4.4 Enum Convention

Closed vocabulary fields use TypeScript enums with string
backing:

```typescript
enum Status {
  Draft = "draft",
  Active = "active",
  Superseded = "superseded",
}

enum Strength {
  MUST = "MUST",
  MUST_NOT = "MUST NOT",
  SHOULD = "SHOULD",
  SHOULD_NOT = "SHOULD NOT",
  MAY = "MAY",
}

enum Tier {
  Core = "core",
  Extended = "extended",
  Draft = "draft",
}

enum EvidenceTier {
  Normative = "normative",
  Harness = "harness",
}

enum ChangeType {
  Added = "added",
  Modified = "modified",
  Removed = "removed",
}

enum Resolution {
  Resolved = "resolved",
  Deferred = "deferred",
  Unresolved = "unresolved",
}
```

**A8.** Enum values MUST serialize to their string backing
without transformation. `Status.Active` in authored source
and `"active"` in JSON artifacts MUST be treated as equivalent.

### 4.5 Inter-File Import Restriction

**A9.** Authored spec modules (`*.spec.ts`) and test-plan
modules (`*.test-plan.ts`) MUST NOT import each other.
Dependencies between specifications are declared as data
(e.g., `DependsOn("tisyn-kernel-specification", "1.0.0")`)
and resolved at registry construction time, not at module
evaluation time.

**A10.** Spec and test-plan modules MAY import constructors,
enums, and types from `@tisyn/spec`.

**A11.** Spec and test-plan modules MAY import shared constants
from local helper modules. Helper modules are not spec modules
— they MUST NOT have a default export of type `SpecModule` or
`TestPlanModule`, and they MUST NOT match the discovery glob
patterns.

---

## 5. Data Model

### 5.1 SpecModule

```typescript
interface SpecModule {
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
```

**D1.** `id` MUST be a non-empty string. It is the globally
unique identifier for this specification within the corpus.

**D2.** `version` MUST be a non-empty string.

**D3.** `status` MUST be a `Status` enum value.

**D4.** `sections` MUST contain at least one `SpecSection`.

**D5.** If `amends` is non-empty, `amendment` SHOULD be
present.

### 5.2 TestPlanModule

```typescript
interface TestPlanModule {
  readonly tisyn_spec: "test-plan";
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly status: Status;

  readonly testsSpec: SpecRef;

  readonly categories: readonly TestCategory[];
  readonly coverageMatrix: readonly CoverageEntry[];
  readonly nonTests: readonly NonTestEntry[];
  readonly ambiguitySurface: readonly AmbiguityFinding[];

  readonly coreTier: number;
  readonly extendedTier: number;
}
```

**D6.** `id` MUST be a non-empty string. It is globally
unique within the corpus.

**D7.** `testsSpec` MUST reference the spec this plan tests.

**D8.** `coreTier` MUST equal the count of `TestCase` entries
with `tier === Tier.Core` across all categories.

**D9.** `extendedTier` MUST equal the count of `TestCase`
entries with `tier === Tier.Extended` across all categories.

### 5.3 SpecSection

```typescript
interface SpecSection {
  readonly tisyn_spec: "section";
  readonly id: string;
  readonly title: string;
  readonly normative: boolean;
  readonly prose: string;
  readonly subsections: readonly SpecSection[];
}
```

**D10.** `id` MUST be a non-empty string. Section IDs are
author-declared stable identifiers, not display numbers.
Display numbers are computed during normalization.

**D11.** `id` MUST be unique within the containing
`SpecModule`. Two sections in the same module MUST NOT share
an `id`, including across nesting levels.

### 5.4 RuleDeclaration

```typescript
interface RuleDeclaration {
  readonly tisyn_spec: "rule";
  readonly id: string;
  readonly section: string;
  readonly strength: Strength;
  readonly statement: string;
  readonly prose?: string;
}
```

**D12.** `id` MUST be globally unique across the entire
corpus. Convention: `<spec-prefix>-<type><number>` (e.g.,
`SP-R1`, `TB-R6`, `CFG-V1`).

**D13.** `section` MUST reference a valid section ID within the
containing `SpecModule`.

**D14.** `strength` MUST be a `Strength` enum value.

**D15.** `statement` MUST be a non-empty string containing a
concise normative assertion.

### 5.5 ErrorCodeDeclaration

```typescript
interface ErrorCodeDeclaration {
  readonly tisyn_spec: "error-code";
  readonly code: string;
  readonly section: string;
  readonly trigger: string;
  readonly requiredContent?: readonly string[];
}
```

**D16.** `code` MUST be a non-empty string. It MUST be
globally unique across the corpus.

**D17.** `section` MUST reference a valid section ID within
the containing `SpecModule`.

**D18.** `trigger` MUST be a non-empty string describing
what condition triggers this error.

**D19.** If `requiredContent` is present, it MUST contain at
least one entry. Each entry names a piece of information that
the diagnostic MUST include when this error is reported.

### 5.6 ConceptExport

```typescript
interface ConceptExport {
  readonly tisyn_spec: "concept";
  readonly name: string;
  readonly section: string;
  readonly description: string;
}
```

**D20.** `name` MUST be a non-empty string.

**D21.** `section` MUST reference a valid section ID within
the containing `SpecModule`.

### 5.7 InvariantDeclaration

```typescript
interface InvariantDeclaration {
  readonly tisyn_spec: "invariant";
  readonly id: string;
  readonly section: string;
  readonly statement: string;
}
```

**D22.** `id` MUST be a non-empty string. It follows the
same global uniqueness rule as rule IDs (D12).

**D23.** `section` MUST reference a valid section ID within
the containing `SpecModule`.

### 5.8 TermDefinition

```typescript
interface TermDefinition {
  readonly tisyn_spec: "term";
  readonly term: string;
  readonly section: string;
  readonly definition: string;
}
```

**D24.** `term` MUST be a non-empty string.

**D25.** `section` MUST reference a valid section ID within
the containing `SpecModule`.

### 5.9 Relationship Types

```typescript
interface SpecRef {
  readonly specId: string;
  readonly version?: string;
}

interface AmendmentRef {
  readonly specId: string;
  readonly version?: string;
  readonly sections?: readonly string[];
}
```

**D26.** `specId` MUST be a non-empty string.

**D27.** If `sections` is present in an `AmendmentRef`, each
entry MUST name a section ID that exists in the target spec.

### 5.10 Amendment Detail

```typescript
interface AmendmentDetail {
  readonly changedSections: readonly SectionChange[];
  readonly unchangedSections: readonly SectionPreservation[];
  readonly preservedBehavior: readonly string[];
  readonly newBehavior: readonly string[];
}

interface SectionChange {
  readonly targetSpec: string;
  readonly section: string;
  readonly changeType: ChangeType;
}

interface SectionPreservation {
  readonly targetSpec: string;
  readonly section: string;
}
```

**D28.** `changeType` MUST be a `ChangeType` enum value.

### 5.11 Test Plan Types

```typescript
interface TestCategory {
  readonly tisyn_spec: "test-category";
  readonly id: string;
  readonly title: string;
  readonly tests: readonly TestCase[];
}

interface TestCase {
  readonly tisyn_spec: "test";
  readonly id: string;
  readonly tier: Tier;
  readonly rules: readonly string[];
  readonly description: string;
  readonly setup: string;
  readonly expected: string;
  readonly evidence?: EvidenceTier;
}
```

**D29.** `TestCategory.id` MUST be a non-empty string, unique
within the containing `TestPlanModule`.

**D30.** `TestCase.id` MUST be a non-empty string, globally
unique across the corpus.

**D31.** `TestCase.tier` MUST be a `Tier` enum value.

**D32.** `TestCase.rules` MUST contain at least one entry.
Each entry MUST be a rule ID or invariant ID.

**D33.** `TestCase.evidence` defaults to `EvidenceTier.Normative`
if omitted.

### 5.12 Coverage and Ambiguity Types

```typescript
interface CoverageEntry {
  readonly ruleId: string;
  readonly testIds: readonly string[];
}

interface NonTestEntry {
  readonly id: string;
  readonly description: string;
  readonly reason: string;
}

interface AmbiguityFinding {
  readonly id: string;
  readonly specSection: string;
  readonly description: string;
  readonly resolution: Resolution;
  readonly resolvedIn?: string;
}
```

**D34.** `CoverageEntry.ruleId` MUST reference a rule ID
defined in the target spec.

**D35.** Each entry in `CoverageEntry.testIds` MUST reference
a `TestCase.id` defined in the same `TestPlanModule`.

**D36.** `AmbiguityFinding.resolution` MUST be a `Resolution`
enum value.

**D37.** If `resolution` is `Resolution.Resolved`, `resolvedIn`
SHOULD be present and SHOULD reference a spec version string.

### 5.13 Computed and Index Types

The following types are produced by normalization or registry
construction. They do not appear in authored source.

```typescript
interface NormalizedSpecModule extends SpecModule {
  readonly _sectionNumbering: Readonly<Record<string, string>>;
  readonly _ruleLocations: Readonly<Record<string, string>>;
  readonly _hash: string;
  readonly _normalizedAt: string;
}

interface NormalizedTestPlanModule extends TestPlanModule {
  readonly _hash: string;
  readonly _normalizedAt: string;
}
```

**D38.** `NormalizedSpecModule` includes all authored
`SpecModule` fields unchanged, plus the four computed fields
defined in N3.

**D39.** `NormalizedTestPlanModule` includes all authored
`TestPlanModule` fields unchanged, plus `_hash` and
`_normalizedAt`. It does not include `_sectionNumbering` or
`_ruleLocations` because `TestPlanModule` has no section tree
or rule declarations.

```typescript
interface RuleLocation {
  readonly specId: string;
  readonly section: string;
  readonly strength: Strength;
}

interface ErrorCodeLocation {
  readonly specId: string;
  readonly section: string;
  readonly trigger: string;
}

interface ConceptLocation {
  readonly specId: string;
  readonly section: string;
  readonly description: string;
}
```

**D40.** `RuleLocation` records the declaring spec, section,
and normative strength for a rule or invariant indexed by the
registry (R5).

**D41.** `ErrorCodeLocation` records the declaring spec,
section, and trigger for an error code indexed by the registry
(R6).

**D42.** `ConceptLocation` records the declaring spec, section,
and description for a concept indexed by the registry (R8).

```typescript
interface CoverageReport {
  readonly specId: string;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationError[];
  readonly uncoveredRules: readonly string[];
}
```

**D43.** `CoverageReport` is the return type of
`checkCoverage()`. `uncoveredRules` lists rule IDs that have
no covering `Tier.Core` test. `errors` contains blocking
coverage failures (e.g., rule references that do not resolve).
`warnings` contains advisory coverage gaps (e.g., rules
lacking Core coverage).

---

## 6. Normalization Model

### 6.1 Purpose

Normalization transforms an authored module value into a
canonical JSON artifact suitable for committing, diffing, and
downstream consumption without a TypeScript runtime.

### 6.2 Normalization Behavior

**N1.** Normalization MUST accept a `SpecModule` or
`TestPlanModule` value and return a `NormalizedSpecModule` or
`NormalizedTestPlanModule` value.

**N2.** Normalization MUST NOT modify any authored field.
The authored module's fields MUST appear in the normalized
output unchanged.

**N3.** Normalization MUST add the following computed fields.

For `SpecModule` normalization (producing `NormalizedSpecModule`):

| Field | Type | Description |
|---|---|---|
| `_sectionNumbering` | `Record<string, string>` | Maps section IDs to display numbers (e.g., `"compound-external"` → `"§4.3"`) |
| `_ruleLocations` | `Record<string, string>` | Maps rule IDs to display section numbers (e.g., `"SP-R1"` → `"§3.1"`) |
| `_hash` | `string` | Deterministic content hash of all authored fields |
| `_normalizedAt` | `string` | ISO 8601 timestamp of when normalization ran |

For `TestPlanModule` normalization (producing
`NormalizedTestPlanModule`):

| Field | Type | Description |
|---|---|---|
| `_hash` | `string` | Deterministic content hash of all authored fields |
| `_normalizedAt` | `string` | ISO 8601 timestamp of when normalization ran |

`TestPlanModule` has no section tree or rule declarations, so
`_sectionNumbering` and `_ruleLocations` do not apply and MUST
NOT be present on `NormalizedTestPlanModule` (D39).

**N4.** `_sectionNumbering` MUST be computed by depth-first
traversal of the section tree. Top-level sections are numbered
§1, §2, §3, etc. Subsections are numbered §1.1, §1.2, etc.
Children are ordered by their declaration order in the
`subsections` array.

**N5.** `_ruleLocations` MUST be computed by resolving each
rule's `section` field against `_sectionNumbering`. If a
rule's `section` does not appear in `_sectionNumbering`,
normalization MUST report a structural error.

**N6.** `_hash` MUST be deterministic. Given the same authored
fields, the hash MUST be identical regardless of when or where
normalization runs. The hash MUST NOT depend on `_normalizedAt`
or any other computed field.

### 6.3 Structural Validation During Normalization

**N7.** Normalization MUST perform structural validation on
the authored module before computing normalized fields.
Structural validation checks:

- required fields are present (D1–D37)
- field types are correct
- section IDs are unique within the module (D11)
- rule section references resolve within the module (D13)
- error-code section references resolve within the module (D17)
- concept section references resolve (D21)
- invariant section references resolve (D23)
- term section references resolve (D25)
- tier counts match actual test counts (D8, D9)

**N8.** If structural validation fails, normalization MUST
return an error result and MUST NOT emit a normalized artifact.

### 6.4 Artifact Emission

**N9.** Each source module produces exactly one normalized
JSON artifact. Normalization MUST NOT merge, split, or produce
cross-file artifacts.

**N10.** Artifact file paths MUST follow the pattern:

```
<specsDir>/.tisyn-spec/<module-id>.json
```

where `<module-id>` is the `id` field of the authored module.

**N11.** The artifact MUST be a JSON file containing the
serialized `NormalizedSpecModule` or `NormalizedTestPlanModule`.
The JSON MUST be formatted with consistent indentation for
diffability.

### 6.5 Determinism

**N12.** Normalization MUST be deterministic. Given the same
authored module value, normalization MUST produce byte-identical
JSON output, with the sole exception of the `_normalizedAt`
timestamp.

**N13.** Staleness detection MUST compare all fields except
`_normalizedAt`. Two artifacts are considered equivalent if
they differ only in `_normalizedAt`.

### 6.6 Commit Policy

**N14.** Normalized artifacts MUST be committed to the
repository. They are the reviewed artifact surface for PRs.

**N15.** CI SHOULD enforce staleness. The recommended check:
normalize each source module, compare the output (excluding
`_normalizedAt`) to the committed artifact, and fail if they
differ.

---

## 7. Registry Model

### 7.1 Purpose

The registry is an in-memory corpus-level index built from the
set of all normalized artifacts. It resolves cross-module
relationships and provides the data structures needed for
validation, coverage, and readiness queries.

### 7.2 Construction

**R1.** `buildRegistry()` MUST accept arrays of
`NormalizedSpecModule` and `NormalizedTestPlanModule` values
and return a `SpecRegistry` value.

**R2.** The registry MUST be constructable from normalized
artifacts alone. It MUST NOT require access to authored
TypeScript source.

### 7.3 Indexed Structures

The registry MUST compute and expose the following structures:

```typescript
interface SpecRegistry {
  readonly specs: ReadonlyMap<string, NormalizedSpecModule>;
  readonly testPlans: ReadonlyMap<string, NormalizedTestPlanModule>;
  readonly ruleIndex: ReadonlyMap<string, RuleLocation>;
  readonly errorCodeIndex: ReadonlyMap<string, ErrorCodeLocation>;
  readonly termAuthority: ReadonlyMap<string, string>;
  readonly conceptIndex: ReadonlyMap<string, ConceptLocation>;
}
```

**R3.** `specs` MUST map spec `id` to normalized module.

**R4.** `testPlans` MUST map test-plan `id` to normalized module.

**R5.** `ruleIndex` MUST map every rule ID and invariant ID
across the corpus to its declaring spec and section.

**R6.** `errorCodeIndex` MUST map every error code across the
corpus to its declaring spec, section, and trigger.

**R7.** `termAuthority` MUST map every defined term to the
spec ID that defines it.

**R8.** `conceptIndex` MUST map every exported concept name
to its declaring spec and section.

### 7.4 Internal Structures

The registry MUST also compute the following structures for
use by validation. These are internal — the registry is not
required to expose them as public API in the MVP.

**R9.** A dependency graph (adjacency list from `dependsOn`
edges).

**R10.** A reverse-dependency graph (inverse of the dependency
graph).

**R11.** An amendment chain map (from `amends` edges).

**R12.** A spec-to-test-plan pairing (from `testsSpec`
references).

### 7.5 Registry Boundaries

**R13.** The registry MUST NOT persist to disk. It is rebuilt
on demand.

**R14.** The registry MUST NOT expose public graph-traversal
or impact-analysis APIs in the MVP. Functions such as
`dependentsOf()`, `impactOf()`, `topologicalOrder()`, and
`generateConstraints()` are deferred.

---

## 8. Validation Inventory

### 8.1 Validation Structure

`validateCorpus()` accepts a `SpecRegistry` and returns a
`ValidationReport` containing errors and warnings.

```typescript
interface ValidationReport {
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationError[];
}

interface ValidationError {
  readonly group: string;
  readonly check: string;
  readonly message: string;
  readonly specId?: string;
  readonly testPlanId?: string;
  readonly ruleId?: string;
  readonly sectionId?: string;
}
```

**VA1.** Errors are blocking. A corpus with errors is not
consistent.

**VA2.** Warnings are advisory. A corpus with only warnings
is consistent but may have coverage or completeness gaps.

### 8.2 V1 — Identity and Uniqueness

**V1-1.** Every `SpecModule.id` MUST be non-empty. Violation
is an error.

**V1-2.** Every `TestPlanModule.id` MUST be non-empty.
Violation is an error.

**V1-3.** Two `SpecModule` values in the registry MUST NOT
share the same `id`. Violation is an error.

**V1-4.** Two `TestPlanModule` values in the registry MUST NOT
share the same `id`. Violation is an error.

**V1-5.** Every rule ID in `ruleIndex` MUST be unique across
the corpus. If two specs define the same rule ID, it is an
error.

**V1-6.** Every error code in `errorCodeIndex` MUST be unique
across the corpus. Violation is an error.

### 8.3 V2 — Spec/Test-Plan Linkage

**V2-1.** Every `testsSpec.specId` in a test plan MUST resolve
to an existing spec in the registry. Violation is an error.

**V2-2.** If `testsSpec.version` is specified, it SHOULD match
the target spec's `version`. Mismatch is a warning.

**V2-3.** Every spec with `status === Status.Active` SHOULD
have at least one companion test plan (a test plan whose
`testsSpec.specId` matches). Absence is a warning.

### 8.4 V3 — Rule Coverage

**V3-1.** Every `ruleId` in a `CoverageEntry` MUST exist in
the target spec's rules or invariants. Violation is an error.

**V3-2.** Every `testId` in a `CoverageEntry` MUST exist as
a `TestCase.id` in the same `TestPlanModule`. Violation is an
error.

**V3-3.** Every rule ID in a `TestCase.rules` array MUST exist
in the corpus `ruleIndex`. Violation is an error.

**V3-4.** Every normative rule (any `RuleDeclaration` or
`InvariantDeclaration`) in a spec SHOULD appear in at least
one `CoverageEntry` in a companion test plan. Absence is a
warning.

**V3-5.** Every normative rule SHOULD be covered by at least
one `Tier.Core` test. Absence is a warning.

**V3-6.** `coreTier` and `extendedTier` counts SHOULD match
the actual count of test cases per tier. Mismatch is a warning.

### 8.5 V4 — Amendment Integrity

**V4-1.** Every `specId` in an `AmendmentRef` MUST resolve to
an existing spec. Violation is an error.

**V4-2.** If `sections` is specified in an `AmendmentRef`,
every section ID MUST exist in the target spec. Violation is
an error.

**V4-3.** Every spec whose `amends` array is non-empty SHOULD
have an `amendment` field. Absence is a warning.

### 8.6 V5 — Changed/Unchanged Section Integrity

**V5-1.** Every section in `changedSections` MUST exist in the
target spec. Violation is an error.

**V5-2.** Every section in `unchangedSections` MUST exist in
the target spec. Violation is an error.

**V5-3.** A section MUST NOT appear in both `changedSections`
and `unchangedSections`. Violation is an error.

**V5-4.** The union of changed and unchanged sections SHOULD
cover all sections of the target spec. Incomplete coverage is
a warning.

### 8.7 V6 — Dependency and Reference Integrity

**V6-1.** Every `specId` in a `DependsOn` reference MUST
resolve to an existing spec. Violation is an error.

**V6-2.** Every `specId` in a `Complements` reference MUST
resolve to an existing spec. Violation is an error.

**V6-3.** The dependency graph (all `dependsOn` edges) MUST
be acyclic. A cycle is an error.

**V6-4.** The amendment graph (all `amends` edges) MUST be
acyclic. A cycle is an error.

**V6-5.** No spec SHOULD depend on a spec with
`status === Status.Superseded`. Violation is a warning.

### 8.8 V7 — Term Authority and Concept Conflicts

**V7-1.** No term SHOULD be defined by more than one spec.
Duplicate definitions are a warning.

**V7-2.** No concept name SHOULD be exported by more than one
spec with a conflicting description. Conflict is a warning.

### 8.9 V8 — Stale References

**V8-1.** Every rule ID referenced in a `TestCase.rules` array
MUST exist in the corpus `ruleIndex` at the current spec
version. A reference to a removed rule is an error.

**V8-2.** Every section reference in a test plan (e.g., in
`AmbiguityFinding.specSection`) SHOULD resolve to a section
that exists in the target spec. A stale section reference is
a warning.

**V8-3.** If an `AmbiguityFinding` has
`resolution === Resolution.Resolved` and `resolvedIn` is
present, `resolvedIn` SHOULD reference a recognizable version
string. An unrecognizable reference is a warning.

### 8.10 V9 — Error-Code Traceability Integrity

**V9-1.** Every `ErrorCodeDeclaration` SHOULD have a non-empty
`trigger`. Violation is a warning. (The structural requirement
is already enforced by D18 during normalization; this check
exists as a defensive re-check for non-conforming artifacts.)

**V9-2.** If `requiredContent` is present, it SHOULD contain
at least one entry. An empty array is a warning. (The
structural requirement is already enforced by D19 during
normalization; this check exists as a defensive re-check for
non-conforming artifacts.)

**V9-3.** An error code MUST NOT collide with a rule ID
within the same spec. Collision is an error.

### 8.11 V10 — Readiness

Readiness is computed, not asserted. `isReady(specId)` returns
`true` if and only if all four conditions hold:

**V10-1.** The spec has `status === Status.Active`.

**V10-2.** A companion test plan exists with
`status === Status.Active`.

**V10-3.** `checkCoverage()` reports zero errors for this
spec pair.

**V10-4.** The companion test plan contains zero
`AmbiguityFinding` entries with
`resolution === Resolution.Unresolved`.

---

## 9. Spec/Test-Plan Pair Semantics

### 9.1 The Pair as Design Unit

A specification defines normative rules. A companion test
plan translates those rules into concrete expected outcomes
and tracks coverage.

**P1.** A spec without a companion test plan is not considered
implementation-ready regardless of its status.

**P2.** A test plan MUST reference exactly one spec via
`testsSpec`.

**P3.** The readiness query (`isReady()`) evaluates the pair,
not the spec alone.

### 9.2 Ambiguity Surface

**P4.** `AmbiguityFinding` is a first-class type in the
test-plan data model. It records a passage in the spec that
could not be translated into a concrete test expectation
without clarification.

**P5.** Ambiguity findings MUST persist across test-plan
versions. They are design knowledge, not ephemeral notes.

**P6.** Each finding has:

- `id` — stable identifier
- `specSection` — which part of the spec was ambiguous
- `description` — what could not be tested
- `resolution` — `Resolution.Resolved`, `Resolution.Deferred`,
  or `Resolution.Unresolved`
- `resolvedIn` — which spec version or amendment resolved it
  (present when `resolution` is `Resolution.Resolved`)

**P7.** Unresolved findings block readiness (V10-4).

### 9.3 Test Tiers

**P8.** `Tier.Core` tests validate MUST-level normative rules.
They define the minimum conformance bar. A conforming
implementation passes all Core tests.

**P9.** `Tier.Extended` tests validate SHOULD-level rules and
diagnostic behavior. They strengthen confidence but are not
required for conformance.

**P10.** `Tier.Draft` tests are gated on unresolved prototype
questions or spec maturity gaps. They are promoted to Core or
Extended when the gating question is resolved.

**P11.** Coverage validation (V3-5) checks Core coverage
specifically.

### 9.4 Evidence Tiers

**P12.** `EvidenceTier.Normative` assertions validate
observable public-surface behavior. They determine
conformance.

**P13.** `EvidenceTier.Harness` assertions validate
reference-harness-internal state. They strengthen or diagnose
tests in the reference suite but are not part of the normative
conformance surface.

**P14.** A test whose `evidence` field is omitted defaults to
`EvidenceTier.Normative` (D33).

---

## 10. Traceability Model

### 10.1 Traceability Chain

The system supports a traceability chain from a failing test
to the normative source:

```
failing test
  → TestCase.id
    → TestCase.rules (one or more rule IDs)
      → ruleIndex lookup → specId + section
        → (if applicable) errorCodeIndex lookup
          → specId + section + trigger
```

**T1.** Every link in the chain is a typed field in the data
model. No link requires prose parsing.

**T2.** `TestCase.rules` MUST contain at least one entry (D32).
Every test is traceable to at least one normative rule.

**T3.** The registry's `ruleIndex` and `errorCodeIndex` provide
single-map-access lookup for any rule ID or error code.

### 10.2 Rule ID Namespace

**T4.** Rule IDs are globally unique across the corpus (D12,
V1-5).

**T5.** The recommended convention is
`<spec-prefix>-<type><number>`:

| Prefix | Spec |
|---|---|
| `KRN` | Kernel |
| `SP` | Spawn |
| `TB` | Timebox |
| `CFG` | Config |
| `CMP` | Compiler |
| `SI` | Stream iteration |
| `BS` | Blocking scope |

The convention is recommended, not enforced. Uniqueness is
enforced by validation (V1-5).

### 10.3 Error Code Required Content

**T6.** `ErrorCodeDeclaration.requiredContent` specifies what
information the diagnostic MUST include when the error is
reported. This enables test plans to assert not just "error
was thrown" but "error contains the required fields."

---

## 11. Public API Surface

### 11.1 Authoring API

Exported for use in `*.spec.ts` and `*.test-plan.ts`:

- all PascalCase constructors (§4.2)
- all enums (§4.4)

### 11.2 Build API

Exported for use in build scripts and CI:

- `normalizeSpec(module: SpecModule): NormalizeResult<NormalizedSpecModule>`
- `normalizeTestPlan(module: TestPlanModule): NormalizeResult<NormalizedTestPlanModule>`
- `buildRegistry(specs, testPlans): SpecRegistry`

`NormalizeResult<T>` is a discriminated union expressing the
error-result return required by N8:

```typescript
type NormalizeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly StructuralError[] };

interface StructuralError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly detail?: Readonly<Record<string, string | number>>;
}
```

On success, `result.value` is the conforming normalized artifact
described in §13.2. On failure, `result.errors` lists every
structural violation detected under §6.3 and no normalized
artifact is produced.

### 11.3 Validation API

Exported for use in CI and programmatic checks:

- `validateCorpus(registry: SpecRegistry): ValidationReport`
- `checkCoverage(registry: SpecRegistry, specId: string): CoverageReport`
- `isReady(registry: SpecRegistry, specId: string): boolean`

### 11.4 Traversal API

Exported for programmatic analysis over module data:

- `walkSections(module: SpecModule, visitor): void`
- `collectRules(module: SpecModule): RuleDeclaration[]`
- `collectErrorCodes(module: SpecModule): ErrorCodeDeclaration[]`
- `collectTerms(module: SpecModule): TermDefinition[]`

### 11.5 Types

All interfaces, type aliases, and enums defined in §4 and §5
are exported. In addition, `NormalizeResult<T>` and
`StructuralError` (§11.2) are exported so that callers can
pattern-match on normalization outcomes.

### 11.6 Internal Modules

The following modules are internal to the package and MUST NOT
be part of the public API in the MVP:

| Module | Reason |
|---|---|
| `render.ts` | Rendering is deferred. |
| `graph.ts` | Public graph-query APIs are deferred. |
| `constraints.ts` | Constraint generation is deferred. |

---

## 12. Explicit Non-Goals

The following are explicitly excluded from `@tisyn/spec`
v0.1.0. They MUST NOT be implemented in the MVP.

**NG1.** `renderSpec()` and `renderTestPlan()` — rendered
markdown generation.

**NG2.** `dependentsOf()`, `impactOf()`, `topologicalOrder()`
— public graph-query APIs.

**NG3.** `generateConstraints()` — automated
constraint-document generation.

**NG4.** CLI command surfaces (`tsn spec check`, etc.).

**NG5.** Graph visualization (DOT, Mermaid, or equivalent).

**NG6.** RDF, OWL, SPARQL, or external knowledge-graph
integration.

**NG7.** Multi-package decomposition of `@tisyn/spec`.

**NG8.** Editor integrations (LSP, hover, go-to-definition).

**NG9.** Automated markdown-to-TypeScript-DSL migration
tooling.

**NG10.** Error-code catalog generation from spec
declarations.

**NG11.** Semver-range constraints on `DependsOn` references.

---

## 13. Conformance

### 13.1 Conforming Authored Module

An authored module conforms to this specification if:

1. Its default export belongs to the serializable data
   domain (§3).
2. Its default export satisfies the structural rules for
   `SpecModule` (D1–D5) or `TestPlanModule` (D6–D9).
3. All section IDs are unique within the module (D11).
4. All rule, invariant, error-code, concept, and term
   section references resolve to sections within the same
   module (D13, D17, D21, D23, D25).
5. All discriminant values match the values specified in
   §4.3.
6. All enum fields use the specified enum values (§4.4).
7. The module does not import other spec or test-plan
   modules (A9).

### 13.2 Conforming Normalized Artifact

A normalized artifact is the `value` field of a successful
`NormalizeResult<T>` — that is, the `T` produced when
`result.ok === true` (§11.2). A normalized artifact conforms to
this specification if:

1. It contains all authored fields unchanged (N2).
2. For `NormalizedSpecModule`: it contains `_sectionNumbering`,
   `_ruleLocations`, `_hash`, and `_normalizedAt` (D38).
   For `NormalizedTestPlanModule`: it contains `_hash` and
   `_normalizedAt` (D39).
3. `_sectionNumbering` (where present) reflects depth-first
   declaration-order traversal (N4).
4. `_ruleLocations` (where present) is consistent with
   `_sectionNumbering` (N5).
5. `_hash` is deterministic (N6).
6. The artifact is valid JSON within the serializable data
   domain (§3).

A failed `NormalizeResult<T>` (where `result.ok === false`)
produces no normalized artifact; callers inspect
`result.errors` instead.

### 13.3 Conforming Registry

A registry implementation conforms to this specification if:

1. It indexes all provided normalized modules (R3, R4).
2. It computes `ruleIndex`, `errorCodeIndex`,
   `termAuthority`, and `conceptIndex` (R5–R8).
3. It computes internal graph structures sufficient for
   validation (R9–R12).
4. `validateCorpus()` implements all checks in §8
   (V1-1 through V9-3) with correct blocking/advisory
   classification.
5. `checkCoverage()` implements the coverage checks in
   §8.4 (V3-1 through V3-6).
6. `isReady()` implements the four-condition readiness
   check (V10-1 through V10-4).
