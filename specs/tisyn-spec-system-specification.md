# Tisyn Specification System Specification

**Complements:** Tisyn System Specification
**Depends on:** Tisyn CLI Specification (`tsn run` execution
model)

---

## 1. Overview

This specification defines the Tisyn specification system:
the data model, acquisition contract, query contract, context
assembly contract, and workflow contract for a typed,
queryable canonical specification corpus.

The specification system follows the same pattern as Tisyn IR
and Tisyn configuration: typed constructors produce
serializable tagged data in a dedicated domain
(`tisyn_spec`). The data is normalized, indexed, and consumed
by pure query functions and production workflows.

The system serves three operational goals:

- **Discovery compression.** Future consumers retrieve
  relevant normative content (rules, terms, dependencies,
  constraints) from the corpus in compact typed form
  rather than scanning multi-page prose documents.
- **Implementation alignment.** The relationship between
  normative rules and companion test cases is mechanically
  checkable through coverage queries.
- **Consistency enforcement.** Contradictions, stale
  references, terminology drift, and dependency
  mismatches across the corpus are detectable by analysis
  queries over the corpus registry.

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY
are used as defined in RFC 2119.

### 1.2 Package

Package: `@tisyn/spec`. Zero `@tisyn/*` runtime dependencies.
Development dependencies only (`vitest`, `node:crypto`).

---

## 2. Normative Scope

### 2.1 In Scope

- Canonical structured specification corpus data model
- Canonical structured test-plan corpus data model
- Tagged data domain (`tisyn_spec`) and constructor
  vocabulary
- Normalization contract and structural validation rules
- Corpus registry construction and index guarantees
- Corpus acquisition contract, including manifest-based
  discovery and optional scope filtering
- Query contract: lookup, listing, relationship, analysis,
  and projection query categories
- Query scope classification (scope-safe, scope-relative,
  full-corpus-recommended)
- Context assembly contract
- Production workflow contract (acquire → assemble → return)
- Maintenance workflow contract
- Auxiliary acquisition of non-registry comparison inputs
- Emitted artifact model (generated Markdown as derived
  projection)
- Discovery pack model (typed canonical form with optional
  compact text rendering)
- Relationship to `tsn run` as the primary execution
  surface

### 2.2 Out of Scope

- Workflow IR semantics (system specification)
- Kernel evaluation, replay, or journaling rules (kernel
  specification)
- Compiler lowering or code generation (compiler
  specification)
- Configuration descriptor model (config specification)
- CLI command dispatch, flag parsing, or help generation
  (CLI specification)
- Transport protocols (transport specification)
- Scoped effects and middleware semantics (scoped effects
  specification)
- Implementation source code analysis or indexing
- CI pipeline configuration
- Editor or IDE integration
- Hosted query services or databases

### 2.3 Relationship to Other Specifications

This specification complements the system specification. It
does not amend, depend on, or extend the kernel, compiler,
config, or runtime specifications.

This specification depends on the CLI specification's
`tsn run` execution model: production workflows defined by
this specification are invoked through `tsn run` using the
standard workflow descriptor, invocation input, and module
loading mechanisms defined in the CLI specification.

This specification does not define new CLI commands. It does
not amend the CLI specification's command surface.

---

## 3. Terminology

**Canonical corpus.** The complete set of structured
specification and test-plan modules authored in the
`tisyn_spec` tagged data domain. The canonical corpus is the
source of truth for normative content.

**Canonical source.** A TypeScript module that exports a
`SpecModule` or `TestPlanModule` value constructed via
`@tisyn/spec` constructors. Canonical source lives in
`corpus/<id>/spec.ts` or `corpus/<id>/test-plan.ts` by
convention.

**Corpus module.** A single `SpecModule` or `TestPlanModule`
value. Corpus modules are the atomic units of the canonical
corpus.

**Corpus manifest.** A static declaration of all corpus
modules registered for acquisition. The manifest is the
canonical source of which modules exist in the corpus. It
is maintained explicitly — it is not derived from directory
scanning.

**Normalized corpus module.** A corpus module that has passed
normalization. Normalization validates structural integrity,
computes a deterministic hash, and timestamps the result.
`NormalizedSpecModule` and `NormalizedTestPlanModule` are the
normalized forms.

**Corpus registry.** A `CorpusRegistry` value built from an
array of normalized corpus modules. The registry provides
cross-spec indices and the relationship graph. It is derived
data, not canonical source. A registry is always
scope-annotated: it records whether it was built from the
full corpus or a filtered subset.

**Acquisition.** The effectful operation that loads canonical
source from the corpus manifest, normalizes it, and builds
the corpus registry. Acquisition crosses the boundary
between wherever the corpus lives and the in-memory
workflow context. Acquisition accepts an optional scope
parameter controlling which modules from the manifest are
loaded.

**Acquisition scope.** The set of corpus modules targeted by
an acquisition operation. The default scope is the entire
manifest. A filtered scope names specific spec ids;
companion test plans for the named specs are included
automatically.

**Auxiliary acquisition.** Effectful operations that load
non-registry inputs — frozen fixtures, committed emitted
Markdown, or other comparison targets. Auxiliary inputs are
not folded into the corpus registry.

**Scope-safe query.** A query whose result is correct and
complete for the queried entity regardless of whether the
registry was acquired with full or filtered scope.

**Scope-relative query.** A query whose result is valid for
the acquired scope but may be incomplete relative to the full
corpus. The consumer MUST NOT interpret the result as
exhaustive unless the registry's scope is full.

**Full-corpus-recommended query.** A query that executes on
any scope but SHOULD normally run on full scope because
filtered scope can hide cross-spec findings or produce
misleading results.

**Producer-oriented query.** A query optimized for the
workflow of reading specifications in order to create, amend,
review, or connect other specifications.

**Maintenance-oriented query.** A query optimized for corpus
health: coverage completeness, consistency checking,
readiness assessment, and structural validation.

**Context assembly.** A pure function that composes multiple
primitive queries into a task-specific typed context bundle.
Context assembly is an internal step used by production
workflows.

**Projection query.** A query that produces a compact,
purpose-specific view of the corpus — such as a discovery
pack or constraint document — by composing analysis and
listing queries.

