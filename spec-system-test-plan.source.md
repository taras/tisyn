# Tisyn Specification System — Conformance Test Plan

**Version:** 0.1.0
**Tests:** Tisyn Specification System Specification v0.1.0
**Status:** Draft

---

## 1. Overview

### 1.1 Purpose

This test plan defines conformance criteria for the
`@tisyn/spec` MVP implementation. It translates the numbered
normative rules from the companion specification into concrete
test obligations with observable evidence.

### 1.2 Relationship to Companion Specification

This test plan tests the Tisyn Specification System
Specification v0.1.0. Every test case references one or more
rule IDs from that specification. The coverage matrix in §7
maps every testable rule to its covering tests.

### 1.3 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are
used as defined in RFC 2119.

### 1.4 Scope

This test plan covers the MVP public API surface:

- constructors and their output shape
- enums and discriminants
- serializable data domain compliance
- normalization behavior for spec and test-plan modules
- registry construction and indexing
- all 10 validation groups (V1–V10)
- coverage analysis and readiness computation
- traversal utilities

This test plan does NOT cover:

- rendered markdown generation (NG1)
- public graph-query APIs (NG2)
- constraint-document generation (NG3)
- CLI surfaces (NG4)
- any other explicit non-goal from §12 of the spec

---

## 2. Test-Plan Philosophy

### 2.1 First-Class Design Artifact

This test plan is part of the design, not a downstream
appendix. If a numbered rule cannot be translated into a
concrete test obligation, it is recorded as an
ambiguity-surface finding (§6), not silently skipped.

### 2.2 Two-Tier Evidence Model

**Tier 1 — Normative observable behavior.** Assertions about
the public API return values, shapes, and validation results.
These determine conformance. A conforming implementation MUST
pass all Tier 1 assertions.

**Tier 2 — Reference-harness evidence.** Assertions about
internal implementation details that aid diagnosis but do not
define conformance. For example, verifying that the internal
dependency graph has a specific edge count. Tier 2 evidence
MUST NOT redefine conformance.

Most tests in this plan use Tier 1 only. The spec system's
observable surface is rich enough (constructors return data,
normalization returns data, validation returns structured
reports) that internal inspection is rarely needed.

### 2.3 Test Tiers

**Core** — Tests that validate MUST-level rules. The minimum
conformance bar. An implementation passes conformance if and
only if all Core tests pass.

**Extended** — Tests that validate SHOULD-level rules, edge
cases, or quality-of-implementation concerns. They strengthen
confidence but are not required for conformance.

**Draft** — Tests gated on ambiguity-surface findings or
unresolved spec questions. Promoted to Core or Extended when
the gating issue is resolved.

### 2.4 Traceability

Every test case includes a `rules` field listing one or more
rule IDs from the companion specification. The coverage matrix
(§7) maps rule IDs to test IDs. A failing test can be traced:

```
test ID → rules field → rule ID → spec section
```

---

## 3. Coverage Model

### 3.1 Coverage Counting

A rule is **covered** if at least one test case lists it in
its `rules` field and that test has tier Core or Extended.

A rule has **Core coverage** if at least one covering test
has tier Core.

### 3.2 Blocking vs Non-Blocking

Tests for MUST-level rules are Core. Tests for SHOULD-level
rules are Extended. Tests for implementation-quality concerns
that do not map to a specific normative strength are Extended.

### 3.3 Complete Core Coverage

Core coverage is complete when every MUST-level rule from the
spec has at least one Core test. The coverage matrix in §7
tracks this.

---

## 4. Test Categories

### 4.1 Category Index

| Category | ID prefix | Intent |
|---|---|---|
| Constructor output | SS-CON | Constructors produce correct data |
| Serializable domain | SS-SER | Output belongs to the allowed data domain |
| Normalization — spec | SS-NS | SpecModule normalization behavior |
| Normalization — test plan | SS-NTP | TestPlanModule normalization behavior |
| Normalization — structural rejection | SS-NR | Normalization rejects invalid input |
| Registry construction | SS-REG | Registry builds correct indices |
| Validation — identity | SS-V1 | V1 checks detect violations |
| Validation — linkage | SS-V2 | V2 checks detect violations |
| Validation — coverage | SS-V3 | V3 checks detect violations |
| Validation — amendments | SS-V4V5 | V4 and V5 checks detect violations |
| Validation — graph | SS-V6 | V6 checks detect violations |
| Validation — terms/concepts | SS-V7 | V7 checks detect violations |
| Validation — stale refs | SS-V8 | V8 checks detect violations |
| Validation — error codes | SS-V9 | V9 checks detect violations |
| Readiness | SS-RDY | V10 readiness computation |
| Traversal | SS-TRV | Walk/collect utilities |

---

## 5. Detailed Test Inventory

