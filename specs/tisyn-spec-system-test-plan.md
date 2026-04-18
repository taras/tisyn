# Tisyn Specification System Test Plan

**Validates:** Tisyn Specification System Specification (v2)
**Style reference:** Tisyn CLI Test Plan, Tisyn Config Test Plan

---

## 1. Purpose

This document defines the conformance test plan for the
Tisyn Specification System Specification. An implementation
of `@tisyn/spec` proves conformance by passing all tests
marked **P0** (blocking). Tests marked **P1** are recommended
but not blocking for initial conformance. Tests marked
**Deferred** correspond to behavior the spec leaves
intentionally open or that requires infrastructure not yet
available.

---

## 2. Scope

This test plan covers:

- Data model structural correctness (§4)
- Normalization success and failure paths (§5)
- Registry construction and index completeness (§6)
- Acquisition contract: manifest discovery, scope
  filtering, all-or-nothing failure, auxiliary
  isolation (§7)
- Query contract: lookup, listing, relationship, analysis,
  projection categories (§8)
- Scope semantics: scope-safe, scope-relative, and
  full-corpus-recommended behavior (§8.8)
- Context assembly: determinism, immutability,
  composition correctness (§9)
- Workflow contract: acquisition-before-analysis,
  typed returns, context-as-internal-step (§10)
- Rendering and projection: determinism, canonical
  form, derived status (§11)
- Invariant preservation (§12)

This test plan does NOT cover:

- `tsn run` invocation mechanics or CLI flag derivation
  (CLI test plan)
- IR evaluation or kernel semantics (kernel test plan)
- Agent transport or dispatch behavior
- CI pipeline or script wrapper behavior
- The exact form of the corpus manifest (implementation
  choice per §7.3)

---

## 3. Test Strategy

### 3.1 Priority Model

- **P0** tests correspond to MUST / MUST NOT behavior.
  Blocking conformance.
- **P1** tests correspond to SHOULD, MAY, or advisory
  behavior. Recommended, not blocking.
- **Deferred** tests correspond to behavior the spec
  leaves intentionally open (OQ1) or that requires
  infrastructure not yet available.

### 3.2 Approach

Tests are organized into categories matching the spec's
major sections. Each category validates a contract
boundary:

- **Data model tests (A)** — constructor output shape
  and validation rules, using unit assertions over
  constructed values.
- **Normalization tests (B)** — NormalizeResult
  discrimination, hash determinism, and structural
  rejection, using unit tests over normalizeSpec /
  normalizeTestPlan.
- **Registry tests (C)** — index completeness and
  construction rules, using unit tests over buildRegistry
  with hand-constructed normalized modules.
- **Acquisition tests (D)** — integration tests verifying
  the effectful acquisition boundary, manifest discovery,
  scope filtering, and failure modes.
- **Query tests (E)** — pure function conformance over
  hand-constructed registries. No I/O. Each test builds
  a registry from fixture modules and calls a query.
- **Scope tests (F)** — dedicated section for filtered
  vs full scope semantics, covering false positives,
  false negatives, and scope annotation propagation.
- **Context assembly tests (G)** — composition
  correctness, determinism, and immutability.
- **Workflow contract tests (H)** — structural assertions
  on the acquire → assemble → return pattern.
- **Rendering / projection tests (J)** — determinism,
  canonical form assertions, derived-not-canonical
  boundary.
- **Invariant tests (K)** — targeted assertions for each
  numbered invariant.

### 3.3 Behavioral vs Structural Conformance

Most tests validate externally observable behavior: given
an input, does the function return the expected output or
reject the expected invalid input?

A small number of tests validate structural conformance:
interface shape, function signature patterns, or design
constraints that are not directly observable through a
single function call. These are marked with
**(structural)** in the assertion column. Structural tests
verify that the implementation conforms to the spec's
API contract shape rather than to a specific observable
output. They are still P0 where the spec uses MUST
language, but they are acknowledged as interface-level
rather than behavior-level assertions.

### 3.4 Fixture Model

Most tests operate on hand-constructed corpus modules
using `@tisyn/spec` constructors. This is intentional:
tests validate the contract, not any particular corpus
content. A standard set of fixture modules is used
across categories:

- `fixture-alpha`: a minimal valid spec with 3 rules,
  2 terms, 1 relationship, 1 open question
- `fixture-beta`: a second spec that complements alpha,
  defines 1 overlapping term, and 2 rules
- `fixture-alpha-plan`: companion test plan for alpha
  with full coverage matrix
- `fixture-gamma`: a spec with `status: "superseded"`
- `fixture-delta`: a third spec that depends on alpha,
  used for scope filtering tests
- `fixture-malformed`: an intentionally invalid spec
  for rejection tests

---

## 4. Test Categories

| ID prefix | Category | Spec section |
|---|---|---|
| SS-DM | Data model | §4 |
| SS-NM | Normalization | §5 |
| SS-RG | Registry construction | §6 |
| SS-AQ | Acquisition contract | §7 |
| SS-QL | Query — lookup | §8.3 |
| SS-QS | Query — listing | §8.4 |
| SS-QR | Query — relationship | §8.5 |
| SS-QA | Query — analysis | §8.6 |
| SS-QP | Query — projection | §8.7 |
| SS-SC | Scope semantics | §8.8 |
| SS-CA | Context assembly | §9 |
| SS-WF | Workflow contract | §10 |
| SS-RN | Rendering / projection | §11 |
| SS-IV | Invariants | §12 |

---

## 5. Test Cases