**Discovery pack.** A token-efficient summary of the corpus.
The canonical form is the typed `DiscoveryPack` value.
Compact text rendering is a derived projection of the
canonical typed form. A discovery pack SHOULD be generated
from a full-scope registry.

**Emitted artifact.** A Markdown file generated by rendering
a normalized corpus module. Emitted artifacts are derived
projections. They are NOT canonical source.

**Implementation-alignment input.** A companion test plan
that links normative rules to concrete test cases via a
coverage matrix. Implementation alignment is checked by
comparing rules against coverage entries, not by analyzing
implementation source code.

---

## 4. Data Model

### 4.1 Tagged Data Domain

The specification system uses the `tisyn_spec` discriminant
to identify its data nodes. Spec data and IR data are
disjoint domains: spec nodes use `tisyn_spec`; IR nodes use
`tisyn`. A single object MUST NOT carry both fields.

### 4.2 Serializable Data Domain

All values in a corpus module MUST belong to the portable
serializable data domain defined by the configuration
specification §3.1: `null`, `boolean`, finite `number`,
`string`, plain objects, and arrays thereof. No `undefined`,
`Date`, `Symbol`, functions, class instances, or circular
references.

### 4.3 SpecModule

A specification. The primary canonical entity.

```typescript
interface SpecModule {
  readonly tisyn_spec: "spec";
  readonly id: string;
  readonly title: string;
  readonly status: "draft" | "active" | "superseded";
  readonly relationships: readonly Relationship[];
  readonly sections: readonly Section[];
  readonly openQuestions?: readonly OpenQuestion[];
  readonly implementationPackage?: string;
}
```

**D1.** `id` MUST be non-empty and MUST match
`[a-z][a-z0-9-]*`.

**D2.** `id` MUST be unique across the corpus.

**D3.** `sections` MUST contain at least one element.

**D4.** If `status` is `"superseded"`, the module SHOULD
include a relationship of type `"superseded-by"`.

### 4.4 Section

A numbered or unnumbered division of a spec.

```typescript
interface Section {
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
```

**D5.** `id` MUST be unique within the containing spec,
including across nesting levels.

**D6.** `title` MUST be non-empty.

**D7.** If `id` is a number, the section renders with a
numeric prefix (§N). If `id` is a string, the section
renders as an unnumbered heading.

### 4.5 Rule

A single normative requirement. The atomic unit of normative
content.

```typescript
interface Rule {
  readonly id: string;
  readonly level: "must" | "must-not" | "should"
    | "should-not" | "may";
  readonly text: string;
}
```

**D8.** `id` MUST be non-empty and MUST be unique within the
containing spec.

**D9.** `level` MUST be one of the five RFC 2119 levels.

### 4.6 TermDefinition

A term with a canonical definition.

```typescript
interface TermDefinition {
  readonly term: string;
  readonly definition: string;
}
```

**D10.** `term` MUST be non-empty.

**D11.** A spec MUST NOT define the same term twice.

### 4.7 Relationship

A typed directed edge from one spec to another.

```typescript
interface Relationship {
  readonly type: "complements" | "depends-on" | "amends"
    | "extends" | "implements" | "superseded-by";
  readonly target: string;
  readonly qualifier?: string;
}
```

**D12.** `target` MUST be a non-empty string. Whether the
target resolves to an existing spec in the corpus is
validated by the analysis layer (`findStaleReferences`),
not at construction or normalization time. A spec MAY
declare a relationship to a spec that is not yet in the
structured corpus.

### 4.8 OpenQuestion

A deferred design question.

```typescript
interface OpenQuestion {
  readonly id: string;
  readonly text: string;
  readonly status: "open" | "resolved" | "deferred";
  readonly blocksTarget?: string;
  readonly resolvedIn?: string;
}
```

**D13.** `id` MUST be non-empty and MUST be unique within
the containing spec.

**D14.** If `status` is `"resolved"`, `resolvedIn` SHOULD be
present.

### 4.9 ErrorCode

A diagnostic code.

```typescript
interface ErrorCode {
  readonly code: string;
  readonly trigger: string;
  readonly requiredContent?: string;
}
```

**D15.** `code` MUST be non-empty.

### 4.10 ConceptExport

A concept exported for cross-spec use.

```typescript
interface ConceptExport {
  readonly name: string;
  readonly description: string;
}
```

**D16.** `name` MUST be non-empty.

### 4.11 InvariantDeclaration

A named invariant.

```typescript
interface InvariantDeclaration {
  readonly id: string;
  readonly text: string;
}
```

**D17.** `id` MUST be non-empty.

### 4.12 TestPlanModule

A companion test plan for a spec.

```typescript
interface TestPlanModule {
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
```

**D18.** `id` MUST be non-empty, unique across the corpus,
and MUST match `[a-z][a-z0-9-]*`.

**D19.** `validatesSpec` MUST be a non-empty string. Whether
it resolves to an existing spec is validated by the
analysis layer.

**D20.** `categoriesSectionId` MUST reference an `id` in
`sections`.

### 4.13 TestPlanSection

A prose section of a test plan.

```typescript
interface TestPlanSection {
  readonly id: string | number;
  readonly title: string;
  readonly number?: number;
  readonly prose: string;
  readonly subsections?: readonly TestPlanSection[];
  readonly precedingDivider?: boolean;
}
```

**D21.** `id` MUST be unique within the containing test plan.

**D22.** `title` MUST be non-empty.

### 4.14 TestCategory

A group of test cases.

```typescript
interface TestCategory {
  readonly id: string;
  readonly title: string;
  readonly notes?: string;
  readonly cases: readonly TestCase[];
}
```

**D23.** `id` MUST be non-empty and MUST be unique within the
containing test plan.

### 4.15 TestCase

A single test assertion.

```typescript
interface TestCase {
  readonly id: string;
  readonly priority: "p0" | "p1" | "deferred";
  readonly type: "unit" | "integration" | "e2e";
  readonly specRef: string;
  readonly assertion: string;
}
```

**D24.** `id` MUST be non-empty.

### 4.16 CoverageEntry

A row in the coverage matrix linking a rule to its test
cases.

```typescript
interface CoverageEntry {
  readonly rule: string;
  readonly testIds: readonly string[];
  readonly status: "covered" | "uncovered" | "deferred";
}
```

**D25.** `rule` MUST reference a rule id in the spec named
by `validatesSpec`.