### 5.1 Constructor Output (SS-CON)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-CON-001 | Core | Normative | A4, A5 | `Spec()` produces serializable `SpecModule` | Call `Spec()` with valid args | Return value has `tisyn_spec: "spec"`, all required fields present, JSON-round-trip safe |
| SS-CON-002 | Core | Normative | A4, A5 | `TestPlan()` produces serializable `TestPlanModule` | Call `TestPlan()` with valid args | Return value has `tisyn_spec: "test-plan"`, all required fields present, JSON-round-trip safe |
| SS-CON-003 | Core | Normative | A4, A5 | `Section()` produces `SpecSection` | Call `Section()` with valid args | Return value has `tisyn_spec: "section"` |
| SS-CON-004 | Core | Normative | A4, A5 | `Rule()` produces `RuleDeclaration` | Call `Rule()` with valid args | Return value has `tisyn_spec: "rule"`, correct `id`, `strength`, `statement` |
| SS-CON-005 | Core | Normative | A4, A5 | `ErrorCode()` produces `ErrorCodeDeclaration` | Call `ErrorCode()` with valid args | Return value has `tisyn_spec: "error-code"`, correct `code`, `trigger` |
| SS-CON-006 | Core | Normative | A4, A5 | `TestCase()` produces `TestCase` | Call `TestCase()` with valid args | Return value has `tisyn_spec: "test"`, correct `tier`, `rules` |
| SS-CON-007 | Core | Normative | A4, A5 | `Covers()` produces `CoverageEntry` | Call `Covers()` with valid args | Return value has `ruleId` and `testIds` fields |
| SS-CON-008 | Core | Normative | A4, A5 | `Ambiguity()` produces `AmbiguityFinding` | Call `Ambiguity()` with valid args | Return value has `resolution` as `Resolution` enum value |
| SS-CON-009 | Core | Normative | A4 | Constructor purity | Call `Rule()` twice with same args | Return values are structurally identical (`deepEqual`) |
| SS-CON-010 | Core | Normative | A4, A5 | All 21 constructors produce data in serializable domain | Call each constructor with valid args, JSON-round-trip each | All round-trip successfully; no `undefined`, functions, or class instances |
| SS-CON-011 | Core | Normative | A6 | Discriminants are string literals | Inspect `tisyn_spec` on `Spec()`, `Rule()`, `TestCase()` outputs | Each is a plain string, not an enum value object |
| SS-CON-012 | Core | Normative | A7 | No `tisyn` or `tisyn_config` field on spec data | Inspect all discriminated constructor outputs | None carries `tisyn` or `tisyn_config` |
| SS-CON-013 | Core | Normative | A8 | Enum values serialize to string backing | Create `SpecModule` with `status: Status.Active`, serialize to JSON | JSON contains `"active"`, not `Status.Active` |
| SS-CON-014 | Core | Normative | A4, A5 | `Concept()`, `Invariant()`, `Term()`, `DependsOn()`, `Amends()`, `Complements()`, `ImplementsSpec()`, `Amendment()`, `ChangedSection()`, `UnchangedSection()`, `TestCategory()`, `NonTest()` each produce correct shape | Call each with valid args | Each has expected fields and discriminant (where applicable) |

### 5.2 Serializable Domain (SS-SER)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-SER-001 | Core | Normative | A3, A5, §3.1 | Allowed primitives pass | Module with `null`, `boolean`, `number`, `string` values in prose fields | Normalization accepts |
| SS-SER-002 | Core | Normative | A5, §3.2 | `undefined` in constructor output rejected | Construct a module containing `undefined` in a field | Normalization rejects (N8) |
| SS-SER-003 | Core | Normative | A5, §3.2 | `NaN` in constructor output rejected | Construct a module with `NaN` in a numeric field | Normalization rejects |
| SS-SER-004 | Core | Normative | A5, §3.2 | `Infinity` rejected | Construct a module with `Infinity` | Normalization rejects |
| SS-SER-005 | Extended | Normative | A5, §3.2 | Class instance rejected | Construct a module with `new Date()` in a field | Normalization rejects |
| SS-SER-006 | Extended | Normative | A5, §3.2 | Function in field rejected | Construct a module with a function value | Normalization rejects |

