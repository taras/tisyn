# Tisyn Configuration Test Plan

**Validates:** Tisyn Configuration Specification
**Style reference:** Blocking Scope Conformance Test Plan

---

## 1. Purpose

This document defines the conformance test plan for the
Tisyn Configuration Specification. An implementation of
`@tisyn/config` proves conformance by passing all tests
marked **P0** (blocking). Tests marked **P1** are
recommended but not blocking for initial conformance.

## 2. Scope

This test plan covers:

- Constructor behavior and descriptor formation
- Portable serializable data domain compliance
- Descriptor validation rules (V1–V17)
- Workflow reference semantics
- Entrypoint overlay application
- Environment reference model
- Resolution boundary and startup ordering
- Secret handling and redaction
- Resolution pipeline projection (CT-PROJECT)

> **Partially active:** `Config.useConfig(Token)` semantic contract (R1–R4) is
> partially covered by integration tests in
> `packages/runtime/src/use-config-integration.test.ts`. CFG-USE-001 through
> CFG-USE-004 and CFG-USE-009 are active at P1. CFG-USE-005 through
> CFG-USE-008 (projection shape MAY assertions) remain deferred.

This test plan does NOT cover:

- CLI flag parsing or help generation (CLI test plan)
- Workflow invocation input derivation (CLI test plan)
- IR semantics (system specification)
- Transport protocol behavior (transport specification)

## 3. Conformance Targets

| Target | Package | Description |
| --- | --- | --- |
| **CT-CONSTRUCT** | `@tisyn/config` | Constructors produce conforming descriptors |
| **CT-VALIDATE** | `@tisyn/config` | Config-owned validation rejects invalid descriptors |
| **CT-WALK** | `@tisyn/config` | Descriptor walking discovers env nodes |
| **CT-RESOLVE** | `@tisyn/runtime` | Environment resolution produces correct values |
| **CT-OVERLAY** | `@tisyn/runtime` | Entrypoint overlay merge is correct |
| **CT-USECONFIG** | `@tisyn/compiler` + `@tisyn/runtime` | `Config.useConfig(Token)` compiles to `__config` effect and runtime exposes resolved projection — partially active |
| **CT-PROJECT** | `@tisyn/runtime` | Resolution pipeline produces correct projections (MVP replacement for CT-USECONFIG) |

## 4. Test Strategy

### 4.1 Priority Model

- **P0** tests correspond to **MUST** behavior in the
  config specification. They are blocking conformance
  requirements. An implementation that fails any P0 test
  is non-conforming.
- **P1** tests correspond to **SHOULD**, **MAY**, or
  advisory behavior. They are recommended for quality but
  not blocking for initial conformance.

### 4.2 Assertion Style

Tests assert **normative semantic properties**, not
incidental representation details:

- Constructor tests assert the presence of spec-required
  fields (discriminant, kind, mode, required data) and
  normalization behavior. The config spec §3 defines
  interface shapes with explicit `readonly` fields — tests
  validate that these required fields are present and
  correct. Tests do not assert the absence of additional
  implementation-internal fields unless the spec prohibits
  them.
- Validation tests assert rejection of invalid inputs and
  acceptance of valid inputs.
- Resolution tests assert correct resolved values.
- Projection tests assert correct resolved output shapes
  from the resolution pipeline.

Where multiple tests exercise variants of the same rule,
they MAY be implemented as parameterized cases under one
conformance requirement.

### 4.3 Test Types

- **Unit tests.** Pure function input/output. No I/O.
  Covers constructors, validation, walking.
- **Integration tests.** Descriptor + runtime resolution.
  Requires process environment manipulation.
- **Behavioral tests.** `Config.useConfig(Token)` contract
  verification. Partially active: CFG-USE-001–004 and
  CFG-USE-009 covered by integration tests. CFG-USE-005–008
  remain deferred.

## 5. Fixture Strategy