### A. Data Model (SS-DM)

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-DM-001 | P0 | Unit | D1 | SpecModule id matching `[a-z][a-z0-9-]*` is accepted by normalization |
| SS-DM-002 | P0 | Unit | D1 | SpecModule id containing uppercase letters is rejected |
| SS-DM-003 | P0 | Unit | D1 | SpecModule id starting with a digit is rejected |
| SS-DM-004 | P0 | Unit | D1 | Empty string SpecModule id is rejected |
| SS-DM-005 | P0 | Unit | D3 | SpecModule with empty `sections` array is rejected |
| SS-DM-006 | P0 | Unit | D5 | Spec with two sections sharing the same id is rejected |
| SS-DM-007 | P0 | Unit | D5 | Section id uniqueness is enforced across nesting levels |
| SS-DM-008 | P0 | Unit | D6 | Section with empty title is rejected |
| SS-DM-009 | P0 | Unit | D8 | Two rules with the same id in one spec are rejected |
| SS-DM-010 | P0 | Unit | D8 | Empty string rule id is rejected |
| SS-DM-011 | P0 | Unit | D9 | Rule with invalid level value is rejected |
| SS-DM-012 | P0 | Unit | D9 | All five RFC 2119 levels are accepted |
| SS-DM-013 | P0 | Unit | D10 | Empty string term is rejected |
| SS-DM-014 | P0 | Unit | D11 | Spec defining the same term twice is rejected |
| SS-DM-015 | P0 | Unit | D12 | Empty string relationship target is rejected |
| SS-DM-016 | P0 | Unit | D12 | Relationship with target not in corpus is accepted by normalization |
| SS-DM-017 | P0 | Unit | D13 | Duplicate open question ids within one spec are rejected |
| SS-DM-018 | P0 | Unit | D15 | Empty string error code is rejected |
| SS-DM-019 | P0 | Unit | D16 | Empty string concept name is rejected |
| SS-DM-020 | P0 | Unit | D17 | Empty string invariant id is rejected |
| SS-DM-021 | P0 | Unit | D18 | TestPlanModule id matching `[a-z][a-z0-9-]*` is accepted |
| SS-DM-022 | P0 | Unit | D18 | TestPlanModule id with invalid characters is rejected |
| SS-DM-023 | P0 | Unit | D19 | TestPlanModule with empty string `validatesSpec` is rejected |
| SS-DM-024 | P0 | Unit | D20 | categoriesSectionId not referencing an existing section id is rejected |
| SS-DM-025 | P0 | Unit | D21 | Duplicate section ids within a test plan are rejected |
| SS-DM-026 | P0 | Unit | D22 | TestPlanSection with empty title is rejected |
| SS-DM-027 | P0 | Unit | D23 | Duplicate category ids within one test plan are rejected |
| SS-DM-028 | P0 | Unit | D24 | Empty string test case id is rejected |
| SS-DM-029 | P0 | Unit | D26 | CoverageEntry testIds referencing a nonexistent test case id in this plan is rejected |
| SS-DM-030 | P0 | Unit | D27 | CoverageEntry with non-empty testIds and status `"uncovered"` is rejected |
| SS-DM-031 | P0 | Unit | D27 | CoverageEntry with empty testIds and status `"covered"` is rejected |
| SS-DM-032 | P0 | Unit | D27 | CoverageEntry with non-empty testIds and status `"covered"` is accepted |
| SS-DM-033 | P0 | Unit | §4.1 | Object carrying both `tisyn_spec` and `tisyn` fields is rejected |
| SS-DM-034 | P0 | Unit | V6 | SpecModule missing required `title` field is rejected |
| SS-DM-035 | P0 | Unit | V6 | SpecModule missing required `status` field is rejected |
| SS-DM-036 | P0 | Unit | V8 | Section with `NaN` as id is rejected |
| SS-DM-037 | P0 | Unit | V8 | Section with `Infinity` as id is rejected |
| SS-DM-038 | P0 | Unit | V9 | SpecModule with status `"unknown"` is rejected |
| SS-DM-039 | P1 | Unit | D4 | Superseded spec without `"superseded-by"` relationship normalizes (SHOULD, not MUST) |
| SS-DM-040 | P1 | Unit | D14 | Resolved open question without `resolvedIn` normalizes (SHOULD, not MUST) |

### B. Normalization (SS-NM)

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-NM-001 | P0 | Unit | §5.1 | normalizeSpec on a valid module returns `{ status: "ok", value }` |
| SS-NM-002 | P0 | Unit | §5.1 | normalizeSpec on an invalid module returns `{ status: "error", errors }` |
| SS-NM-003 | P0 | Unit | §5.1 | normalizeSpec on invalid input does NOT throw |
| SS-NM-004 | P0 | Unit | §5.1 | normalizeTestPlan on a valid module returns `{ status: "ok", value }` |
| SS-NM-005 | P0 | Unit | §5.1 | normalizeTestPlan on invalid input does NOT throw |
| SS-NM-006 | P0 | Unit | N1 | `_hash` on normalized spec is a SHA-256 hex string |
| SS-NM-007 | P0 | Unit | N1 | Normalizing the same module twice produces identical `_hash` |
| SS-NM-008 | P0 | Unit | N1 | `_hash` is computed before `_hash` and `_normalizedAt` are added (normalizing a module, removing `_hash` and `_normalizedAt`, and recomputing produces the same hash) |
| SS-NM-009 | P0 | Unit | N2 | `_normalizedAt` is a valid ISO 8601 timestamp |
| SS-NM-010 | P0 | Unit | V1 | Module without `tisyn_spec` field is rejected |
| SS-NM-011 | P0 | Unit | V1 | Module with `tisyn_spec: "unknown"` is rejected |
| SS-NM-012 | P0 | Unit | V3 | NormalizationError identifies which uniqueness constraint was violated |
| SS-NM-013 | P0 | Unit | V4 | CoverageEntry inconsistency produces a normalization error, not a throw |
| SS-NM-014 | P0 | Unit | V5 | categoriesSectionId pointing to a nonexistent section id produces normalization error |