### 5.3 Normalization — SpecModule (SS-NS)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-NS-001 | Core | Normative | N1, N2, D38 | Normalization preserves authored fields | Normalize a valid `SpecModule` | All authored fields in output match input exactly |
| SS-NS-002 | Core | Normative | N3, D38 | Normalized spec has `_sectionNumbering` | Normalize a valid `SpecModule` | `_sectionNumbering` is a `Record<string, string>` |
| SS-NS-003 | Core | Normative | N3, D38 | Normalized spec has `_ruleLocations` | Normalize a valid `SpecModule` | `_ruleLocations` is a `Record<string, string>` |
| SS-NS-004 | Core | Normative | N3, D38 | Normalized spec has `_hash` | Normalize a valid `SpecModule` | `_hash` is a non-empty string |
| SS-NS-005 | Core | Normative | N3, D38 | Normalized spec has `_normalizedAt` | Normalize a valid `SpecModule` | `_normalizedAt` is an ISO 8601 string |
| SS-NS-006 | Core | Normative | N4 | Section numbering depth-first | Module with sections `[A, [A1, A2], B]` | `_sectionNumbering` maps A→§1, A1→§1.1, A2→§1.2, B→§2 |
| SS-NS-007 | Core | Normative | N4 | Nested section numbering | Three-level nesting | Third level is §X.Y.Z |
| SS-NS-008 | Core | Normative | N5 | Rule locations resolve against section numbering | Rule with `section: "child-alloc"`, section "child-alloc" is §3.1 | `_ruleLocations["SP-R1"]` === `"§3.1"` |
| SS-NS-009 | Core | Normative | N5 | Rule with invalid section reference fails normalization | Rule references section `"nonexistent"` | Normalization returns error |
| SS-NS-010 | Core | Normative | N6 | Hash is deterministic | Normalize same module twice | Both `_hash` values are identical |
| SS-NS-011 | Core | Normative | N6 | Hash does not depend on `_normalizedAt` | Normalize same module at different times | `_hash` is identical despite different `_normalizedAt` |
| SS-NS-012 | Core | Normative | N9 | One artifact per module | Normalize one `SpecModule` | Exactly one JSON artifact produced |
| SS-NS-013 | Core | Normative | N11 | Artifact is valid JSON | Read emitted artifact file | `JSON.parse()` succeeds; result matches normalized output |
| SS-NS-014 | Core | Normative | N12 | Normalization is deterministic | Normalize same module twice (excluding `_normalizedAt`) | Byte-identical output (excluding `_normalizedAt`) |
| SS-NS-015 | Core | Normative | N13 | Staleness detection ignores `_normalizedAt` | Compare two artifacts differing only in `_normalizedAt` | Treated as equivalent |
| SS-NS-016 | Core | Normative | LB2 | Normalization does not modify authored fields | Compare authored module fields before and after normalization | All authored fields are identical |

### 5.4 Normalization — TestPlanModule (SS-NTP)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-NTP-001 | Core | Normative | N1, D39 | Normalized test plan has `_hash` and `_normalizedAt` | Normalize a valid `TestPlanModule` | `_hash` and `_normalizedAt` present |
| SS-NTP-002 | Core | Normative | D39 | Normalized test plan does NOT have `_sectionNumbering` | Normalize a valid `TestPlanModule` | `_sectionNumbering` is absent |
| SS-NTP-003 | Core | Normative | D39 | Normalized test plan does NOT have `_ruleLocations` | Normalize a valid `TestPlanModule` | `_ruleLocations` is absent |
| SS-NTP-004 | Core | Normative | N2, LB2 | Test-plan authored fields preserved | Compare authored fields before and after normalization | All authored fields identical |
| SS-NTP-005 | Core | Normative | N6 | Test-plan hash is deterministic | Normalize same test plan twice | `_hash` values identical |

### 5.5 Normalization — Structural Rejection (SS-NR)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-NR-001 | Core | Normative | D1, N7, N8 | Empty spec `id` rejected | `SpecModule` with `id: ""` | Normalization returns error |
| SS-NR-002 | Core | Normative | D2, N7, N8 | Empty spec `version` rejected | `SpecModule` with `version: ""` | Normalization returns error |
| SS-NR-003 | Core | Normative | D4, N7, N8 | Empty `sections` array rejected | `SpecModule` with `sections: []` | Normalization returns error |
| SS-NR-004 | Core | Normative | D6, N7, N8 | Empty test-plan `id` rejected | `TestPlanModule` with `id: ""` | Normalization returns error |
| SS-NR-005 | Core | Normative | D11, N7, N8 | Duplicate section IDs rejected | Two sections with same `id` | Normalization returns error |
| SS-NR-006 | Core | Normative | D11, N7 | Duplicate section IDs across nesting levels rejected | Top-level and nested section with same `id` | Normalization returns error |
| SS-NR-007 | Core | Normative | D13, N7, N8 | Rule with invalid section ref rejected | Rule references nonexistent section ID | Normalization returns error |
| SS-NR-008 | Core | Normative | D15, N7 | Rule with empty `statement` rejected | `Rule()` with `statement: ""` | Normalization returns error |
| SS-NR-009 | Core | Normative | D16, N7 | Error code with empty `code` rejected | `ErrorCode()` with `code: ""` | Normalization returns error |
| SS-NR-010 | Core | Normative | D17, N7 | Error code with invalid section ref rejected | Error code references nonexistent section | Normalization returns error |
| SS-NR-011 | Core | Normative | D18, N7 | Error code with empty `trigger` rejected | `ErrorCode()` with `trigger: ""` | Normalization returns error |
| SS-NR-012 | Core | Normative | D19, N7 | Error code with empty `requiredContent` array rejected | `ErrorCode()` with `requiredContent: []` | Normalization returns error |
| SS-NR-013 | Core | Normative | D8, N7, N8 | `coreTier` mismatch rejected | `coreTier: 5` but only 3 Core tests | Normalization returns error |
| SS-NR-014 | Core | Normative | D9, N7 | `extendedTier` mismatch rejected | `extendedTier: 2` but only 1 Extended test | Normalization returns error |
| SS-NR-015 | Core | Normative | D26, N7 | Empty `specId` in `DependsOn` rejected | `DependsOn("")` | Normalization returns error |
| SS-NR-016 | Core | Normative | D32, N7 | `TestCase` with empty `rules` rejected | `TestCase()` with `rules: []` | Normalization returns error |
| SS-NR-017 | Core | Normative | D30, N7 | `TestCase` with empty `id` rejected | `TestCase()` with `id: ""` | Normalization returns error |