| Family | Purpose | Min. fixtures | Used by |
| --- | --- | --- | --- |
| **F-MINIMAL** | Minimal valid descriptors | 1 single-agent | A, B, K |
| **F-MULTI** | Multi-agent with journal + entrypoints | 1 | F, G, K |
| **F-INVALID-CONFIG** | Invalid descriptors (V1–V10) | 1 per violation type | B |
| **F-INVALID-RUNTIME** | Runtime validation failures (V14–V17) | 1 per violation type | D |
| **F-COMPILER** | Compiler-integrated validation (V11–V13) | 1 with mismatched exports/contracts | C |
| **F-OVERLAY** | Base + entrypoint overlay pairs | 1 base + 2 overlays (replace, append, empty) | F |
| **F-ENV** | Env resolution and coercion | Optional, required, secret nodes with string/number/boolean defaults | G |
| **F-SECRET** | Secret redaction | 1 descriptor with secret env nodes | H |
| **F-USECONFIG** | Runtime behavioral | 1 minimal executable workflow with env + overlay | I |
| **F-SEPARATE** | Separate config module | 1 descriptor with `run.module` | E, K |

---

## 6. Test Matrix

### A. Constructor and Descriptor Formation

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CFG-CON-001 | P0 | Unit | §4.2, §3.2 | `workflow()` output has `tisyn_config: "workflow"` discriminant |
| CFG-CON-002 | P0 | Unit | §4.2, §3.2 | `workflow()` output has `run` field and non-empty `agents` array |
| CFG-CON-003 | P0 | Unit | §4.2 | `run: "hello"` (string shorthand) normalizes to a `WorkflowRef` with `export: "hello"` |
| CFG-CON-004 | P0 | Unit | §4.2 | `run: { export: "chat", module: "./w.ts" }` preserves both fields |
| CFG-CON-005 | P0 | Unit | §4.2, §3.4 | `agent()` output has `tisyn_config: "agent"`, the provided `id`, and the provided transport |
| CFG-CON-006 | P0 | Unit | §4.2, §3.5 | Each `transport.*` constructor produces `tisyn_config: "transport"` with the correct `kind` and spec-required fields for that kind (parameterized across all five built-in kinds) |
| CFG-CON-007 | P0 | Unit | §4.2, §3.6 | `env("X", v)` produces `tisyn_config: "env"`, `mode: "optional"`, the provided `name`, and a `default` matching `v` — for string, number, and boolean defaults (parameterized) |
| CFG-CON-008 | P0 | Unit | §4.2, §3.6 | `env.required("X")` produces `mode: "required"` and has no `default` field |
| CFG-CON-009 | P0 | Unit | §4.2, §3.6 | `env.secret("X")` produces `mode: "secret"` and has no `default` field |
| CFG-CON-010 | P0 | Unit | §4.2, §3.7 | `journal.file()` produces `tisyn_config: "journal"` with `kind: "file"` and the provided path |
| CFG-CON-011 | P0 | Unit | §4.2, §3.7 | `journal.memory()` produces `tisyn_config: "journal"` with `kind: "memory"` |
| CFG-CON-012 | P0 | Unit | §4.2, §3.8 | `entrypoint()` produces `tisyn_config: "entrypoint"` |
| CFG-CON-013 | P0 | Unit | §4.2, §3.9 | `server.websocket()` produces `tisyn_config: "server"` with `kind: "websocket"` and the provided port |
| CFG-CON-014 | P0 | Unit | §4.2 | Transport constructors accept `EnvDescriptor` in URL/command/path positions and the output contains the env node at the expected location |
| CFG-CON-015 | P0 | Unit | §3.1 | All constructor outputs belong to the portable serializable data domain — no `undefined`, `NaN`, `Infinity`, `Date`, `Symbol`, functions, class instances, or circular references |
| CFG-CON-016 | P0 | Unit | §8.2 | Constructors are pure — calling the same constructor with the same arguments produces observationally equivalent results |
| CFG-CON-017 | P1 | Unit | §4.3 | Extension constructor output with custom `kind` is within the serializable data domain |

**Note on CFG-CON-015.** The config spec §3.1 defines the
portable serializable data domain explicitly. JSON
round-trip MAY be used as a supplementary practical check,
but the normative definition is the domain enumeration.

**Note on CFG-CON-016.** The spec §8.2 requires
constructors to be pure and produce the same descriptor on
every evaluation. Tests validate this as observational
equivalence — the outputs have the same normatively required
fields and values. This does not require reference equality
or deep-equality of implementation-internal properties
beyond those defined by the spec.