### C. Registry Construction (SS-RG)

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-RG-001 | P0 | Unit | R1 | Every NormalizedSpecModule in input appears in registry.specs |
| SS-RG-002 | P0 | Unit | R2 | Every NormalizedTestPlanModule in input appears in registry.plans |
| SS-RG-003 | P0 | Unit | R3 | Every rule in every spec appears in registry.ruleIndex |
| SS-RG-004 | P0 | Unit | R3 | When two specs define the same rule id, the index contains the one from the spec earlier in dependencyOrder |
| SS-RG-005 | P0 | Unit | R4 | Term index follows the same precedence as rule index for duplicate terms |
| SS-RG-006 | P0 | Unit | R5 | registry.edges contains one edge per relationship in input specs |
| SS-RG-007 | P0 | Unit | R5 | Edges from out-of-scope specs are excluded when scope is filtered |
| SS-RG-008 | P0 | Unit | R6 | dependencyOrder is a topological sort of in-scope specs |
| SS-RG-009 | P0 | Unit | R6 | dependencyOrder produces a best-effort partial order when cycles exist |
| SS-RG-010 | P0 | Unit | R7 | registry.scope equals the scope parameter passed to buildRegistry |
| SS-RG-011 | P0 | Unit | RI1 | Attempting to mutate a registry map after construction has no effect (frozen) |
| SS-RG-012 | P0 | Unit | RI2 | No entity from any input module is missing from the indices |
| SS-RG-013 | P0 | Unit | RI3 | A spec with a relationship target not in registry.specs does not cause construction failure |
| SS-RG-014 | P0 | Unit | RI4 | Full-scope registry has `scope.kind === "full"` |
| SS-RG-015 | P0 | Unit | RI4 | Filtered-scope registry has `scope.kind === "filtered"` with correct specIds |
| SS-RG-016 | P0 | Unit | D2 | buildRegistry with two specs sharing the same id raises an error |

### D. Acquisition Contract (SS-AQ)

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-AQ-001 | P0 | Integration | A1 | Full acquisition with no scope parameter returns all manifest modules |
| SS-AQ-002 | P0 | Integration | A1 | Filtered acquisition with specIds returns only named specs and their companion plans |
| SS-AQ-003 | P0 | Integration | A2 | Every module in the returned registry has passed normalization (`_hash` present) |
| SS-AQ-004 | P0 | Integration | A3 | Registry invariants RI1–RI4 hold on the returned registry |
| SS-AQ-005 | P0 | Integration | A6 | Spec with relationship to non-existent target acquires successfully |
| SS-AQ-006 | P0 | Integration | A7 | Full acquisition produces registry with `scope.kind === "full"` |
| SS-AQ-007 | P0 | Integration | A7 | Filtered acquisition produces registry with `scope.kind === "filtered"` and correct specIds |
| SS-AQ-008 | P0 | Integration | §7.3 | Acquisition discovers modules from a static manifest, not directory scanning |
| SS-AQ-009 | P0 | Integration | §7.3 | Module not registered in the manifest is not acquired even if present on disk |
| SS-AQ-010 | P0 | Integration | F1 | A malformed module in scope causes acquisition failure with module id and errors in the error |
| SS-AQ-011 | P0 | Integration | F1 | No partial registry is returned on normalization failure |
| SS-AQ-012 | P0 | Integration | F2 | A module registered in the manifest but not loadable causes acquisition failure |
| SS-AQ-013 | P0 | Integration | F3 | Two modules with the same id in scope cause acquisition failure identifying both |
| SS-AQ-014 | P0 | Integration | §7.5 | Spec with unresolved relationship target does NOT cause acquisition failure |
| SS-AQ-015 | P0 | Integration | §7.5 | Spec with uncovered rules does NOT cause acquisition failure |
| SS-AQ-016 | P0 | Integration | §7.5 | Spec with open questions does NOT cause acquisition failure |
| SS-AQ-017 | P0 | Integration | §7.5 | Spec with status `"superseded"` loads normally |
| SS-AQ-018 | P0 | Integration | AX1 | Fixture returned by acquireFixture is NOT present in the corpus registry |
| SS-AQ-019 | P0 | Integration | AX1 | Emitted markdown returned by acquireEmittedMarkdown is NOT present in the corpus registry |
| SS-AQ-020 | P0 | Integration | §7.3 | Acquisition uses normalizeSpec/normalizeTestPlan (structural; verified by checking `_hash` presence and V1–V9 enforcement on returned modules) |
| SS-AQ-021 | P0 | Integration | §7.3 | Acquisition uses buildRegistry (structural; verified by checking registry shape and index presence) |
| SS-AQ-022 | P0 | Integration | A1 | Filtered acquisition automatically includes companion test plan for named spec |

### E. Query Contract (SS-QL, SS-QS, SS-QR, SS-QA, SS-QP)

#### E.1 General Properties

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-QL-001 | P0 | Unit | Q1 | Every query function accepts CorpusRegistry as first argument **(structural; verified by calling each query with a registry and confirming no type or runtime error)** |
| SS-QL-002 | P0 | Unit | Q3 | findSpec returns undefined for nonexistent id (no throw) |
| SS-QL-003 | P0 | Unit | Q3 | findRule returns undefined for nonexistent rule id (no throw) |
| SS-QL-004 | P0 | Unit | Q3 | findTerm returns undefined for nonexistent term (no throw) |
| SS-QL-005 | P0 | Unit | Q3 | findTestCase returns undefined for nonexistent test id (no throw) |
| SS-QL-006 | P0 | Unit | Q3 | findErrorCode returns undefined for nonexistent code (no throw) |
| SS-QL-007 | P0 | Unit | Q3 | findOpenQuestion returns undefined for nonexistent OQ id (no throw) |
| SS-QL-008 | P0 | Unit | Q3 | listRules returns empty array for nonexistent spec id (no throw) |
| SS-QL-009 | P0 | Unit | Q3 | listDependents returns empty array for spec with no dependents (no throw) |
| SS-QL-010 | P0 | Unit | Q3 | impactOf returns empty array for spec with no dependents and no §-references (no throw) |
| SS-QL-011 | P0 | Unit | Q3 | findTermConflicts returns empty array when no conflicts exist (no throw) |
| SS-QL-012 | P0 | Unit | Q4 | Calling findRule twice with same inputs returns identical results |
| SS-QL-013 | P0 | Unit | Q4 | Calling listDependencies twice with same inputs returns identical results |
| SS-QL-014 | P0 | Unit | Q4 | Calling generateDiscoveryPack twice with same registry returns identical results |
| SS-QL-015 | P0 | Unit | Q6 | Queries do not refuse to execute on filtered-scope registries |
| SS-QL-016 | P0 | Unit | Q6 | Queries do not change algorithm based on registry.scope (same in-scope data produces same result regardless of scope annotation) |