### 5.6 Registry Construction (SS-REG)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-REG-001 | Core | Normative | R1 | `buildRegistry()` accepts normalized modules | Pass arrays of `NormalizedSpecModule` and `NormalizedTestPlanModule` | Returns `SpecRegistry` |
| SS-REG-002 | Core | Normative | R2, LB3 | Registry requires only normalized artifacts | Build registry from JSON-parsed artifacts (not TypeScript source) | Succeeds identically to building from normalization output |
| SS-REG-003 | Core | Normative | R3 | `specs` map indexes by id | Registry with two specs | `specs.get("spec-a")` and `specs.get("spec-b")` return correct modules |
| SS-REG-004 | Core | Normative | R4 | `testPlans` map indexes by id | Registry with two test plans | `testPlans.get("plan-a")` returns correct module |
| SS-REG-005 | Core | Normative | R5, D40 | `ruleIndex` maps rule IDs to locations | Spec with rules `["X-R1", "X-R2"]` | `ruleIndex.get("X-R1")` returns `{ specId, section, strength }` |
| SS-REG-006 | Core | Normative | R5 | `ruleIndex` includes invariant IDs | Spec with invariant `"X-I1"` | `ruleIndex.get("X-I1")` returns location |
| SS-REG-007 | Core | Normative | R6, D41 | `errorCodeIndex` maps codes to locations | Spec with error code `"E-TEST-001"` | `errorCodeIndex.get("E-TEST-001")` returns `{ specId, section, trigger }` |
| SS-REG-008 | Core | Normative | R7 | `termAuthority` maps terms to defining spec | Spec defines term `"compound-external"` | `termAuthority.get("compound-external")` returns spec ID |
| SS-REG-009 | Core | Normative | R8, D42 | `conceptIndex` maps concepts to locations | Spec exports concept `"spawn-handle"` | `conceptIndex.get("spawn-handle")` returns `{ specId, section, description }` |
| SS-REG-010 | Extended | Normative | R13 | Registry is not persisted | Build registry twice from same artifacts | Both are independent in-memory values |

### 5.7 Validation — Identity and Uniqueness (SS-V1)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-V1-001 | Core | Normative | V1-1 | Empty spec `id` flagged | Registry with spec `id: ""` | `errors` contains V1 error |
| SS-V1-002 | Core | Normative | V1-2 | Empty test-plan `id` flagged | Registry with test plan `id: ""` | `errors` contains V1 error |
| SS-V1-003 | Core | Normative | V1-3 | Duplicate spec `id` flagged | Two specs with same `id` | `errors` contains V1 error |
| SS-V1-004 | Core | Normative | V1-4 | Duplicate test-plan `id` flagged | Two test plans with same `id` | `errors` contains V1 error |
| SS-V1-005 | Core | Normative | V1-5 | Duplicate rule ID across specs flagged | Two specs each defining rule `"X-R1"` | `errors` contains V1 error |
| SS-V1-006 | Core | Normative | V1-6 | Duplicate error code across specs flagged | Two specs each defining error code `"E-DUP"` | `errors` contains V1 error |
| SS-V1-007 | Core | Normative | VA1, VA2 | Clean corpus produces no errors | Registry with no violations | `errors` is empty |

### 5.8 Validation — Linkage (SS-V2)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-V2-001 | Core | Normative | V2-1 | Orphaned test plan flagged | Test plan with `testsSpec` pointing to nonexistent spec | `errors` contains V2 error |
| SS-V2-002 | Extended | Normative | V2-2 | Version mismatch warned | Test plan `testsSpec.version: "0.1.0"`, spec version `"0.2.0"` | `warnings` contains V2 warning |
| SS-V2-003 | Extended | Normative | V2-3 | Active spec without test plan warned | Spec with `Status.Active`, no companion test plan | `warnings` contains V2 warning |

### 5.9 Validation — Rule Coverage (SS-V3)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-V3-001 | Core | Normative | V3-1 | Coverage entry referencing nonexistent rule flagged | `Covers("FAKE-R1", ...)` where `"FAKE-R1"` not in spec | `errors` contains V3 error |
| SS-V3-002 | Core | Normative | V3-2 | Coverage entry referencing nonexistent test ID flagged | `Covers("X-R1", ["FAKE-T1"])` where `"FAKE-T1"` not in plan | `errors` contains V3 error |
| SS-V3-003 | Core | Normative | V3-3 | Test case referencing nonexistent rule flagged | `TestCase()` with `rules: ["NONEXISTENT"]` | `errors` contains V3 error |
| SS-V3-004 | Extended | Normative | V3-4 | Uncovered rule warned | Spec has rule `"X-R1"`, test plan has no `Covers("X-R1", ...)` | `warnings` contains V3 warning |
| SS-V3-005 | Extended | Normative | V3-5 | Rule without Core test warned | Rule covered only by Extended tests | `warnings` contains V3 warning |
| SS-V3-006 | Extended | Normative | V3-6 | Tier count mismatch warned | `coreTier: 10` but 9 actual Core tests | `warnings` contains V3 warning |