**D26.** Every entry in `testIds` MUST reference a test case
id in this test plan.

**D27.** If `testIds` is non-empty, `status` MUST be
`"covered"`. If `testIds` is empty and `status` is
`"covered"`, normalization MUST reject the module.

---

## 5. Normalization

### 5.1 Normalization Functions

```typescript
function normalizeSpec(module: SpecModule):
  NormalizeResult<NormalizedSpecModule>;
function normalizeTestPlan(module: TestPlanModule):
  NormalizeResult<NormalizedTestPlanModule>;
```

`NormalizeResult<T>` is a discriminated union:

```typescript
type NormalizeResult<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "error";
      readonly errors: readonly NormalizationError[] };
```

Normalization MUST NOT throw on structural failure. It MUST
return an error result.

### 5.2 Normalized Module Shape

```typescript
interface NormalizedSpecModule extends SpecModule {
  readonly _hash: string;
  readonly _normalizedAt: string;
}

interface NormalizedTestPlanModule extends TestPlanModule {
  readonly _hash: string;
  readonly _normalizedAt: string;
}
```

**N1.** `_hash` MUST be a deterministic SHA-256 hash of the
canonical JSON representation of the module, computed
before the `_hash` and `_normalizedAt` fields are added.

**N2.** `_normalizedAt` MUST be an ISO 8601 timestamp.

### 5.3 Structural Validation Rules

Normalization MUST reject a module that violates any of the
following rules:

**V1.** Every node MUST have a `tisyn_spec` field with a
recognized value (`"spec"` or `"test-plan"`).

**V2.** All id fields referenced by D1, D5, D8, D13, D15,
D16, D17, D18, D21, D23, D24 MUST be non-empty.

**V3.** All uniqueness constraints (D2 within corpus, D5
within spec, D8 within spec, D11 within spec, D13 within
spec, D21 within plan, D23 within plan) MUST be
satisfied. For D2, normalization validates uniqueness
within the module; cross-module uniqueness is validated
by the registry.

**V4.** `CoverageEntry` status consistency (D27) MUST hold.

**V5.** `categoriesSectionId` (D20) MUST resolve to an
existing section id in the test plan's `sections`.

**V6.** All required fields defined by the interfaces in
§4 MUST be present with the correct type.

**V7.** All title fields MUST be non-empty (D6, D22).

**V8.** Section ids MUST be either a finite number or a
non-empty string (D5, D7).

**V9.** `status` fields MUST be one of their declared enum
values.

---

## 6. Corpus Registry

### 6.1 Registry Shape

```typescript
interface CorpusRegistry {
  readonly specs:
    ReadonlyMap<string, NormalizedSpecModule>;
  readonly plans:
    ReadonlyMap<string, NormalizedTestPlanModule>;
  readonly ruleIndex:
    ReadonlyMap<string, RuleLocation>;
  readonly termIndex:
    ReadonlyMap<string, TermLocation>;
  readonly conceptIndex:
    ReadonlyMap<string, ConceptLocation>;
  readonly errorCodeIndex:
    ReadonlyMap<string, ErrorCodeLocation>;
  readonly openQuestionIndex:
    ReadonlyMap<string, OpenQuestionLocation>;
  readonly edges:
    readonly RelationshipEdge[];
  readonly dependencyOrder:
    readonly string[];
  readonly scope:
    | { readonly kind: "full" }
    | { readonly kind: "filtered";
        readonly specIds: readonly string[] };
}
```

`scope` records whether the registry was built from the full
corpus or a filtered subset. Downstream consumers inspect
this field to determine whether scope-relative query results
(§8.8) represent full-corpus truth or a partial view.

**Location types** carry the entity and its position:

```typescript
interface RuleLocation {
  readonly specId: string;
  readonly sectionId: string | number;
  readonly rule: Rule;
}

interface TermLocation {
  readonly specId: string;
  readonly sectionId: string | number;
  readonly definition: TermDefinition;
}
```

`ConceptLocation`, `ErrorCodeLocation`, and
`OpenQuestionLocation` follow the same shape with their
respective entity types.

```typescript
interface RelationshipEdge {
  readonly source: string;
  readonly target: string;
  readonly type: Relationship["type"];
  readonly qualifier?: string;
}
```

### 6.2 Registry Construction

```typescript
function buildRegistry(
  modules: readonly (
    NormalizedSpecModule | NormalizedTestPlanModule
  )[],
  scope:
    | { readonly kind: "full" }
    | { readonly kind: "filtered";
        readonly specIds: readonly string[] }
): CorpusRegistry;
```

`buildRegistry` is a pure function. It MUST NOT perform I/O.

**R1.** Every `NormalizedSpecModule` in the input MUST appear
in `registry.specs`, keyed by its `id`.

**R2.** Every `NormalizedTestPlanModule` in the input MUST
appear in `registry.plans`, keyed by its `id`.

**R3.** Every `Rule` in every spec MUST appear in
`registry.ruleIndex`. If two specs define the same rule id,
the rule from the spec that appears first in
`dependencyOrder` takes precedence in the index. The
duplicate is still detectable via `findDuplicateRules`.

**R4.** The same precedence rule applies to
`termIndex`, `conceptIndex`, `errorCodeIndex`, and
`openQuestionIndex`.

**R5.** `registry.edges` MUST contain one
`RelationshipEdge` for every `Relationship` in every
spec's `relationships` array. Only edges whose `source` is
an in-scope spec are included. Edges from out-of-scope
specs are excluded even if their `target` is in scope.

**R6.** `registry.dependencyOrder` MUST be a topological
sort of all in-scope spec ids based on `depends-on` and
`amends` edges. If cycles exist within the in-scope
subset, the order MUST be a best-effort partial order.

**R7.** `registry.scope` MUST equal the `scope` parameter
passed to `buildRegistry`.

### 6.3 Registry Invariants

**RI1.** The registry is immutable after construction. No
field, map entry, array element, or nested object may be
mutated after `buildRegistry` returns.

**RI2.** The registry is complete for its input. Every
entity in every input module is indexed. No entity is
silently omitted.

**RI3.** Unresolved relationship targets are permitted.
A spec MAY declare a relationship whose `target` does not
appear as a key in `registry.specs`. This is a
corpus-level finding, not a construction failure. The
analysis query `findStaleReferences` detects unresolved
targets.