#### E.2 Lookup Queries

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-QL-020 | P0 | Unit | §8.3 | findSpec returns the normalized module for a valid id |
| SS-QL-021 | P0 | Unit | §8.3 | findRule returns RuleLocation with correct specId and sectionId |
| SS-QL-022 | P0 | Unit | §8.3 | findRule with duplicate rule ids returns the index entry (first in dependency order) |
| SS-QL-023 | P0 | Unit | §8.3 | findTerm is case-sensitive |
| SS-QL-024 | P0 | Unit | §8.3 | findTestCase returns TestCaseLocation with planId and categoryId |
| SS-QL-025 | P0 | Unit | §8.3 | findErrorCode returns ErrorCodeLocation with specId |
| SS-QL-026 | P0 | Unit | §8.3 | findOpenQuestion returns OpenQuestionLocation with specId |

#### E.3 Listing Queries

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-QS-001 | P0 | Unit | §8.4 | listRules returns rules in section order for a valid spec |
| SS-QS-002 | P0 | Unit | §8.4 | listRulesByLevel returns only rules at the specified level |
| SS-QS-003 | P0 | Unit | §8.4 | listDependencies returns the full declared relationship list for a spec |
| SS-QS-004 | P0 | Unit | §8.4 | listDependencies returns declared targets even when targets are out of scope |
| SS-QS-005 | P0 | Unit | §8.4 | listDependents returns specs whose relationships name the target |
| SS-QS-006 | P0 | Unit | §8.4 | listOpenQuestions with no filter returns all open questions |
| SS-QS-007 | P0 | Unit | §8.4 | listOpenQuestions with status filter returns only matching questions |
| SS-QS-008 | P0 | Unit | §8.4 | listOpenQuestions with blocksTarget filter returns only questions blocking that target |
| SS-QS-009 | P0 | Unit | §8.4 | listTerms returns all terms from all in-scope specs |
| SS-QS-010 | P0 | Unit | §8.4 | listErrorCodes returns all error codes from all in-scope specs |

#### E.4 Relationship Queries

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-QR-001 | P0 | Unit | §8.5 | impactOf returns direct dependents with correct impactType |
| SS-QR-002 | P0 | Unit | §8.5 | impactOf detects §-references in prose and reports them as `"prose-references"` |
| SS-QR-003 | P0 | Unit | §8.5 | impactOf with sectionId filter returns only specs referencing that section |
| SS-QR-004 | P0 | Unit | §8.5 | transitiveDependencies returns all specs reachable via depends-on/amends edges |
| SS-QR-005 | P0 | Unit | §8.5 | transitiveDependencies returns empty array for spec with no dependencies |
| SS-QR-006 | P0 | Unit | §8.5 | dependencyOrder returns registry.dependencyOrder |
| SS-QR-007 | P0 | Unit | §8.5 | hasCycles returns false for an acyclic dependency graph |
| SS-QR-008 | P0 | Unit | §8.5 | hasCycles returns true when a cycle exists among in-scope specs |

#### E.5 Analysis Queries

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-QA-001 | P0 | Unit | §8.6 | checkCoverage with companion plan returns coveredRules with testIds |
| SS-QA-002 | P0 | Unit | §8.6 | checkCoverage without companion plan returns all rules as uncovered |
| SS-QA-003 | P0 | Unit | §8.6 | checkCoverage.stats totals equal coveredRules.length + uncoveredRules.length + deferredRules.length |
| SS-QA-004 | P0 | Unit | §8.6 | isReady returns `ready: true` for spec that meets all four conditions |
| SS-QA-005 | P0 | Unit | §8.6 | isReady returns `ready: false` with blocking reason for draft spec |
| SS-QA-006 | P0 | Unit | §8.6 | isReady returns `ready: false` when no companion plan exists |
| SS-QA-007 | P0 | Unit | §8.6 | isReady returns `ready: false` when uncovered MUST rules exist |
| SS-QA-008 | P0 | Unit | §8.6 | isReady returns `ready: false` when open questions with `"open"` status exist |
| SS-QA-009 | P0 | Unit | §8.6 | findTermConflicts returns terms defined in 2+ specs with different text |
| SS-QA-010 | P0 | Unit | §8.6 | findTermConflicts does NOT return terms with identical definitions across specs |
| SS-QA-011 | P0 | Unit | §8.6 | findStaleReferences detects relationship target not in registry as `"missing-spec"` |
| SS-QA-012 | P0 | Unit | §8.6 | findStaleReferences detects dependency on superseded spec as `"superseded-spec"` |
| SS-QA-013 | P0 | Unit | §8.6 | findErrorCodeCollisions returns codes defined in 2+ specs |
| SS-QA-014 | P0 | Unit | §8.6 | findErrorCodeCollisions returns nothing when all codes are unique |
| SS-QA-015 | P0 | Unit | §8.6 | findDuplicateRules returns rule ids appearing in 2+ specs |
| SS-QA-016 | P0 | Unit | §8.6 | findDuplicateRules returns nothing when all rule ids are unique across specs |
| SS-QA-017 | P0 | Unit | D25 | checkCoverage reports a rule as uncovered when the coverage matrix references a rule id not present in the companion spec |

> **Note on D25.** D25 states that
> `CoverageEntry.rule` MUST reference a rule id in the
> spec named by `validatesSpec`. This is a cross-module
> constraint. Normalization cannot validate it because
> it operates on a single module. Instead, `checkCoverage`
> validates this at query time: if a coverage entry names
> a rule id not found in the companion spec, the entry is
> not matched and the phantom rule is not reported as
> covered. SS-QA-017 tests this directly.