### B. Descriptor Validation (V1–V10)

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CFG-VAL-001 | P0 | Unit | V1 | Node with missing `tisyn_config` → validation failure |
| CFG-VAL-002 | P0 | Unit | V1 | Node with unrecognized `tisyn_config` value → failure |
| CFG-VAL-003 | P0 | Unit | V2 | Missing `run` field → failure |
| CFG-VAL-004 | P0 | Unit | V2 | Empty string `run` → failure |
| CFG-VAL-005 | P0 | Unit | V2 | Empty `agents` array → failure |
| CFG-VAL-006 | P0 | Unit | V3 | Agent with empty `id` → failure |
| CFG-VAL-007 | P0 | Unit | V3 | Agent with missing transport → failure |
| CFG-VAL-008 | P0 | Unit | V4 | Duplicate agent `id` values → failure |
| CFG-VAL-009 | P0 | Unit | V5 | Transport with missing `kind` → failure |
| CFG-VAL-010 | P0 | Unit | V5 | Built-in transport missing required field for its kind → failure |
| CFG-VAL-011 | P0 | Unit | V6 | Optional env missing `default` → failure |
| CFG-VAL-012 | P0 | Unit | V6 | Required env with `default` present → failure |
| CFG-VAL-013 | P0 | Unit | V6 | Secret env with `default` present → failure |
| CFG-VAL-014 | P0 | Unit | V7 | Invalid entrypoint keys (uppercase, spaces, empty) → failure (parameterized) |
| CFG-VAL-015 | P0 | Unit | V8 | Values outside serializable domain → failure (parameterized: `Date`, function, `undefined`, `NaN`, `Infinity`) |
| CFG-VAL-016 | P0 | Unit | V9 | Node with both `tisyn_config` and `tisyn` → failure |
| CFG-VAL-017 | P0 | Unit | V10 | Base `WorkflowDescriptor` with `server` field → failure. The config spec §3.2 states: "The base `WorkflowDescriptor` MUST NOT include a `server` field." Server is introduced only via entrypoint overlays (§3.8, §3.9). |
| CFG-VAL-018 | P0 | Unit | V2 | Valid minimal descriptor passes validation |
| CFG-VAL-019 | P0 | Unit | V7 | Valid entrypoint keys (`"dev"`, `"staging-2"`) pass (parameterized) |

### C. Compiler-Integrated Validations (V11–V13)

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CFG-CIV-001 | P1 | Integration | V11 | Advisory: warning when `run.export` names a non-existent export |
| CFG-CIV-002 | P1 | Integration | V12 | Advisory: warning when agent `id` does not match a declared contract |
| CFG-CIV-003 | P1 | Integration | V13 | Advisory: warning when entrypoint agent `id` is not in base agents |

All compiler-integrated validations are SHOULD-level. P1.

### D. Runtime-Integrated Validations (V14–V17)

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CFG-RIV-001 | P0 | Integration | V14 | Missing required env variable → startup failure |
| CFG-RIV-002 | P0 | Integration | V14 | Missing secret env variable → startup failure |
| CFG-RIV-003 | P0 | Integration | V15 | Number coercion of non-numeric string → type error |
| CFG-RIV-004 | P0 | Integration | V15 | Boolean coercion of invalid string → type error |
| CFG-RIV-005 | **Deferred** | Integration | V16 | `run.module` pointing to nonexistent file → startup failure — **deferred: requires module resolution at startup** |
| CFG-RIV-006 | **Deferred** | Integration | V17 | Transport module that does not resolve → startup failure — **deferred: requires module resolution at startup** |

### E. Workflow Reference Semantics

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CFG-REF-001 | P0 | Unit | §3.3 | `WorkflowRef` with `export` only is structurally valid |
| CFG-REF-002 | P0 | Unit | §3.3 | `WorkflowRef` with `export` and `module` is structurally valid |
| CFG-REF-003 | P0 | Unit | §3.3 | `WorkflowRef` with empty `export` string is invalid |
| CFG-REF-004 | **Deferred** | Integration | §3.3 | `module` omitted → runtime resolves export from descriptor module — **deferred: requires module loader** |
| CFG-REF-005 | **Deferred** | Integration | §3.3 | `module` specified → runtime imports separate module — **deferred: requires module loader** |
| CFG-REF-006 | P0 | Unit | §3.8 | Entrypoint schema does not include a `run` field |