**RI4.** `registry.scope` accurately reflects the scope
used for construction. If `scope.kind` is `"full"`, the
registry contains the entire registered corpus. If
`scope.kind` is `"filtered"`, the registry contains
exactly the requested spec ids and their companion plans.

---

## 7. Corpus Acquisition

### 7.1 Primary Acquisition Operation

```typescript
interface AcquisitionScope {
  readonly specIds?: readonly string[];
}

function* acquireCorpusRegistry(
  scope?: AcquisitionScope
): Operation<CorpusRegistry>;
```

This is the effectful boundary between the corpus and the
workflow. It acquires corpus state from outside the current
in-memory workflow context.

If `scope.specIds` is provided, only the named specs and
their companion test plans (matched by `validatesSpec`)
are loaded, normalized, and indexed. If `scope` is
omitted or `scope.specIds` is omitted, the entire
registered corpus is acquired.

### 7.2 What Acquisition Returns

On success, the operation returns a `CorpusRegistry`
containing:

- every `NormalizedSpecModule` in the requested scope
- every `NormalizedTestPlanModule` whose `validatesSpec`
  names an in-scope spec
- all derived indices (rule, term, concept, error-code,
  open-question) for the in-scope modules
- relationship edges whose source is in scope
- the precomputed dependency order for in-scope specs
- the scope annotation (`registry.scope`)

The registry does NOT contain emitted Markdown, frozen
fixtures, or implementation source.

### 7.3 Manifest-Based Discovery

Acquisition MUST discover available corpus modules from a
static corpus manifest. The manifest is an explicit
declaration of all registered corpus modules — their ids
and the locations of their canonical source.

The acquisition operation MUST NOT use directory scanning
as the primary discovery mechanism. Directory scanning
introduces implicit module discovery that can silently
include or exclude modules without explicit registration.

The manifest is maintained explicitly. Adding a new spec
to the corpus requires adding an entry to the manifest.
The exact form of the manifest (a TypeScript import list,
a JSON file, or a programmatic registration) is
implementation-determined. The requirement is that the set
of modules known to the acquisition operation is
statically declared, not dynamically discovered.

Maintaining or regenerating the manifest is a separate
maintenance concern outside the acquisition contract
itself. A tool MAY exist to regenerate the manifest from
the current state of `corpus/`, but that tool is not part
of the acquisition operation — it produces the manifest
that acquisition consumes.

### 7.4 Success Guarantees

On successful return, the following properties hold:

**A1 — Scope-complete.** Every corpus module in the
requested scope that is registered in the manifest is
present. No registered in-scope module is silently
omitted. If no scope was specified, the requested scope is
the entire manifest.

**A2 — Normalized.** Every module has passed normalization
(V1–V9). Every module has a deterministic `_hash`.

**A3 — Indexed.** Registry invariants RI1–RI4 hold.

**A4 — Immutable.** The returned registry is a frozen
snapshot. It MUST NOT be mutated after return.

**A5 — Snapshot-stable.** The registry represents the
corpus state at the time of acquisition. Changes to
backing source during the workflow's execution are not
reflected.

**A6 — Edges present, targets not guaranteed.** Relationship
edges from in-scope specs are present in `registry.edges`.
Target specs MAY be absent from `registry.specs` — either
because they do not exist in the corpus or because they
are out of scope. Absent targets are detected by
`findStaleReferences`, not by acquisition.

**A7 — Scope-annotated.** The returned registry carries the
requested scope as metadata in `registry.scope`. If the
full manifest was acquired, `scope.kind` is `"full"`. If a
filtered scope was requested, `scope.kind` is `"filtered"`
and `scope.specIds` lists the requested ids.

### 7.5 Failure Model

Acquisition is all-or-nothing. If any module in the
requested scope fails, the operation MUST raise an error.
It MUST NOT return a partial registry.

Three failure kinds:

**F1 — Normalization failure.** A module fails structural
validation (V1–V9). The error MUST identify the module
and the specific validation errors.

**F2 — Source unavailable.** A module registered in the
manifest cannot be loaded. The error MUST identify the
module and the reason.

**F3 — Duplicate ID.** Two modules in the requested scope
share the same `id`. The error MUST identify both modules.

The following are NOT acquisition failures:

- Unresolved relationship targets (corpus-level finding;
  detected by `findStaleReferences`)
- Uncovered rules (coverage finding; detected by
  `checkCoverage`)
- Open questions with status `"open"` (normative content)
- Specs with status `"superseded"` (load normally)

### 7.6 Lifecycle

**L1.** The expected usage is one
`acquireCorpusRegistry()` call near the top of a workflow
body.

**L2.** The returned registry SHOULD be passed as a
parameter to all subsequent pure functions and
subworkflows. Subworkflows SHOULD NOT re-acquire.

**L3.** Re-acquisition within the same workflow is
permitted but discouraged. Two snapshots within one
workflow risk inconsistent analysis.

**L4.** The registry does not outlive the workflow. Each
workflow run acquires its own registry.

### 7.7 Auxiliary Acquisition

Two auxiliary operations acquire non-registry comparison
inputs:

```typescript
function* acquireFixture(
  specId: string,
  kind: "spec" | "plan"
): Operation<string>;

function* acquireEmittedMarkdown(
  specId: string,
  kind: "spec" | "plan"
): Operation<string>;
```

These return raw Markdown text. They are effectful and
generator-based.

**AX1.** Auxiliary inputs MUST NOT be folded into the
corpus registry. They are comparison targets, not
canonical source.

**AX2.** `acquireFixture` returns frozen pre-migration
Markdown used as a structural comparison oracle.

**AX3.** `acquireEmittedMarkdown` returns the committed
generated Markdown from `specs/`.

---

## 8. Query Contract

### 8.1 General Properties

All queries defined in this section are pure functions.

**Q1.** Every query takes `CorpusRegistry` as its first
argument.

**Q2.** No query MUST perform I/O, acquire external state,
or produce side effects.

**Q3.** No query MUST throw on no-match. Queries return
`undefined` or empty arrays when no result is found.

**Q4.** Queries are deterministic. Given the same registry
and the same input, a query MUST return the same output.

**Q5.** Queries compose by passing return values as inputs
to subsequent queries.