### 5.10 Validation — Amendments (SS-V4V5)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-V4V5-001 | Core | Normative | V4-1 | Amendment targeting nonexistent spec flagged | `Amends("nonexistent")` | `errors` contains V4 error |
| SS-V4V5-002 | Core | Normative | V4-2 | Amendment targeting nonexistent section flagged | `Amends("spec-a", { sections: ["fake-section"] })` | `errors` contains V4 error |
| SS-V4V5-003 | Extended | Normative | V4-3 | Amendment without `amendment` field warned | Spec with non-empty `amends`, no `amendment` | `warnings` contains V4 warning |
| SS-V4V5-004 | Core | Normative | V5-1 | Changed section targeting nonexistent section flagged | `ChangedSection()` with section not in target | `errors` contains V5 error |
| SS-V4V5-005 | Core | Normative | V5-2 | Unchanged section targeting nonexistent section flagged | `UnchangedSection()` with section not in target | `errors` contains V5 error |
| SS-V4V5-006 | Core | Normative | V5-3 | Section in both changed and unchanged flagged | Same section in `changedSections` and `unchangedSections` | `errors` contains V5 error |
| SS-V4V5-007 | Extended | Normative | V5-4 | Incomplete section inventory warned | Changed + unchanged does not cover all target sections | `warnings` contains V5 warning |

### 5.11 Validation — Graph Integrity (SS-V6)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-V6-001 | Core | Normative | V6-1 | DependsOn target not found flagged | `DependsOn("nonexistent")` | `errors` contains V6 error |
| SS-V6-002 | Core | Normative | V6-2 | Complements target not found flagged | `Complements("nonexistent")` | `errors` contains V6 error |
| SS-V6-003 | Core | Normative | V6-3 | Dependency cycle flagged | A depends on B, B depends on A | `errors` contains V6 error |
| SS-V6-004 | Core | Normative | V6-3 | Transitive dependency cycle flagged | A→B→C→A | `errors` contains V6 error |
| SS-V6-005 | Core | Normative | V6-4 | Amendment cycle flagged | A amends B, B amends A | `errors` contains V6 error |
| SS-V6-006 | Extended | Normative | V6-5 | Dependency on superseded spec warned | Spec depends on spec with `Status.Superseded` | `warnings` contains V6 warning |
| SS-V6-007 | Core | Normative | V6-1 | Valid dependency resolves without error | A depends on B, both present | No V6 error |

### 5.12 Validation — Terms and Concepts (SS-V7)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-V7-001 | Extended | Normative | V7-1 | Duplicate term definition warned | Two specs define term `"durable stream"` | `warnings` contains V7 warning |
| SS-V7-002 | Extended | Normative | V7-2 | Conflicting concept export warned | Two specs export concept `"compound-external"` with different descriptions | `warnings` contains V7 warning |

### 5.13 Validation — Stale References (SS-V8)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-V8-001 | Core | Normative | V8-1 | Test referencing removed rule flagged | Test plan references `"X-R1"`, spec no longer defines it | `errors` contains V8 error |
| SS-V8-002 | Extended | Normative | V8-2 | Stale section reference in ambiguity finding warned | Ambiguity references section `"old-section"`, not in spec | `warnings` contains V8 warning |
| SS-V8-003 | Extended | Normative | V8-3 | Ambiguity with unrecognizable `resolvedIn` warned | `resolvedIn: "???"` | `warnings` contains V8 warning |

### 5.14 Validation — Error-Code Traceability (SS-V9)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-V9-001 | Extended | Normative | V9-1 | Empty trigger warned | Error code with empty `trigger` (if bypassing normalization) | `warnings` contains V9 warning |
| SS-V9-002 | Extended | Normative | V9-2 | Empty `requiredContent` array warned | Error code with `requiredContent: []` (if bypassing normalization) | `warnings` contains V9 warning |
| SS-V9-003 | Core | Normative | V9-3 | Error code colliding with rule ID flagged | Spec with error code `"X-R1"` and rule `"X-R1"` | `errors` contains V9 error |

> **Note on SS-V9-001 and SS-V9-002.** These checks are
> defensive re-checks of conditions already enforced by D18/D19
> during normalization. They fire only for artifacts produced by
> non-conforming normalizers. They are Extended because the
> primary enforcement is structural (normalization-time).

### 5.15 Readiness (SS-RDY)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-RDY-001 | Core | Normative | V10-1, V10-2, V10-3, V10-4, P1, P3 | Full readiness: all conditions met | Active spec + active test plan + full coverage + no unresolved ambiguity | `isReady()` returns `true` |
| SS-RDY-002 | Core | Normative | V10-1 | Readiness blocked by draft spec | Spec with `Status.Draft` | `isReady()` returns `false` |
| SS-RDY-003 | Core | Normative | V10-2, P1 | Readiness blocked by missing test plan | Active spec, no companion test plan | `isReady()` returns `false` |
| SS-RDY-004 | Core | Normative | V10-2 | Readiness blocked by draft test plan | Active spec + draft test plan | `isReady()` returns `false` |
| SS-RDY-005 | Core | Normative | V10-3 | Readiness blocked by coverage errors | Active pair but coverage has errors | `isReady()` returns `false` |
| SS-RDY-006 | Core | Normative | V10-4, P7 | Readiness blocked by unresolved ambiguity | Active pair, coverage passes, but ambiguity with `Resolution.Unresolved` | `isReady()` returns `false` |
| SS-RDY-007 | Core | Normative | V10-4 | Resolved and deferred ambiguity do not block readiness | Active pair, coverage passes, ambiguity with `Resolution.Resolved` | `isReady()` returns `true` |
| SS-RDY-008 | Core | Normative | D43 | `checkCoverage()` returns `CoverageReport` with `uncoveredRules` | Spec with 3 rules, test plan covers 2 | `uncoveredRules` contains the uncovered rule ID |