### F. Entrypoint Overlay Application

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CFG-OVR-001 | P0 | Unit | §7.3 | Omitted entrypoint fields inherit base values |
| CFG-OVR-002 | P0 | Unit | §7.3 | Entrypoint agent with matching `id` replaces base agent |
| CFG-OVR-003 | P0 | Unit | §7.3 | Entrypoint agent with non-matching `id` is appended |
| CFG-OVR-004 | P0 | Unit | §7.3 | Non-matching base agents are retained |
| CFG-OVR-005 | P0 | Unit | §7.3 | Entrypoint journal replaces base journal |
| CFG-OVR-006 | P0 | Unit | §7.3 | Entrypoint server is added (base has none) |
| CFG-OVR-007 | P0 | Unit | §7.3 | Entrypoint cannot contain a `run` field |
| CFG-OVR-008 | P0 | Unit | §7.3 | Empty entrypoint produces descriptor identical to base |
| CFG-OVR-009 | P0 | Unit | §7.3 | Multiple base agents with one replacement — non-replaced agents preserved in order |
| CFG-OVR-010 | P1 | Unit | §7.3 | Independent overlay applications are stateless |

**Note on CFG-OVR-003.** The config spec §7.3 states that
entrypoint agents with IDs not in the base are appended.
This is the current normative rule. Config spec open
question Q2 asks whether this should be restricted. If Q2
resolves differently, this test must be updated.

### G. Environment Reference Model

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CFG-ENV-001 | P0 | Integration | §5.2 | Optional env, variable set → env value used |
| CFG-ENV-002 | P0 | Integration | §5.2 | Optional env, variable unset → default used |
| CFG-ENV-003 | P0 | Integration | §5.2 | Required env, variable set → resolves to string |
| CFG-ENV-004 | P0 | Integration | §5.2 | Required env, variable unset → startup failure |
| CFG-ENV-005 | P0 | Integration | §5.2 | Secret env, variable set → resolves to string |
| CFG-ENV-006 | P0 | Integration | §5.2 | Secret env, variable unset → startup failure |
| CFG-ENV-007 | P0 | Integration | §5.4 | Number coercion: `"42"` with numeric default → `42` |
| CFG-ENV-008 | P0 | Integration | §5.4 | Boolean coercion: accepted values (`"true"/"1"` → `true`, `"false"/"0"` → `false`) (parameterized) |
| CFG-ENV-009 | P0 | Integration | §5.4 | Boolean coercion: invalid string (e.g., `"yes"`) → type error |
| CFG-ENV-010 | P0 | Integration | §5.4 | Number coercion: non-numeric string → NaN → type error |
| CFG-ENV-011 | P0 | Integration | §5.4 | Required env always resolves to `string` |
| CFG-ENV-012 | P0 | Integration | §5.4 | Secret env always resolves to `string` |
| CFG-ENV-013 | P0 | Unit | §5.3 | Walking discovers all env nodes across agents, journal, and server |
| CFG-ENV-014 | P0 | Unit | §5.3 | Walking discovers env nodes nested inside transport descriptors |
| CFG-ENV-015 | P0 | Integration | §7.1/6 | Multiple missing required env vars → ALL reported in single diagnostic |
| CFG-ENV-016 | P0 | Unit | §5.5 | Env node with a `value` property present is invalid |

**Note on CFG-ENV-015.** The config spec §7.1 step 6 uses
imperative language: "report ALL missing variables in a
single diagnostic and fail." This is MUST-level. P0.

### H. Secret Handling

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CFG-SEC-001 | P0 | Unit | §8.1 | `EnvSecretDescriptor` contains `name` only, no value field |
| CFG-SEC-002 | P0 | Integration | §8.1 | Resolved secret does not appear in validation error messages produced by config or runtime infrastructure |
| CFG-SEC-003 | P0 | Integration | §8.1 | Resolved secret does not appear in diagnostic or verbose output produced by config or runtime infrastructure |
| CFG-SEC-004 | P0 | Integration | §8.1 | Resolved secret does not appear in log output produced by config or runtime infrastructure |
| CFG-SEC-005 | P0 | Integration | §8.1 | Resolved secret IS present in projected config output (runtime memory, not a human-readable surface) |

**Note on redaction scope.** The config spec §8.1 enumerates
surfaces: diagnostic messages, log output, validation error
messages, command output, verbose/debug output, and any
other inspection/reporting/debugging surface. CFG-SEC-002
through CFG-SEC-004 validate the surfaces that config and
runtime infrastructure produce. Redaction within
application-level workflow code is outside scope.