**Q6 — Scope transparency.** Queries operate on the
registry as given. They do not distinguish between
full-scope and filtered-scope registries at runtime.
No query refuses to execute or changes its algorithm
based on `registry.scope`. The scope classification in
§8.8 is guidance for workflow authors and consumers, not
runtime behavior.

### 8.2 Design Principle

The query layer is optimized for reading specifications in
order to create, amend, review, and connect other
specifications. Producer-oriented queries are prioritized
over maintenance-oriented queries.

The system SHOULD prioritize capabilities that support:

- locating surrounding semantic context for a target spec
  or topic
- finding dependencies and dependents of a target spec
- locating terms and detecting conflicting uses
- locating relevant normative rules by spec or by keyword
- generating compact task-specific context for spec
  sessions
- finding adjacent specs that define precedent patterns
- linking test-plan coverage to normative rules

### 8.3 Lookup Queries

Lookup queries find a specific entity by identifier.

```typescript
function findSpec(
  registry: CorpusRegistry,
  specId: string
): NormalizedSpecModule | undefined;
```

Returns the normalized spec with the given id, or
`undefined` if not found.

```typescript
function findRule(
  registry: CorpusRegistry,
  ruleId: string
): RuleLocation | undefined;
```

Searches `registry.ruleIndex`. Returns the rule with its
spec and section context, or `undefined`. If two specs
define the same rule id, returns the entry from the
index (first in dependency order per R3).

```typescript
function findTerm(
  registry: CorpusRegistry,
  term: string
): TermLocation | undefined;
```

Searches `registry.termIndex`. Exact match,
case-sensitive.

```typescript
function findTestCase(
  registry: CorpusRegistry,
  testId: string
): TestCaseLocation | undefined;
```

```typescript
interface TestCaseLocation {
  readonly planId: string;
  readonly categoryId: string;
  readonly testCase: TestCase;
}
```

```typescript
function findErrorCode(
  registry: CorpusRegistry,
  code: string
): ErrorCodeLocation | undefined;

function findOpenQuestion(
  registry: CorpusRegistry,
  oqId: string
): OpenQuestionLocation | undefined;
```

### 8.4 Listing Queries

Listing queries enumerate entities within or across specs.

```typescript
function listRules(
  registry: CorpusRegistry,
  specId: string
): readonly RuleLocation[];
```

Returns all rules in the named spec, in section order.
Returns an empty array if the spec is not found or has
no rules.

```typescript
function listRulesByLevel(
  registry: CorpusRegistry,
  level: Rule["level"]
): readonly RuleLocation[];
```

Returns all rules at the given level across all in-scope
specs.

```typescript
function listDependencies(
  registry: CorpusRegistry,
  specId: string
): readonly DependencyEntry[];
```

```typescript
interface DependencyEntry {
  readonly specId: string;
  readonly relationship: Relationship;
}
```

Returns all specs that the given spec depends on, amends,
or complements — as declared by its `relationships` field.
Because dependencies are metadata on the spec itself, this
query returns the full declared list regardless of whether
the targets are in scope.

```typescript
function listDependents(
  registry: CorpusRegistry,
  targetSpecId: string
): readonly DependentEntry[];
```

```typescript
interface DependentEntry {
  readonly specId: string;
  readonly relationship: Relationship;
}
```

Returns all in-scope specs whose relationships name the
given spec as target. On filtered scope, out-of-scope
dependents are not returned (§8.8).

```typescript
function listOpenQuestions(
  registry: CorpusRegistry,
  filter?: {
    status?: OpenQuestion["status"];
    blocksTarget?: string;
  }
): readonly OpenQuestionLocation[];

function listTerms(
  registry: CorpusRegistry
): readonly TermLocation[];

function listErrorCodes(
  registry: CorpusRegistry
): readonly ErrorCodeLocation[];
```

### 8.5 Relationship Queries

```typescript
function impactOf(
  registry: CorpusRegistry,
  specId: string,
  sectionId?: string | number
): readonly ImpactEntry[];
```

```typescript
interface ImpactEntry {
  readonly specId: string;
  readonly relationship: Relationship;
  readonly referencedSection?: string | number;
  readonly impactType:
    | "depends-on"
    | "amends"
    | "test-references"
    | "prose-references";
}
```

Returns in-scope specs affected by changes to the target.
Includes direct dependents, specs whose test plans
reference rules in the target, and specs whose prose
contains §-references to the target's sections. On
filtered scope, impact from out-of-scope specs is not
returned (§8.8).

### 8.5.1 Cross-Spec References

`impactOf` and `findStaleReferences` detect cross-spec
§-references by pattern-matching `§N` and `§N.M` forms in
section prose text.

Cross-spec references SHOULD move toward typed canonical
references. Future versions of this specification MAY
introduce a typed reference form (e.g., a `SectionRef`
constructor) that is validated at normalization time rather
than detected by prose pattern-matching at query time.

In the current version, prose pattern-matching is the
primary detection mechanism. Implementations SHOULD
structure their reference-detection logic so that it can
be replaced by typed-reference resolution without
changing the query interfaces.

```typescript
function transitiveDependencies(
  registry: CorpusRegistry,
  specId: string
): readonly string[];

function dependencyOrder(
  registry: CorpusRegistry
): readonly string[];

function hasCycles(
  registry: CorpusRegistry
): boolean;
```

### 8.6 Analysis Queries

Analysis queries compute derived findings.

```typescript
function checkCoverage(
  registry: CorpusRegistry,
  specId: string
): CoverageResult;
```

```typescript
interface CoverageResult {
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

interface CoveredRule {
  readonly rule: Rule;
  readonly sectionId: string | number;
  readonly testIds: readonly string[];
}

interface UncoveredRule {
  readonly rule: Rule;
  readonly sectionId: string | number;
}

interface DeferredRule {
  readonly rule: Rule;
  readonly sectionId: string | number;
  readonly reason: string;
}
```

If no companion test plan exists, `companionPlanId` is
`undefined` and all rules appear as uncovered.

```typescript
function isReady(
  registry: CorpusRegistry,
  specId: string
): ReadinessResult;
```

```typescript
interface ReadinessResult {
  readonly specId: string;
  readonly ready: boolean;
  readonly blocking: readonly string[];
}
```

A spec is ready when all of the following hold:

1. `status` is `"active"`
2. A companion test plan exists with `validatesSpec`
   matching this spec's `id`