#### E.6 Projection Queries

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-QP-001 | P0 | Unit | §8.7 | generateDiscoveryPack returns typed DiscoveryPack value (not string) |
| SS-QP-002 | P0 | Unit | §8.7 | generateDiscoveryPack is deterministic: same registry produces same pack |
| SS-QP-003 | P0 | Unit | §8.7 | generateDiscoveryPack.scopeKind reflects registry.scope.kind |
| SS-QP-004 | P0 | Unit | §8.7 | generateDiscoveryPack.specCount equals registry.specs.size |
| SS-QP-005 | P0 | Unit | §8.7 | generateConstraintDocument.upstreamDependencies is complete regardless of scope |
| SS-QP-006 | P0 | Unit | §8.7 | generateConstraintDocument.scopeKind reflects registry.scope.kind |
| SS-QP-007 | P0 | Unit | §8.7 | generateTaskContext requires at least one of specIds, rulePattern, or termPattern |
| SS-QP-008 | P0 | Unit | §8.7 | generateTaskContext.rulePattern matches case-insensitively |
| SS-QP-009 | P0 | Unit | §8.7 | generateTaskContext.scopeKind reflects registry.scope.kind |
| SS-QP-010 | P0 | Unit | §8.7 | generateTaskContext with includeRelated includes specs connected by relationship edges |
| SS-QP-011 | P0 | Unit | §8.7 | generateTaskContext with includeRelated on filtered scope includes only in-scope related specs |

---

## 6. Scope-Specific Tests (SS-SC)

This section validates scope semantics defined in §8.8.

### 6.1 Scope Annotation

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-SC-001 | P0 | Unit | RI4, A7 | Full-scope registry has `scope === { kind: "full" }` |
| SS-SC-002 | P0 | Unit | RI4, A7 | Filtered-scope registry has `scope === { kind: "filtered", specIds: [...] }` matching request |
| SS-SC-003 | P0 | Unit | R7 | Scope annotation survives through buildRegistry and matches input parameter |

### 6.2 Scope-Safe Queries

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-SC-010 | P0 | Unit | §8.8 | findRule on filtered registry returns correct result for in-scope rule |
| SS-SC-011 | P0 | Unit | §8.8 | listRules on filtered registry returns complete rule list for in-scope spec |
| SS-SC-012 | P0 | Unit | §8.8 | listDependencies on filtered registry returns full declared deps (not limited by scope) |
| SS-SC-013 | P0 | Unit | §8.8 | checkCoverage on filtered registry returns correct coverage for in-scope spec/plan pair |
| SS-SC-014 | P0 | Unit | §8.8 | isReady on filtered registry returns correct readiness for in-scope spec |

### 6.3 Scope-Relative Queries

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-SC-020 | P0 | Unit | §8.8 | listDependents on filtered registry omits out-of-scope dependents |
| SS-SC-021 | P0 | Unit | §8.8 | listDependents on full registry includes all dependents |
| SS-SC-022 | P0 | Unit | §8.8 | impactOf on filtered registry omits impact from out-of-scope specs |
| SS-SC-023 | P0 | Unit | §8.8 | generateConstraintDocument.downstreamDependents on filtered registry is a subset of full-scope result |
| SS-SC-024 | P0 | Unit | §8.8 | generateTaskContext with includeRelated on filtered registry excludes out-of-scope related specs |

### 6.4 Full-Corpus-Recommended Queries: False Negatives

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-SC-030 | P0 | Unit | §8.8 | findTermConflicts on filtered scope missing one conflicting spec returns no conflict (false negative) |
| SS-SC-031 | P0 | Unit | §8.8 | findTermConflicts on full scope with same specs returns the conflict |
| SS-SC-032 | P0 | Unit | §8.8 | findDuplicateRules on filtered scope missing one duplicate-bearing spec returns no duplicate (false negative) |
| SS-SC-033 | P0 | Unit | §8.8 | findErrorCodeCollisions on filtered scope missing one colliding spec returns no collision (false negative) |

### 6.5 Full-Corpus-Recommended Queries: False Positives

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-SC-040 | P0 | Unit | §8.8, §8.6 | findStaleReferences on filtered scope reports `"missing-spec"` for a target that exists in full corpus but is out of scope |
| SS-SC-041 | P0 | Unit | §8.8 | findStaleReferences on full scope with same specs does NOT report the target as missing |

### 6.6 Full-Corpus-Recommended Queries: Hidden Cycles

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-SC-050 | P0 | Unit | §8.8 | hasCycles on filtered scope with cycle passing through out-of-scope spec returns false |
| SS-SC-051 | P0 | Unit | §8.8 | hasCycles on full scope with same specs returns true |

### 6.7 Discovery Pack Scope

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-SC-060 | P0 | Unit | §8.7 | Discovery pack from filtered registry has `scopeKind === "filtered"` |
| SS-SC-061 | P0 | Unit | §8.7 | Discovery pack from full registry has `scopeKind === "full"` |

---

## 7. Rendering and Projection Tests (SS-RN)

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-RN-001 | P0 | Unit | RD2 | renderSpecMarkdown is deterministic: same module produces same output |
| SS-RN-002 | P0 | Unit | RD2 | renderTestPlanMarkdown is deterministic: same module produces same output |
| SS-RN-003 | P0 | Unit | RD3 | Rendered output is a string value, not a corpus module |
| SS-RN-004 | P0 | Unit | §11.2 | compareMarkdown detects differing section headings |
| SS-RN-005 | P0 | Unit | §11.2 | compareMarkdown detects differing relationship lines |
| SS-RN-006 | P0 | Unit | §11.2 | compareMarkdown reports match for identical inputs |
| SS-RN-007 | P0 | Unit | §11.3, I11 | generateDiscoveryPack returns typed DiscoveryPack, not compact text |
| SS-RN-008 | P1 | Unit | §11.3 | If renderDiscoveryPackText exists, it returns a string derived from the typed pack |
| SS-RN-009 | P1 | Unit | §11.3 | renderDiscoveryPackText output changes when the input pack changes (derived, not cached) |

> **Note on RD1.** RD1 (rendering functions MUST NOT
> perform I/O) is a structural constraint. It is not
> directly testable as a behavioral assertion. It is
> implicitly verified by the fact that rendering functions
> accept a normalized module and return a string with no
> filesystem or network calls required by the test harness.
> No dedicated test exists; compliance is structural.

---