### 5.16 Traversal (SS-TRV)

| ID | Tier | Evidence | Rules | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| SS-TRV-001 | Core | Normative | §11.4 | `collectRules()` returns all rules | Module with 3 rules | Returns array of 3 `RuleDeclaration` values |
| SS-TRV-002 | Core | Normative | §11.4 | `collectErrorCodes()` returns all error codes | Module with 2 error codes | Returns array of 2 `ErrorCodeDeclaration` values |
| SS-TRV-003 | Core | Normative | §11.4 | `collectTerms()` returns all terms | Module with 1 term | Returns array of 1 `TermDefinition` value |
| SS-TRV-004 | Core | Normative | §11.4 | `walkSections()` visits all sections depth-first | Module with 3 sections (1 nested) | Visitor called 3 times in depth-first order |
| SS-TRV-005 | Extended | Normative | §11.4 | `collectRules()` on module with no rules | Module with empty `rules` | Returns empty array |

---

## 6. Ambiguity-Surface Inventory

| ID | Rules | Description | Blocks Core? | Recommendation |
|---|---|---|---|---|
| SS-AMB-001 | LB1 | "Authored module is the sole source of truth" is an architectural principle, not a testable observable property. No test can verify that something is the source of truth — only that normalization preserves it (which N2/LB2 test). | No | Accept LB1 as an architectural statement. Test its consequences (N2, LB2) rather than the principle itself. |
| SS-AMB-002 | LB4 | "Validation results MUST be derivable entirely from the registry" — testable only by verifying that `validateCorpus()` does not call normalization or load source files. This is an implementation architecture constraint, not a behavioral observable. | No | Treat as a design constraint verified by code review. SS-REG-002 partially covers this for registry construction. |
| SS-AMB-003 | R14 | "MUST NOT expose public graph-traversal APIs in the MVP" is a non-goal constraint, not a behavioral test. There is no public API to test for absence. | No | Accept as a design constraint. Non-goals are verified by inspection of the public API surface, not by test execution. |
| SS-AMB-004 | N10 | Artifact file path convention `<specsDir>/.tisyn-spec/<module-id>.json` — testability depends on whether normalization writes files directly or returns data that a caller writes. The spec does not prescribe the write mechanism. | No | Test the path derivation logic (given a module ID, the expected path is correct). Do not test file I/O behavior. |
| SS-AMB-005 | D33 | `TestCase.evidence` defaults to `EvidenceTier.Normative` if omitted — depends on whether the constructor fills the default or whether consumers apply the default at read time. | No | Test that when `evidence` is omitted from `TestCase()`, the resulting object either has `evidence: EvidenceTier.Normative` or does not have the field (and the spec says to default). Clarify in a future spec revision. Resolution: Deferred. |

---

## 7. Coverage Matrix

### 7.1 Authoring Rules (A1–A11)

| Rule | Tests | Core coverage? |
|---|---|---|
| A1 | SS-CON-001 | Yes |
| A2 | SS-CON-002 | Yes |
| A3 | SS-SER-001 | Yes |
| A4 | SS-CON-009, SS-CON-010 | Yes |
| A5 | SS-CON-010, SS-SER-002–006 | Yes |
| A6 | SS-CON-011 | Yes |
| A7 | SS-CON-012 | Yes |
| A8 | SS-CON-013 | Yes |
| A9 | (design constraint — see §8) | N/A |
| A10 | (design constraint — see §8) | N/A |
| A11 | (design constraint — see §8) | N/A |

### 7.2 Data Model Rules (D1–D43)