3. `checkCoverage` reports zero uncovered rules at
   level `"must"` or `"must-not"`
4. Zero `OpenQuestion` entries with `status` `"open"`
   exist in this spec

`blocking` enumerates the specific conditions that are
not satisfied.

```typescript
function findTermConflicts(
  registry: CorpusRegistry
): readonly TermConflict[];
```

```typescript
interface TermConflict {
  readonly term: string;
  readonly definitions: readonly TermLocation[];
}
```

Returns terms defined in two or more in-scope specs with
different definition text. On filtered scope, conflicts
with out-of-scope specs are not detected (§8.8).

```typescript
function findStaleReferences(
  registry: CorpusRegistry
): readonly StaleReference[];
```

```typescript
interface StaleReference {
  readonly sourceSpecId: string;
  readonly referencedSpecId: string;
  readonly referencedSection?: string;
  readonly problem:
    | "missing-spec"
    | "missing-section"
    | "superseded-spec";
}
```

Checks: relationship `target` values that do not resolve
to specs in the registry; §-references in prose pointing
to missing sections; dependencies on superseded specs.

On filtered scope, a target spec that exists in the full
corpus but is excluded from the filtered scope is reported
as `"missing-spec"`. This is a false positive — the target
is not missing, only out of scope. Consumers MUST account
for this when using `findStaleReferences` on filtered-scope
registries (§8.8).

```typescript
function findErrorCodeCollisions(
  registry: CorpusRegistry
): readonly ErrorCodeCollision[];
```

```typescript
interface ErrorCodeCollision {
  readonly code: string;
  readonly locations: readonly ErrorCodeLocation[];
}
```

Returns error codes defined in two or more in-scope specs.

```typescript
function findDuplicateRules(
  registry: CorpusRegistry
): readonly DuplicateRule[];
```

```typescript
interface DuplicateRule {
  readonly ruleId: string;
  readonly locations: readonly RuleLocation[];
}
```

Returns rule ids appearing in two or more in-scope specs.

### 8.7 Projection Queries

Projection queries produce compact purpose-specific views.

```typescript
function generateDiscoveryPack(
  registry: CorpusRegistry
): DiscoveryPack;
```

```typescript
interface DiscoveryPack {
  readonly generatedAt: string;
  readonly specCount: number;
  readonly scopeKind: "full" | "filtered";
  readonly specs: readonly DiscoveryPackSpec[];
  readonly terms: readonly DiscoveryPackTerm[];
  readonly openQuestions: readonly DiscoveryPackOQ[];
  readonly consistency: DiscoveryPackConsistency;
}

interface DiscoveryPackSpec {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly implementationPackage?: string;
  readonly relationships: readonly Relationship[];
  readonly ruleCount: number;
  readonly coverage: {
    total: number;
    covered: number;
    uncovered: number;
  };
  readonly ready: boolean;
}

interface DiscoveryPackTerm {
  readonly term: string;
  readonly specId: string;
  readonly definition: string;
}

interface DiscoveryPackOQ {
  readonly id: string;
  readonly specId: string;
  readonly status: string;
  readonly blocksTarget?: string;
}

interface DiscoveryPackConsistency {
  readonly staleReferences: number;
  readonly termConflicts: number;
  readonly errorCodeCollisions: number;
  readonly duplicateRules: number;
  readonly cycles: boolean;
}
```

`generateDiscoveryPack` MUST return the typed canonical
`DiscoveryPack` value. This typed form is the canonical
representation of the discovery pack.

Implementations MAY provide a compact text rendering of the
discovery pack as a derived projection for token-efficient
consumption by agents or LLMs. Compact text rendering MUST
NOT be treated as canonical corpus state — it is a derived
view of the typed `DiscoveryPack`.

`generateDiscoveryPack` internally calls `checkCoverage`,
`isReady`, `findTermConflicts`, `findStaleReferences`,
`findErrorCodeCollisions`, `findDuplicateRules`, and
`hasCycles`. It MUST be deterministic over the registry.

The `scopeKind` field reflects `registry.scope.kind` so
that consumers of the pack know whether it represents the
full corpus or a filtered subset.

```typescript
function generateConstraintDocument(
  registry: CorpusRegistry,
  targetSpecId: string
): ConstraintDocument;
```

```typescript
interface ConstraintDocument {
  readonly targetSpecId: string;
  readonly targetTitle: string;
  readonly scopeKind: "full" | "filtered";
  readonly upstreamDependencies:
    readonly DependencyEntry[];
  readonly downstreamDependents:
    readonly DependentEntry[];
  readonly exportedConcepts:
    readonly ConceptExport[];
  readonly definedTerms:
    readonly TermDefinition[];
  readonly openQuestions:
    readonly OpenQuestion[];
  readonly ruleCount: number;
  readonly coverageStatus: CoverageResult;
}
```

Produces the constraint document required by the spec
writing process before normative drafting.
`upstreamDependencies` reflects the spec's own declared
relationships and is complete regardless of scope.
`downstreamDependents` reflects only in-scope dependents;
when `scopeKind` is `"filtered"`, consumers SHOULD treat
it as a lower bound.

```typescript
function generateTaskContext(
  registry: CorpusRegistry,
  query: TaskContextQuery
): TaskContext;
```

```typescript
interface TaskContextQuery {
  readonly specIds?: readonly string[];
  readonly rulePattern?: string;
  readonly termPattern?: string;
  readonly includeRelated?: boolean;
  readonly maxTokens?: number;
}

interface TaskContext {
  readonly scopeKind: "full" | "filtered";
  readonly relevantSpecs: readonly DiscoveryPackSpec[];
  readonly matchingRules: readonly RuleLocation[];
  readonly matchingTerms: readonly TermLocation[];
  readonly relatedOpenQuestions:
    readonly OpenQuestionLocation[];
  readonly tokenEstimate: number;
}
```

At least one of `specIds`, `rulePattern`, or
`termPattern` MUST be provided. `rulePattern` and
`termPattern` are matched as case-insensitive substrings.
If `includeRelated` is `true`, specs connected by
relationship edges to named specs are included — from
within the acquired scope only.

### 8.8 Scope Classification

Queries and analyses are classified by their behavior on
filtered-scope registries.

**Scope-safe.** The result is correct and complete for the
queried entity regardless of scope. These queries produce
valid results on any registry.