## 8. Context Assembly Tests (SS-CA)

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-CA-001 | P0 | Unit | CA2 | assembleAuthoringContext does not mutate the input registry (registry maps unchanged after call) |
| SS-CA-002 | P0 | Unit | CA3 | assembleAuthoringContext is deterministic: same inputs produce same output |
| SS-CA-003 | P0 | Unit | §9.2 | AuthoringContext.scopeKind reflects the registry's scope kind |
| SS-CA-004 | P0 | Unit | §9.2 | AuthoringContext includes constraint document when targetSpec is provided and exists |
| SS-CA-005 | P0 | Unit | §9.2 | AuthoringContext.constraints is absent when targetSpec is not provided |
| SS-CA-006 | P0 | Unit | §9.3 | AmendmentContext.scopeKind reflects the registry's scope kind |
| SS-CA-007 | P0 | Unit | §9.3 | AmendmentContext contains constraints, impact, dependencies, dependents, coverage, and blocking questions |
| SS-CA-008 | P0 | Unit | §9.4 | ReviewContext.scopeKind reflects the registry's scope kind |
| SS-CA-009 | P0 | Unit | §9.4 | ReviewContext contains dependencies, dependents, terms, corpusTermConflicts, staleReferences, coverage, readiness, and errorCodeConflicts |
| SS-CA-010 | P0 | Unit | §9.5 | TestPlanContext partitions rules by level (must/should/may) |
| SS-CA-011 | P0 | Unit | §9.5 | TestPlanContext.totalRuleCount equals sum of must + should + may rules |
| SS-CA-012 | P0 | Unit | §9.6 | ConsistencyContext.scopeKind reflects the registry's scope kind |
| SS-CA-013 | P0 | Unit | CA2 | assembleAmendmentContext does not mutate the input registry |
| SS-CA-014 | P0 | Unit | CA3 | assembleReviewContext is deterministic |

> **Note on CA1.** CA1 (context assembly MUST NOT perform
> I/O) is structurally verified by the same reasoning as
> RD1: the functions accept a `CorpusRegistry` and return
> a typed value with no filesystem or network access
> required by the test harness. No dedicated test exists;
> compliance is structural.

> **Note on CA4.** CA4 (context assembly is primarily an
> internal step used by workflows) is a design constraint
> on system composition, not a behavioral property of the
> context assembly functions themselves. It cannot be
> expressed as a unit assertion. Compliance is verified by
> reviewing workflow implementations against §10.1. No
> dedicated test exists.

---

## 9. Workflow Contract Tests (SS-WF)

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-WF-001 | P0 | Integration | W1 | Production workflow acquires corpus registry via acquireCorpusRegistry() before any query |
| SS-WF-002 | P0 | Integration | W2 | Production workflow uses pure context assembly, not agent dispatch, for analytical steps **(structural; verified by inspecting that context values are produced without yield* to agents)** |
| SS-WF-003 | P0 | Integration | W3 | Production workflow returns a typed result value |
| SS-WF-004 | P1 | Integration | W4 | Agent dispatch, if present, is secondary to the typed return |
| SS-WF-005 | P1 | Integration | §10.2 | draft-spec workflow returns an AuthoringContext |
| SS-WF-006 | P1 | Integration | §10.2 | amend-spec workflow returns an AmendmentContext |
| SS-WF-007 | P1 | Integration | §10.2 | review-spec workflow returns a ReviewContext |
| SS-WF-008 | P1 | Integration | §10.2 | draft-test-plan workflow returns a TestPlanContext |
| SS-WF-009 | P1 | Integration | §10.3 | consistency-check workflow returns a ConsistencyContext |

---

## 10. Invariant Tests (SS-IV)

| ID | P | Type | Spec | Assertion |
|---|---|---|---|---|
| SS-IV-001 | P0 | Unit | I1 | Acquisition with a malformed module fails entirely (no partial registry) |
| SS-IV-002 | P0 | Unit | I2 | Registry maps are not writable after construction |
| SS-IV-003 | P0 | Unit | I4 | Context assembly functions do not modify registry.specs or registry.ruleIndex |
| SS-IV-004 | P0 | Integration | I5 | acquireFixture result is not present in any registry index |
| SS-IV-005 | P0 | Unit | I6 | generateDiscoveryPack produces identical output on repeated calls with same registry |
| SS-IV-006 | P0 | Unit | I7 | renderSpecMarkdown output is a string, not a NormalizedSpecModule |
| SS-IV-007 | P0 | Unit | I8 | Object with both `tisyn_spec` and `tisyn` fields is rejected by normalization |
| SS-IV-008 | P0 | Unit | I9 | registry.scope on full-scope registry is `{ kind: "full" }` |
| SS-IV-009 | P0 | Unit | I9 | registry.scope on filtered registry contains exactly the requested specIds |
| SS-IV-010 | P0 | Integration | I10 | Acquisition uses manifest, not directory scanning |
| SS-IV-011 | P0 | Unit | I11 | generateDiscoveryPack returns a typed object, not a rendered string |

> **Note on I3.** I3 (pure query functions do not acquire
> external state) is a structural constraint. It is
> verified the same way as CA1 and RD1: queries accept a
> `CorpusRegistry` and return typed values with no I/O
> required by the test harness. No behavioral test can
> prove the absence of I/O; compliance is structural.
> The no-throw tests (SS-QL-002 through SS-QL-011) and
> determinism tests (SS-QL-012 through SS-QL-014)
> indirectly verify purity by confirming that results
> depend only on inputs.

---

## 11. Coverage Matrix