### I. `Config.useConfig()` Semantic Contract

> **Partially active:** CFG-USE-001 through CFG-USE-004 and CFG-USE-009
> are active at P1, covered by integration tests in
> `packages/runtime/src/use-config-integration.test.ts`. CFG-USE-005 through
> CFG-USE-008 (projection shape MAY assertions) remain deferred.
> CT-PROJECT continues to validate the resolution pipeline independently.

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CFG-USE-001 | **P1** | Behavioral | R1 | `Config.useConfig(Token)` returns post-overlay config |
| CFG-USE-002 | **P1** | Behavioral | R1 | `Config.useConfig(Token)` returns post-resolution config (env nodes resolved) |
| CFG-USE-003 | **P1** | Behavioral | R2 | Return value contains no `EnvDescriptor` nodes |
| CFG-USE-004 | **P1** | Behavioral | R3 | Return value does not contain invocation-time workflow arguments |
| CFG-USE-005 | **Deferred** | Behavioral | R1 | Workflow does not observe intermediate descriptor forms |
| CFG-USE-006 | **Deferred** | Behavioral | §7.5.2 | Return value MAY omit `entrypoints` |
| CFG-USE-007 | **Deferred** | Behavioral | §7.5.2 | Return value MAY omit `tisyn_config` discriminants |
| CFG-USE-008 | **Deferred** | Behavioral | §7.5.2 | Return value MAY omit `WorkflowRef` metadata |
| CFG-USE-009 | **P1** | Behavioral | R3 | Invocation args delivered via function parameter, not `Config.useConfig(Token)` |

**Note on projection tests.** CFG-USE-006 through
CFG-USE-008 are P1 because the spec uses MAY. They
validate "permitted if implemented" — the implementation
conforms whether or not it omits these fields. The exact
projection shape is defined by companion runtime/compiler
specs.

### J. Resolution Order and Fail-Before-Execute

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CFG-ORD-001 | P0 | Integration | §7.1 | Entrypoint overlay (step 2) is applied before config validation (step 3). Tested by: an overlay that introduces a validation error (e.g., duplicate agent `id`) MUST be caught at step 3, proving validation runs on the merged descriptor. |
| CFG-ORD-002 | P0 | Integration | §7.1 | Config validation (step 3) occurs before environment resolution (step 5). Tested by: a descriptor that fails validation MUST fail before any environment variable is read. |
| CFG-ORD-003 | P0 | Integration | §7.2 | Steps 1–6 complete before any transport starts |
| CFG-ORD-004 | P0 | Integration | §7.2 | Steps 1–6 complete before any workflow executes |
| CFG-ORD-005 | P0 | Integration | §3.7 | Default journal is in-memory when no journal specified |

### K. Worked-Example Fixtures

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CFG-FIX-001 | P0 | Unit | §9.1 | Minimal workflow fixture produces valid descriptor |
| CFG-FIX-002 | P0 | Unit | §9.2 | Multi-agent chat fixture produces valid descriptor |
| CFG-FIX-003 | P0 | Unit | §9.3 | Separate-module fixture produces valid descriptor |
| CFG-FIX-004 | P0 | Unit | §9.4 | Walking §9.2 fixture discovers expected env nodes |
| CFG-FIX-005 | P0 | Unit | §9.5 | Secret fixture produces correct secret env node |
| CFG-FIX-006 | P0 | Unit | §9.7 | Duplicate agent IDs fixture fails validation (V4) |
| CFG-FIX-007 | P0 | Unit | §9.7 | Required env with default fixture fails validation (V6) |

---

## 7. Summary

| Category | P0 | P1 | Deferred | Total |
| --- | --- | --- | --- | --- |
| A. Constructors | 16 | 1 | 0 | 17 |
| B. Validation (V1–V10) | 19 | 0 | 0 | 19 |
| C. Compiler-integrated (V11–V13) | 0 | 3 | 0 | 3 |
| D. Runtime-integrated (V14–V17) | 4 | 0 | 2 | 6 |
| E. Workflow reference | 4 | 0 | 2 | 6 |
| F. Entrypoint overlays | 9 | 1 | 0 | 10 |
| G. Environment model | 16 | 0 | 0 | 16 |
| H. Secret handling | 5 | 0 | 0 | 5 |
| I. `Config.useConfig(Token)` | 0 | 5 | 4 | 9 |
| J. Resolution order | 5 | 0 | 0 | 5 |
| K. Worked-example fixtures | 7 | 0 | 0 | 7 |
| **Total** | **85** | **10** | **8** | **103** |