Scope-safe queries: `findSpec`, `findRule`, `findTerm`,
`findTestCase`, `findErrorCode`, `findOpenQuestion`,
`listRules`, `listRulesByLevel`, `listDependencies`,
`checkCoverage`, `isReady`.

**Scope-relative.** The result is correct for the acquired
scope but may be incomplete relative to the full corpus.
The consumer MUST NOT interpret the result as exhaustive
unless `registry.scope.kind` is `"full"`.

Scope-relative queries: `listDependents`, `impactOf`,
`generateTaskContext`, `generateConstraintDocument`
(specifically the `downstreamDependents` field).

**Full-corpus-recommended.** The query executes on any
scope but SHOULD normally run on full scope because
filtered scope can hide cross-spec findings or produce
misleading results.

Full-corpus-recommended queries: `findTermConflicts`,
`findDuplicateRules`, `findErrorCodeCollisions`,
`findStaleReferences`, `hasCycles`, `dependencyOrder`,
`generateDiscoveryPack`.

Filtered scope risks for full-corpus-recommended queries:

- `findTermConflicts`, `findDuplicateRules`,
  `findErrorCodeCollisions`: hidden conflicts — collisions
  with out-of-scope specs are invisible (false negatives).
- `findStaleReferences`: false positives — targets that
  exist in the full corpus but are out of scope are
  reported as `"missing-spec"`.
- `hasCycles`: hidden cycles — cycles passing through
  out-of-scope specs are undetectable.
- `generateDiscoveryPack`: misleading completeness — the
  pack appears to summarize the corpus but covers only the
  filtered subset.

No query is scope-restricted. All queries execute on any
registry regardless of scope. This classification is
documented guidance for workflow authors and consumers,
not enforced runtime behavior (Q6).

---

## 9. Context Assembly

### 9.1 Contract

Context assembly functions compose primitive queries into
task-specific typed bundles.

**CA1.** Context assembly functions MUST NOT perform I/O
or acquire external state.

**CA2.** Context assembly functions MUST NOT mutate the
registry.

**CA3.** Context assembly functions are deterministic over
their inputs.

**CA4.** Context assembly functions are primarily internal
steps used by production workflows. They are not the
primary user-facing surface.

### 9.2 AuthoringContext

```typescript
interface AuthoringContext {
  readonly task: "authoring";
  readonly scopeKind: "full" | "filtered";
  readonly targetSpec?: string;
  readonly topic?: string;
  readonly relevantSpecs: readonly DiscoveryPackSpec[];
  readonly rules: readonly RuleLocation[];
  readonly terms: readonly TermLocation[];
  readonly openQuestions:
    readonly OpenQuestionLocation[];
  readonly constraints?: ConstraintDocument;
  readonly tokenEstimate: number;
}
```

Assembles context for starting a new spec or major
revision. If `targetSpec` is provided and exists in the
registry, includes a constraint document. `scopeKind`
reflects the underlying registry scope.

### 9.3 AmendmentContext

```typescript
interface AmendmentContext {
  readonly task: "amendment";
  readonly scopeKind: "full" | "filtered";
  readonly targetSpec: string;
  readonly targetSection?: string | number;
  readonly constraints: ConstraintDocument;
  readonly impact: readonly ImpactEntry[];
  readonly dependencies: readonly DependencyEntry[];
  readonly dependents: readonly DependentEntry[];
  readonly currentCoverage: CoverageResult;
  readonly blockingQuestions:
    readonly OpenQuestionLocation[];
}
```

Assembles the constraint surface, impact analysis, and
coverage status for a targeted amendment. When
`scopeKind` is `"filtered"`, `dependents` and `impact`
reflect only in-scope specs; the consumer SHOULD consider
full-scope acquisition for amendments to heavily-
referenced specs.

### 9.4 ReviewContext

```typescript
interface ReviewContext {
  readonly task: "review";
  readonly scopeKind: "full" | "filtered";
  readonly targetSpec: string;
  readonly dependencies: readonly DependencyEntry[];
  readonly dependents: readonly DependentEntry[];
  readonly terms: readonly TermLocation[];
  readonly corpusTermConflicts:
    readonly TermConflict[];
  readonly staleReferences:
    readonly StaleReference[];
  readonly coverage: CoverageResult;
  readonly readiness: ReadinessResult;
  readonly errorCodeConflicts:
    readonly ErrorCodeCollision[];
}
```

Assembles cross-spec constraints and consistency
findings for reviewing a spec draft.
`corpusTermConflicts`, `staleReferences`, and
`errorCodeConflicts` are full-corpus-recommended
queries; when `scopeKind` is `"filtered"`, these findings
may be incomplete.

### 9.5 TestPlanContext

```typescript
interface TestPlanContext {
  readonly task: "test-plan";
  readonly scopeKind: "full" | "filtered";
  readonly targetSpec: string;
  readonly mustRules: readonly RuleLocation[];
  readonly shouldRules: readonly RuleLocation[];
  readonly mayRules: readonly RuleLocation[];
  readonly totalRuleCount: number;
  readonly existingCoverage: CoverageResult;
  readonly siblingPlanIds: readonly string[];
  readonly openQuestions:
    readonly OpenQuestionLocation[];
}
```

Assembles the rule inventory by normative level and
sibling plan references for companion test-plan
authoring. `siblingPlanIds` lists only in-scope sibling
plans.

### 9.6 ConsistencyContext

```typescript
interface ConsistencyContext {
  readonly task: "consistency";
  readonly scopeKind: "full" | "filtered";
  readonly scope: string;
  readonly staleReferences:
    readonly StaleReference[];
  readonly termConflicts:
    readonly TermConflict[];
  readonly errorCodeCollisions:
    readonly ErrorCodeCollision[];
  readonly duplicateRules:
    readonly DuplicateRule[];
  readonly cycles: boolean;
  readonly coverageSummary: readonly {
    specId: string;
    total: number;
    covered: number;
    uncovered: number;
    deferred: number;
  }[];
  readonly readinessSummary: readonly {
    specId: string;
    ready: boolean;
    blocking: readonly string[];
  }[];
}
```

Assembles the full corpus consistency report. This context
contains multiple full-corpus-recommended findings; the
`consistency-check` workflow SHOULD acquire with full
scope.

---

## 10. Workflow Contract

### 10.1 Production Workflow Pattern