| Rule | Tests | Core coverage? |
|---|---|---|
| D1 | SS-NR-001 | Yes |
| D2 | SS-NR-002 | Yes |
| D3 | SS-CON-013 | Yes |
| D4 | SS-NR-003 | Yes |
| D5 | (SHOULD — no Core test required) | Extended via SS-V4V5-003 |
| D6 | SS-NR-004 | Yes |
| D7 | SS-V2-001 | Yes |
| D8 | SS-NR-013 | Yes |
| D9 | SS-NR-014 | Yes |
| D10 | SS-NS-006 | Yes |
| D11 | SS-NR-005, SS-NR-006 | Yes |
| D12 | SS-V1-005 | Yes |
| D13 | SS-NR-007 | Yes |
| D14 | SS-CON-004 | Yes |
| D15 | SS-NR-008 | Yes |
| D16 | SS-NR-009, SS-V1-006 | Yes |
| D17 | SS-NR-010 | Yes |
| D18 | SS-NR-011 | Yes |
| D19 | SS-NR-012 | Yes |
| D20 | SS-CON-014 | Yes |
| D21 | SS-CON-014 | Yes |
| D22 | SS-REG-006 | Yes |
| D23 | SS-CON-014 | Yes (structural shape); no dedicated rejection test |
| D24 | SS-CON-014 | Yes |
| D25 | SS-CON-014 | Yes (structural shape); no dedicated rejection test |
| D26 | SS-NR-015 | Yes |
| D27 | SS-V4V5-002 | Yes |
| D28 | SS-CON-014 | Yes |
| D29 | SS-CON-014 | Yes |
| D30 | SS-NR-017 | Yes |
| D31 | SS-CON-006 | Yes |
| D32 | SS-NR-016 | Yes |
| D33 | SS-AMB-005 | Deferred |
| D34 | SS-V3-001 | Yes |
| D35 | SS-V3-002 | Yes |
| D36 | SS-CON-008 | Yes |
| D37 | (SHOULD — no Core test required) | N/A |
| D38 | SS-NS-001–005 | Yes |
| D39 | SS-NTP-001–003 | Yes |
| D40 | SS-REG-005 | Yes |
| D41 | SS-REG-007 | Yes |
| D42 | SS-REG-009 | Yes |
| D43 | SS-RDY-008 | Yes |

### 7.3 Normalization Rules (N1–N15)

| Rule | Tests | Core coverage? |
|---|---|---|
| N1 | SS-NS-001, SS-NTP-001 | Yes |
| N2 | SS-NS-001, SS-NS-016, SS-NTP-004 | Yes |
| N3 | SS-NS-002–005, SS-NTP-001–003 | Yes |
| N4 | SS-NS-006, SS-NS-007 | Yes |
| N5 | SS-NS-008, SS-NS-009 | Yes |
| N6 | SS-NS-010, SS-NS-011, SS-NTP-005 | Yes |
| N7 | SS-NR-001–017 | Yes |
| N8 | SS-NR-001–017 | Yes |
| N9 | SS-NS-012 | Yes |
| N10 | SS-AMB-004 | Deferred |
| N11 | SS-NS-013 | Yes |
| N12 | SS-NS-014 | Yes |
| N13 | SS-NS-015 | Yes |
| N14 | (commit policy — see §8) | N/A |
| N15 | (CI recommendation — see §8) | N/A |

### 7.4 Registry Rules (R1–R14)

| Rule | Tests | Core coverage? |
|---|---|---|
| R1 | SS-REG-001 | Yes |
| R2 | SS-REG-002 | Yes |
| R3 | SS-REG-003 | Yes |
| R4 | SS-REG-004 | Yes |
| R5 | SS-REG-005, SS-REG-006 | Yes |
| R6 | SS-REG-007 | Yes |
| R7 | SS-REG-008 | Yes |
| R8 | SS-REG-009 | Yes |
| R9–R12 | (internal — see §8) | N/A |
| R13 | SS-REG-010 | Extended |
| R14 | SS-AMB-003 | N/A |

### 7.5 Validation Rules (V1-1–V10-4)

| Rule | Tests | Core coverage? |
|---|---|---|
| V1-1 | SS-V1-001 | Yes |
| V1-2 | SS-V1-002 | Yes |
| V1-3 | SS-V1-003 | Yes |
| V1-4 | SS-V1-004 | Yes |
| V1-5 | SS-V1-005 | Yes |
| V1-6 | SS-V1-006 | Yes |
| V2-1 | SS-V2-001 | Yes |
| V2-2 | SS-V2-002 | Extended |
| V2-3 | SS-V2-003 | Extended |
| V3-1 | SS-V3-001 | Yes |
| V3-2 | SS-V3-002 | Yes |
| V3-3 | SS-V3-003 | Yes |
| V3-4 | SS-V3-004 | Extended |
| V3-5 | SS-V3-005 | Extended |
| V3-6 | SS-V3-006 | Extended |
| V4-1 | SS-V4V5-001 | Yes |
| V4-2 | SS-V4V5-002 | Yes |
| V4-3 | SS-V4V5-003 | Extended |
| V5-1 | SS-V4V5-004 | Yes |
| V5-2 | SS-V4V5-005 | Yes |
| V5-3 | SS-V4V5-006 | Yes |
| V5-4 | SS-V4V5-007 | Extended |
| V6-1 | SS-V6-001, SS-V6-007 | Yes |
| V6-2 | SS-V6-002 | Yes |
| V6-3 | SS-V6-003, SS-V6-004 | Yes |
| V6-4 | SS-V6-005 | Yes |
| V6-5 | SS-V6-006 | Extended |
| V7-1 | SS-V7-001 | Extended |
| V7-2 | SS-V7-002 | Extended |
| V8-1 | SS-V8-001 | Yes |
| V8-2 | SS-V8-002 | Extended |
| V8-3 | SS-V8-003 | Extended |
| V9-1 | SS-V9-001 | Extended |
| V9-2 | SS-V9-002 | Extended |
| V9-3 | SS-V9-003 | Yes |
| V10-1 | SS-RDY-002 | Yes |
| V10-2 | SS-RDY-003, SS-RDY-004 | Yes |
| V10-3 | SS-RDY-005 | Yes |
| V10-4 | SS-RDY-006, SS-RDY-007 | Yes |