> **Scope note:** 8 tests remain deferred: 4 `Config.useConfig(Token)` projection
> shape tests (CFG-USE-005–008), 2 workflow-module resolution tests
> (require module loader), and 2 transport-module resolution tests (require
> module resolution at startup). 5 `Config.useConfig(Token)` behavioral tests are
> now active at P1, covered by CLI integration tests.

## 8. Assumptions

- Constructor tests are pure unit tests with no I/O.
- Environment resolution tests require `process.env`
  manipulation. Test infrastructure MUST restore env
  state after each test.
- `Config.useConfig(Token)` behavioral tests (Category I) are
  partially active. CFG-USE-001–004 and CFG-USE-009 are
  covered by CLI integration tests. CFG-USE-005–008
  remain deferred (projection shape MAY assertions).
- CFG-OVR-003 (entrypoint agent append) tests the current
  normative rule and is contingent on config spec Q2.
- Compiler-integrated validations (C) require metadata
  from a companion compiler. They are P1 and may be
  deferred until that integration exists.

## 9. Implementation Readiness

- Categories A, B, F, K are **immediately implementable**
  against `@tisyn/config` alone.
- Categories D, E, G, H, J require `@tisyn/runtime` or
  equivalent resolution infrastructure.
- Category I is **partially active** — 5 of 9 tests covered
  by CLI integration tests. 4 projection shape tests remain
  deferred.
- Category C requires compiler metadata integration.

---

## Conformance-Risk Areas

1. **Entrypoint overlay merge semantics.** The agent
   merge-by-id rule is the most complex operation in the
   spec. CFG-OVR-002 through CFG-OVR-009 are essential.

2. **Environment coercion whitelist.** The boolean
   coercion whitelist (`"true"/"false"/"1"/"0"`, all else
   fails) is a sharp boundary likely to be accidentally
   broadened. CFG-ENV-008 and CFG-ENV-009 lock it down.

3. **Secret redaction completeness.** New diagnostic
   surfaces added later must be re-validated against
   CFG-SEC-002 through CFG-SEC-004.

4. **`Config.useConfig(Token)` / invocation-args separation.**
   The boundary is the sharpest architectural invariant.
   CFG-USE-004 and CFG-USE-009 prevent silent collapse
   between config projection and invocation arguments.

5. **Resolution ordering.** CFG-ORD-001 and CFG-ORD-002
   are the only tests enforcing overlay-before-validation
   and validation-before-resolution.

---

## Final Conformance Notes

1. **Constructor purity wording.** "Deeply equal" replaced
   with "observationally equivalent results" — tests
   validate that normatively required fields match, not
   that implementation-internal properties are reference-
   or deep-equal.

2. **Serializable domain test.** CFG-CON-015 validates
   domain membership directly per §3.1. JSON round-trip
   is noted as a supplementary practical check, not the
   normative criterion.

3. **V8 and V7 parameterized.** Multiple violation
   variants consolidated into parameterized tests
   (CFG-VAL-014, CFG-VAL-015) to reduce row count while
   preserving coverage.

4. **V10 (server at base) grounding.** CFG-VAL-017 now
   quotes the spec rule directly: "The base
   `WorkflowDescriptor` MUST NOT include a `server` field."

5. **Multi-error env reporting confirmed P0.** Config
   spec §7.1 step 6 uses imperative language ("report ALL
   missing variables"). CFG-ENV-015 stays P0 with an
   explicit note.

6. **Fixture strategy expanded.** F-INVALID-RUNTIME,
   F-COMPILER, and F-SEPARATE families added to cover
   validation categories D, C, and E that were previously
   missing from the fixture strategy.

7. **P0/P1 rule added.** §4.1 now explicitly maps P0 to
   MUST and P1 to SHOULD/MAY/advisory.

8. **Open-question dependency.** CFG-OVR-003 annotated as
   contingent on config spec Q2. No other P0 tests depend
   on open questions or MAY-level behavior.