Production workflows are the top-level runnable units,
invoked through `tsn run`.

**W1.** A production workflow MUST acquire the corpus
registry via `acquireCorpusRegistry()` as an effectful
step.

**W2.** A production workflow MUST use pure context assembly
functions for its analytical steps. Context assembly
MUST NOT be performed via agent dispatch.

**W3.** A production workflow MUST return a typed result.

**W4.** Agent dispatch (Claude, filesystem, output) is
optional. When present, it is secondary to the typed
return value.

### 10.2 Production Workflows

**`draft-spec`.** Acquires the registry, assembles an
`AuthoringContext`, and returns it — optionally with
agent-produced draft content. SHOULD use filtered scope
for the target area and related specs.

**`amend-spec`.** Acquires the registry, assembles an
`AmendmentContext`, and returns it — optionally with
agent-produced amendment content. SHOULD use filtered
scope including the target spec, its dependencies, and
known dependents.

**`review-spec`.** Acquires the registry, assembles a
`ReviewContext`, and returns it — optionally with an
agent-produced review verdict. SHOULD use full scope
because review depends on corpus-wide consistency
findings.

**`draft-test-plan`.** Acquires the registry, assembles a
`TestPlanContext`, and returns it — optionally with
agent-produced test-plan content. SHOULD use filtered
scope for the target spec and sibling specs.

### 10.3 Maintenance Workflows

**`verify-corpus`.** Acquires the registry (filtered to
target) and auxiliary inputs (fixtures, emitted Markdown).
Renders from structured source, compares against
comparison targets. Optionally dispatches to a review
agent. Returns pass/fail with comparison details.

**`consistency-check`.** Acquires the registry with full
scope. Assembles a `ConsistencyContext`. Returns the
report.

### 10.4 Invocation Model

All production and maintenance workflows are invoked
through `tsn run`:

```bash
tsn run packages/spec/workflows/amend-spec.ts \
  --spec tisyn-scoped-effects --section 3.1
```

Invocation inputs are derived from the workflow function's
parameter types through the standard `tsn run` input-schema
mechanism defined in the CLI specification.

This specification does NOT define new CLI commands.
This specification does NOT amend the CLI specification's
command surface.

---

## 11. Rendering

### 11.1 Rendering Functions

```typescript
function renderSpecMarkdown(
  spec: NormalizedSpecModule,
  options?: RenderSpecOptions
): string;

function renderTestPlanMarkdown(
  plan: NormalizedTestPlanModule,
  options?: RenderTestPlanOptions
): string;
```

**RD1.** Rendering functions are pure. They MUST NOT
perform I/O.

**RD2.** Rendering functions MUST be deterministic over
their inputs.

**RD3.** Rendered output is a derived projection. It is
NOT canonical source.

### 11.2 Structural Comparison

```typescript
function compareMarkdown(
  generated: string,
  reference: string
): CompareResult;
```

Compares titles, section headings, test IDs,
§-coverage references, and relationship lines as sets.

> NOTE — `compareMarkdown` is a coarse structural gate.
> Prose wording, H3 structure, divider placement, and
> table formatting are outside its scope. Prose-level
> equivalence requires semantic review.

### 11.3 Discovery Pack Rendering

Implementations MAY provide a compact text rendering of
the `DiscoveryPack` typed value for token-efficient
consumption by agents:

```typescript
function renderDiscoveryPackText(
  pack: DiscoveryPack
): string;
```

Compact text rendering is a derived projection. It MUST
NOT be treated as canonical corpus state. The canonical
form is the typed `DiscoveryPack` value returned by
`generateDiscoveryPack`.

---

## 12. Invariants

**I1.** Corpus acquisition is complete for the requested
scope, or the acquisition operation fails.

**I2.** A successfully acquired registry is an immutable
snapshot. No mutation after return.

**I3.** Pure query and context assembly functions do not
acquire external state. They operate only on the
`CorpusRegistry` passed as an argument.

**I4.** Context assembly does not mutate registry state.

**I5.** Auxiliary acquisition inputs (fixtures, emitted
Markdown) are never folded into the corpus registry.

**I6.** Producer-oriented projections are deterministic
over the acquired registry state.

**I7.** Emitted Markdown files are derived projections.
The canonical source is the structured corpus module.

**I8.** The `tisyn_spec` and `tisyn` tagged data domains
are disjoint. A single object MUST NOT carry both
discriminant fields.

**I9.** `registry.scope` accurately reflects the scope
used for acquisition. If `scope.kind` is `"full"`, the
registry contains the entire registered corpus. If
`scope.kind` is `"filtered"`, the registry contains
exactly the requested spec ids and their companion plans.

**I10.** Acquisition discovers corpus modules from the
static corpus manifest. The set of modules known to
the acquisition operation is explicitly declared, not
dynamically discovered.

**I11.** The typed `DiscoveryPack` value is the canonical
form of the discovery pack. Compact text renderings are
derived projections.

---

## 13. Non-Goals

**NG1.** This specification does not replace, amend, or
supersede the system, kernel, compiler, config, or CLI
specifications.

**NG2.** Emitted Markdown is NOT canonical source.

**NG3.** Scripts, npm wrappers, and CI pipeline
configuration are not first-class architectural surfaces.

**NG4.** This specification does not define a custom
`tsn spec` CLI command. Workflows are invoked through
`tsn run`.

**NG5.** Not all maintenance operations are required to
be workflows. Analysis queries are pure functions.
Whether a maintenance operation is exposed as a workflow
or via other means is an implementation choice.

**NG6.** Implementation source code is not embedded in or
indexed by the canonical corpus.

**NG7.** The system does not provide a query DSL or graph
query language. Queries are typed functions.

**NG8.** Directory scanning is not the canonical corpus
discovery mechanism. The corpus manifest is the
canonical declaration of registered modules.

---

## 14. Open Questions

**OQ1 — Typed cross-spec reference schema.** Cross-spec
§-references are currently detected by prose
pattern-matching (§8.5.1). The direction is toward typed
canonical references validated at normalization time.
The exact schema for typed references — whether section
refs are the only target kind, whether rule refs and
term refs should also be typed, and what constructor
syntax they use — is not yet specified. Implementations
SHOULD structure reference-detection logic so that it
can be replaced by typed-reference resolution without
changing the query interfaces.