### 7.6 Pair Semantics Rules (P1–P14)

| Rule | Tests | Core coverage? |
|---|---|---|
| P1 | SS-RDY-003 | Yes |
| P2 | SS-V2-001 | Yes |
| P3 | SS-RDY-001 | Yes |
| P4 | SS-CON-008 | Yes |
| P5 | (persistence — design constraint, see §8) | N/A |
| P6 | SS-CON-008 | Yes |
| P7 | SS-RDY-006 | Yes |
| P8 | SS-RDY-001 | Yes |
| P9 | (SHOULD — no Core test required) | N/A |
| P10 | (tier promotion — design constraint) | N/A |
| P11 | SS-V3-005 | Extended |
| P12 | SS-CON-006 | Yes |
| P13 | (evidence boundary — design constraint) | N/A |
| P14 | SS-AMB-005 | Deferred |

### 7.7 Traceability Rules (T1–T6)

| Rule | Tests | Core coverage? |
|---|---|---|
| T1 | SS-REG-005, SS-REG-007 | Yes |
| T2 | SS-NR-016 | Yes |
| T3 | SS-REG-005, SS-REG-007 | Yes |
| T4 | SS-V1-005 | Yes |
| T5 | (convention — not enforced, see §8) | N/A |
| T6 | SS-CON-005 | Yes |

### 7.8 Layer Boundary Rules (LB1–LB4)

| Rule | Tests | Core coverage? |
|---|---|---|
| LB1 | SS-AMB-001 | N/A (architectural) |
| LB2 | SS-NS-016, SS-NTP-004 | Yes |
| LB3 | SS-REG-002 | Yes |
| LB4 | SS-AMB-002 | N/A (architectural) |

### 7.9 Validation Structure Rules (VA1–VA2)

| Rule | Tests | Core coverage? |
|---|---|---|
| VA1 | SS-V1-007 | Yes |
| VA2 | SS-V1-007 | Yes |

### 7.10 Non-Goal Rules (NG1–NG11)

| Rule | Tests | Core coverage? |
|---|---|---|
| NG1 | SS-X-005 | N/A (non-goal) |
| NG2 | SS-X-005 | N/A (non-goal) |
| NG3 | SS-X-005 | N/A (non-goal) |
| NG4 | SS-X-005 | N/A (non-goal) |
| NG5 | SS-X-005 | N/A (non-goal) |
| NG6 | SS-X-005 | N/A (non-goal) |
| NG7 | SS-X-005 | N/A (non-goal) |
| NG8 | SS-X-005 | N/A (non-goal) |
| NG9 | SS-X-005 | N/A (non-goal) |
| NG10 | SS-X-005 | N/A (non-goal) |
| NG11 | SS-X-005 | N/A (non-goal) |

---

## 8. Explicit Non-Tests

| ID | Description | Reason |
|---|---|---|
| SS-X-001 | Import restriction enforcement (A9) | A9 is a source-level authoring rule. Enforcement is via TypeScript compilation or lint, not via `@tisyn/spec` runtime behavior. No API exists to test. |
| SS-X-002 | Helper module exclusion from discovery (A11) | File discovery is a build-tool concern. The spec defines the convention; the test plan tests constructors, normalization, and validation. |
| SS-X-003 | Artifact commit policy (N14) | Committing files to a repository is a git operation, not a package API. CI staleness enforcement (N15) is tested via normalization determinism (SS-NS-014, SS-NS-015). |
| SS-X-004 | Registry internal structures (R9–R12) | Internal by design (§7.4). Tested indirectly through validation checks that require them (cycle detection, dependency resolution). |
| SS-X-005 | Deferred public APIs (R14, NG1–NG11) | Explicitly excluded from MVP. No API to test. |
| SS-X-006 | Rule ID naming convention (T5) | Convention is recommended, not enforced. Uniqueness is tested (SS-V1-005). |
| SS-X-007 | Ambiguity persistence across versions (P5) | Design constraint about data lifecycle, not runtime behavior. |
| SS-X-008 | Tier promotion mechanics (P10) | Design workflow guidance, not runtime behavior. |

---

## 9. Readiness Criteria

### 9.1 Core Coverage Completeness

Core coverage is complete when every MUST-level rule from the
companion specification has at least one Core test.

Based on the coverage matrix (§7), the current plan achieves
Core coverage for all MUST-level rules. Rules classified as
SHOULD have Extended coverage. Rules that are architectural
principles or design constraints are accounted for as
non-tests (§8) or ambiguity-surface findings (§6).

### 9.2 Spec/Test-Plan Pair Readiness

This test plan is ready for implementation when:

1. All Core tests have unambiguous expected outcomes.
2. All ambiguity-surface findings are either resolved or
   explicitly deferred with non-blocking status.
3. The coverage matrix accounts for every numbered rule.

### 9.3 Tier Counts

| Tier | Count |
|---|---|
| Core | 101 |
| Extended | 18 |
| Draft | 0 |
| **Total** | **119** |
| Non-tests | 8 |
| Ambiguity findings | 5 (0 blocking) |