| Spec Rule | Test IDs | Status |
|---|---|---|
| D1 | SS-DM-001, SS-DM-002, SS-DM-003, SS-DM-004 | Covered |
| D2 | SS-RG-016, SS-AQ-013 | Covered |
| D3 | SS-DM-005 | Covered |
| D4 | SS-DM-039 | Covered (P1; SHOULD) |
| D5 | SS-DM-006, SS-DM-007 | Covered |
| D6 | SS-DM-008 | Covered |
| D7 | — | Structural only (rendering presentation; see §13) |
| D8 | SS-DM-009, SS-DM-010 | Covered |
| D9 | SS-DM-011, SS-DM-012 | Covered |
| D10 | SS-DM-013 | Covered |
| D11 | SS-DM-014 | Covered |
| D12 | SS-DM-015, SS-DM-016 | Covered |
| D13 | SS-DM-017 | Covered |
| D14 | SS-DM-040 | Covered (P1; SHOULD) |
| D15 | SS-DM-018 | Covered |
| D16 | SS-DM-019 | Covered |
| D17 | SS-DM-020 | Covered |
| D18 | SS-DM-021, SS-DM-022 | Covered |
| D19 | SS-DM-023 | Covered |
| D20 | SS-DM-024 | Covered |
| D21 | SS-DM-025 | Covered |
| D22 | SS-DM-026 | Covered |
| D23 | SS-DM-027 | Covered |
| D24 | SS-DM-028 | Covered |
| D25 | SS-QA-017 | Covered (cross-module; at query time) |
| D26 | SS-DM-029 | Covered |
| D27 | SS-DM-030, SS-DM-031, SS-DM-032 | Covered |
| N1 | SS-NM-006, SS-NM-007, SS-NM-008 | Covered |
| N2 | SS-NM-009 | Covered |
| V1 | SS-NM-010, SS-NM-011 | Covered |
| V2 | SS-DM-004, SS-DM-010, SS-DM-013, SS-DM-018, SS-DM-019, SS-DM-020, SS-DM-023, SS-DM-028 | Covered |
| V3 | SS-DM-006, SS-DM-007, SS-DM-009, SS-DM-014, SS-DM-017, SS-DM-025, SS-DM-027, SS-NM-012 | Covered |
| V4 | SS-DM-030, SS-DM-031, SS-NM-013 | Covered |
| V5 | SS-DM-024, SS-NM-014 | Covered |
| V6 | SS-DM-034, SS-DM-035 | Covered |
| V7 | SS-DM-008, SS-DM-026 | Covered |
| V8 | SS-DM-036, SS-DM-037 | Covered |
| V9 | SS-DM-038 | Covered |
| R1 | SS-RG-001 | Covered |
| R2 | SS-RG-002 | Covered |
| R3 | SS-RG-003, SS-RG-004 | Covered |
| R4 | SS-RG-005 | Covered |
| R5 | SS-RG-006, SS-RG-007 | Covered |
| R6 | SS-RG-008, SS-RG-009 | Covered |
| R7 | SS-RG-010 | Covered |
| RI1 | SS-RG-011, SS-IV-002 | Covered |
| RI2 | SS-RG-012 | Covered |
| RI3 | SS-RG-013 | Covered |
| RI4 | SS-RG-014, SS-RG-015, SS-SC-001, SS-SC-002, SS-SC-003 | Covered |
| A1 | SS-AQ-001, SS-AQ-002, SS-AQ-022 | Covered |
| A2 | SS-AQ-003, SS-AQ-020, SS-AQ-021 | Covered |
| A3 | SS-AQ-004 | Covered |
| A4 | SS-IV-002 | Covered |
| A5 | — | Deferred (see §13) |
| A6 | SS-AQ-005 | Covered |
| A7 | SS-AQ-006, SS-AQ-007 | Covered |
| F1 | SS-AQ-010, SS-AQ-011 | Covered |
| F2 | SS-AQ-012 | Covered |
| F3 | SS-AQ-013 | Covered |
| L1–L4 | — | Structural guidance (see §13) |
| AX1 | SS-AQ-018, SS-AQ-019, SS-IV-004 | Covered |
| AX2 | SS-AQ-018 | Covered |
| AX3 | SS-AQ-019 | Covered |
| Q1 | SS-QL-001 | Covered (structural) |
| Q2 | — | Structural (see §13) |
| Q3 | SS-QL-002–011 | Covered |
| Q4 | SS-QL-012, SS-QL-013, SS-QL-014 | Covered |
| Q5 | — | Structural (see §13) |
| Q6 | SS-QL-015, SS-QL-016 | Covered |
| §8.8 scope-safe | SS-SC-010–014 | Covered |
| §8.8 scope-relative | SS-SC-020–024 | Covered |
| §8.8 full-corpus false neg | SS-SC-030–033 | Covered |
| §8.8 full-corpus false pos | SS-SC-040, SS-SC-041 | Covered |
| §8.8 hidden cycles | SS-SC-050, SS-SC-051 | Covered |
| CA1 | — | Structural (see §13) |
| CA2 | SS-CA-001, SS-CA-013 | Covered |
| CA3 | SS-CA-002, SS-CA-014 | Covered |
| CA4 | — | Design constraint (see §13) |
| W1 | SS-WF-001 | Covered |
| W2 | SS-WF-002 | Covered (structural) |
| W3 | SS-WF-003 | Covered |
| W4 | SS-WF-004 | Covered (P1) |
| RD1 | — | Structural (see §13) |
| RD2 | SS-RN-001, SS-RN-002 | Covered |
| RD3 | SS-RN-003, SS-IV-006 | Covered |
| I1 | SS-IV-001 | Covered |
| I2 | SS-IV-002 | Covered |
| I3 | — | Structural (see §13) |
| I4 | SS-IV-003 | Covered |
| I5 | SS-IV-004 | Covered |
| I6 | SS-IV-005 | Covered |
| I7 | SS-IV-006 | Covered |
| I8 | SS-IV-007 | Covered |
| I9 | SS-IV-008, SS-IV-009 | Covered |
| I10 | SS-IV-010 | Covered |
| I11 | SS-IV-011 | Covered |

---

## 12. Deferred and Structural Coverage

### 12.1 Deferred Coverage

| ID | Deferred item | Spec ref | Why deferred |
|---|---|---|---|
| SS-X-001 | A5 snapshot-stability | A5 | Requires concurrent modification of backing source during workflow execution. Not reproducible in unit tests. Deferred to integration testing in real workflow scenarios. |
| SS-X-002 | L1–L4 lifecycle guidance | L1–L4 | SHOULD-level guidance for workflow authors about single-acquisition patterns and registry passing. Not expressible as functional assertions. |
| SS-X-003 | OQ1 typed cross-spec references | §14 OQ1 | Schema not yet specified. Current prose pattern matching is tested via SS-QR-002. |
| SS-X-004 | §8.5.1 transition to typed refs | §8.5.1 | SHOULD-level direction. No normative behavior to test until typed reference constructors exist. |

### 12.2 Structural Conformance (Not Deferred)

The following rules describe constraints on implementation
structure — such as the absence of I/O in pure functions or
the compositional design of queries — that cannot be
expressed as behavioral test assertions. These are NOT
deferred: they are verified by reviewing that the
implementation's type signatures and test-harness
requirements match the spec's constraints. Each is
documented here rather than in the deferred table because
structural conformance is a different verification mode,
not a coverage gap.

| Spec rule | Constraint | How verified |
|---|---|---|
| D7 | Section id type determines numeric vs unnumbered rendering | Rendering output observation. Not a data-model conformance boundary. |
| Q1 | Every query takes CorpusRegistry as first argument | SS-QL-001 calls each query with a registry; type signature review confirms the pattern. |
| Q2 | Queries MUST NOT perform I/O | No test can prove absence of I/O. Verified by: no test harness requires filesystem/network setup for query calls; determinism tests (Q4) indirectly confirm input-only dependence. |
| Q5 | Queries compose by passing return values | Demonstrated by projection queries that internally compose primitives. No separate behavioral test is meaningful; the constraint is on API design, not on a single function's output. |
| CA1 | Context assembly MUST NOT perform I/O | Same reasoning as Q2. No test harness requires I/O setup for context assembly calls. |
| CA4 | Context assembly is primarily an internal step | Design constraint on system composition. Verified by reviewing workflow implementations against §10.1. |
| RD1 | Rendering functions MUST NOT perform I/O | Same reasoning as Q2. Determinism tests (RD2) indirectly confirm. |
| I3 | Pure query functions do not acquire external state | Same reasoning as Q2. Covered indirectly by Q3 no-throw tests and Q4 determinism tests. |

---

## 13. Final Assessment

### What is fully covered

This test plan provides direct P0 behavioral tests for:
all 27 data model constraints (D1–D27), all 9 structural
validation rules (V1–V9), both normalization guarantees
(N1–N2), all 7 registry construction rules (R1–R7) and
4 registry invariants (RI1–RI4), all 7 acquisition success
guarantees (A1–A7 except A5), all 3 acquisition failure
modes (F1–F3), all 3 auxiliary acquisition constraints
(AX1–AX3), query properties Q3, Q4, and Q6, all scope
classifications in §8.8, context assembly rules CA2 and
CA3, workflow rules W1–W3, rendering rules RD2 and RD3,
and invariants I1–I2, I4–I11.

Total: 164 test cases across 14 categories. Of these, 148
are P0 and 12 are P1. The strongest coverage areas are
scope semantics (22 P0 tests), data model validation
(38 P0 tests), acquisition contract (22 P0 tests), and
query contract (56 P0 tests across all categories).

### What is structurally covered

Eight rules (Q1, Q2, Q5, CA1, CA4, RD1, I3, D7) describe
implementation structure rather than observable behavior.
These are verified through type-signature review, test
harness requirements, and indirect evidence from
determinism and no-throw tests. They are documented in
§12.2 and are not coverage gaps — they represent a
different verification mode.

### What remains deferred

Four items are deferred: snapshot stability under concurrent
modification (A5), lifecycle SHOULD guidance (L1–L4), the
typed cross-spec reference schema (OQ1), and the SHOULD-
level direction toward typed references (§8.5.1). These are
deferred because the spec either leaves them open or they
require infrastructure not available in unit/integration
tests.

### What is P1

W4 (agent dispatch secondary to typed return) and the
individual production workflow return-type tests (SS-WF-004
through SS-WF-009) are P1. The rendering tests for optional
compact text rendering (SS-RN-008, SS-RN-009) are P1
because the spec uses MAY. D4 and D14 are P1 because the
spec uses SHOULD.

### Confidence level

A conforming implementation that passes all P0 tests in
this plan satisfies every MUST-level behavioral rule in
the specification. Structural rules are verified by review,
not by automated assertion. Passing all P0 tests plus
structural review is sufficient for conformance. Passing
P1 tests in addition is recommended before the
implementation is considered production-quality.

---

## Conformance-Risk Areas

1. **Filtered-scope false positives in
   `findStaleReferences`.** The spec explicitly states
   that out-of-scope targets are reported as
   `"missing-spec"`. SS-SC-040 and SS-SC-041 lock this
   behavior. Implementations that attempt to suppress
   false positives by inspecting the manifest without
   loading out-of-scope modules would violate Q2 (no I/O
   in queries).

2. **All-or-nothing acquisition.** The temptation to
   return partial registries on partial failure is the
   most likely conformance violation. SS-AQ-010,
   SS-AQ-011, SS-AQ-012, SS-AQ-013, and SS-IV-001
   collectively enforce this.

3. **Manifest-based discovery.** SS-AQ-008 and SS-AQ-009
   verify that acquisition uses the manifest, not
   directory scanning. Implementations that fall back to
   directory scanning as a convenience violate I10 and
   NG8.

4. **Canonical DiscoveryPack form.** SS-RN-007 and
   SS-IV-011 verify that the typed value is the canonical
   form. Implementations that return compact text from
   `generateDiscoveryPack` violate I11.

5. **Scope annotation accuracy.** RI4 is enforced by five
   tests (SS-RG-014, SS-RG-015, SS-SC-001, SS-SC-002,
   SS-SC-003). Inaccurate scope annotation would cause
   downstream consumers to misinterpret scope-relative
   query results.

6. **Cross-module D2 uniqueness.** D2 (corpus-wide id
   uniqueness) is validated at two levels: buildRegistry
   rejects duplicate ids (SS-RG-016), and acquisition
   raises F3 for duplicates (SS-AQ-013). An
   implementation that silently overwrites duplicates
   would violate both.

7. **D25 cross-module coverage validation.** D25 is a
   cross-module constraint that normalization cannot
   enforce alone. SS-QA-017 validates that checkCoverage
   correctly handles phantom rule references. An
   implementation that reports coverage for rule ids not
   present in the companion spec would violate D25.
