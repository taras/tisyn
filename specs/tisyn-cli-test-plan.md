<!-- Generated from packages/spec/corpus — do not edit by hand. -->

# Tisyn CLI Test Plan

**Validates:** Tisyn CLI Specification
**Style reference:** Blocking Scope Conformance Test Plan
**Version:** 0.1.0

---

## 1. Purpose

This document defines the conformance test plan for the
Tisyn CLI Specification. An implementation of `@tisyn/cli`
proves conformance by passing all tests marked **P0**
(blocking). Tests marked **P1** are recommended but not
blocking for initial conformance. Tests marked **GOLDEN**
lock down output format through snapshot comparison.

## 2. Scope

This test plan covers:

- Command dispatch and surface
- Rooted `tsn generate` and graph-aware `tsn build`
- Descriptor loading and workflow function loading
- `tsn run` dispatch between authored source and generated modules
- TypeScript-family module loading for descriptors and transport bindings
- Invocation input schema contract (IS1–IS3)
- CLI flag derivation and mapping
- Boolean v1 semantics (B1–B4)
- Help generation and help-path failure behavior
- Validation and coercion
- Startup lifecycle ordering
- `tsn check` readiness validation
- Exit code behavior
- Golden/snapshot tests for outputs

This test plan does NOT cover:

- Descriptor data model or constructor behavior
  (config test plan)
- `Config.useConfig()` semantics (config test plan)
- Environment resolution rules (config test plan)
- Rooted compiler graph semantics, helper compilation,
  contract visibility, or generated-module compiler
  boundaries (compiler test plan)

## 3. Conformance Targets

| Target | Package | Description |
| --- | --- | --- |
| **CLI-CMD** | `@tisyn/cli` | Command dispatch and flag parsing |
| **CLI-LOAD** | `@tisyn/cli` | Module loading and descriptor extraction |
| **CLI-SCHEMA** | `@tisyn/cli` | Input schema contract |
| **CLI-FLAG** | `@tisyn/cli` | Flag derivation, mapping, coercion |
| **CLI-HELP** | `@tisyn/cli` | Help text generation |
| **CLI-LIFE** | `@tisyn/cli` | Startup lifecycle and ordering |
| **CLI-CHECK** | `@tisyn/cli` | Readiness validation |
| **CLI-EXIT** | `@tisyn/cli` | Exit code correctness |

## 4. Test Strategy

### 4.1 Priority Model

- **P0** tests correspond to **MUST** behavior in the CLI
  specification. Blocking conformance.
- **P1** tests correspond to **SHOULD**, **MAY**, or
  advisory behavior. Recommended, not blocking.
- **GOLDEN** tests are an orthogonal test type, not a
  priority class. Golden tests lock down output format
  through snapshot comparison. They are **not required for
  conformance** — an implementation may produce different
  formatting and still conform. Golden tests are required
  for **output stability** once adopted.

### 4.2 Black-Box vs. White-Box

P0 conformance tests SHOULD prefer **black-box observable
CLI behavior**: exit codes, stdout/stderr content, file
outputs, and process lifecycle outcomes.

Integration or structural assertions are used only when the
CLI spec explicitly defines a structural contract (e.g.,
module contracts M1–M3) and the behavior cannot be observed
through CLI output alone.

### 4.3 Schema-Related Tests

Schema rejection tests validate that the CLI rejects
schemas containing unsupported constructs — not that the CLI
inspects any particular source-language representation. This
keeps tests stable regardless of the schema derivation
mechanism used.

### 4.4 Lifecycle Observability

Lifecycle ordering tests (category L) verify phase ordering
through **observable consequences**, not internal
instrumentation:

- Phase A before B: a descriptor error (code 2) exits
  before input parsing is attempted — confirmed by the
  absence of input-related diagnostics in stderr.
- Phase B before C: an input error (code 4) exits before
  env validation runs — confirmed by the absence of
  env-related diagnostics in stderr.
- Phases A–C before D: a validation failure exits before
  any side effects from transport startup or workflow
  execution are observable.

## 5. Required Test Fixtures

| Fixture | Purpose | Used by |
| --- | --- | --- |
| `fixtures/minimal.ts` | Minimal valid descriptor, zero-parameter workflow | CMD, LOAD, CHK, SNAP |
| `fixtures/generate-root.ts` | Minimal authored workflow root for `tsn generate` | GEN |
| `fixtures/generate-multi/` | Two-root authored workflow project | GEN |
| `fixtures/build-roots/` | Multi-pass rooted build config and source graph | BLD |
| `fixtures/generated-run.ts` | Descriptor whose `run.module` points to a generated workflow module | LOAD |
| `fixtures/source-run.ts` | Descriptor whose `run.module` points to authored workflow source | LOAD, LIFE |
| `fixtures/multi-agent.ts` | Multi-agent descriptor with journal and entrypoint | ENT, CHK, SNAP |
| `fixtures/with-inputs.ts` | Workflow with `{ maxTurns: number; model?: string; verbose: boolean }` | FLG, BOOL, HLP, SNAP |
| `fixtures/separate-module.ts` | Descriptor with `run.module` pointing to separate file | LOAD |
| `fixtures/bad-descriptor.ts` | Module whose default export is not a `WorkflowDescriptor` | LOAD, EXIT |
| `fixtures/no-default.ts` | Module with no default export | LOAD |
| `fixtures/ts-descriptor.ts` | TypeScript descriptor module fixture (`.ts`, `.mts`, or `.cts`) | LOAD, HELP, CHK |
| `fixtures/same-module-ts-descriptor.ts` | TypeScript descriptor whose workflow export lives in the same module | LOAD |
| `fixtures/unsupported-extension.tsx` | Unsupported JSX-bearing descriptor module fixture | LOAD, EXIT |
| `fixtures/local-binding.ts` | TypeScript local/inprocess transport binding module | LIFE |
| `fixtures/unsupported-schema.ts` | Workflow whose input schema contains an unsupported shape | IS |
| `fixtures/env-heavy.ts` | Descriptor with required, optional, and secret env nodes | CHK, EXIT, SNAP |
| `fixtures/collision.ts` | Workflow with `verbose` parameter (collides with built-in) | COL |
| `fixtures/jsDoc.ts` | Workflow with JSDoc-annotated parameters | HLP |
| `fixtures/side-effect.ts` | Minimal workflow that writes a sentinel file on execution | LIFE |

**Harness requirements:**

- E2E tests invoke `tsn` as a child process and capture
  stdout, stderr, and exit code.
- Golden tests compare output against checked-in snapshot
  files. Snapshot updates MUST be reviewed and approved
  explicitly; automated snapshot acceptance is prohibited.
- Environment manipulation tests MUST restore `process.env`
  after each test, regardless of pass/fail.
- Fixture modules that produce specific schema shapes are
  the primary mechanism for schema-related tests. The test
  plan does not prescribe how fixtures produce schemas.

---

## 6. Test Matrix

### A. Command Surface

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-CMD-001 | P0 | E2E | §2.1 | `tsn generate --help` exits 0 and shows usage |
| CLI-CMD-002 | P0 | E2E | §2.2 | `tsn build --help` exits 0 and shows usage |
| CLI-CMD-003 | P0 | E2E | §9.6 | `tsn run <valid-module> --help` loads the module and shows workflow-derived help (see CLI-HLP-008/009 for the failure path) |
| CLI-CMD-003a | P0 | E2E | §9.6 | `tsn run --help` (no module argument) shows static command help and exits 0 |
| CLI-CMD-004 | P0 | E2E | §2.4 | `tsn check --help` exits 0 and shows usage |
| CLI-CMD-005 | P0 | E2E | §1.1 | `tsn --version` prints version and exits 0 |
| CLI-CMD-006 | P0 | E2E | §3.4 | Unknown command `tsn foo` exits with code 2 |

### B. `tsn generate`

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-GEN-001 | P0 | E2E | §2.1 | Single valid root → exits 0, generated output on stdout |
| CLI-GEN-002 | P0 | E2E | §2.1 | Multiple valid roots with `-o` → exits 0, output file written |
| CLI-GEN-003 | P0 | E2E | §3.4 | Nonexistent root file → exit code 3 |
| CLI-GEN-004 | P0 | E2E | §3.4 | Unrecognized built-in flag → exit code 2 |
| CLI-GEN-005 | P0 | E2E | §2.1 | `--format json` → exits 0 with JSON output |
| CLI-GEN-006 | P0 | E2E | §2.1 | Legacy `--include` flag is rejected as unrecognized |

### C. `tsn build`

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-BLD-001 | P0 | E2E | §2.2 | Valid rooted config → exits 0, output files written |
| CLI-BLD-002 | P0 | E2E | §2.2 | No config file found → exit code 2 |
| CLI-BLD-003 | P0 | E2E | §4.3 | Empty `generates` array → exit code 2 |
| CLI-BLD-004 | P0 | E2E | §5.1 | Dependency cycle → exit code 2 with diagnostic |
| CLI-BLD-005 | P0 | E2E | §2.2 | `--filter` runs named pass and its dependencies |
| CLI-BLD-006 | P0 | E2E | §2.2 | `--filter` unknown name → exit code 2 |
| CLI-BLD-007 | P0 | E2E | §5.3 | Multi-pass rooted build passes prior outputs as generated-module boundaries; no stub injection or import stripping required |
| CLI-BLD-008 | P0 | E2E | §4.3 | Legacy `input` field in build config is rejected |
| CLI-BLD-009 | P0 | E2E | §5.1 | Inferred import-graph dependency ordering matches declared output paths in a two-pass build |

**Note on CLI-BLD-007.** The CLI's normative contribution is
generated-module path handoff and pass ordering. Compiler
internals remain out of scope.

### D. Descriptor Loading (`tsn run`)

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-LOAD-001 | P0 | E2E | §10.1 | `tsn run <valid-module>` proceeds past loading (fixture `minimal.ts`); observable as reaching a later phase, not a load-phase error |
| CLI-LOAD-002 | P0 | E2E | §3.4 | Nonexistent module path → exit code 3 |
| CLI-LOAD-003 | P0 | E2E | §10.2 | Module with no default export → exit code 2 |
| CLI-LOAD-004 | P0 | E2E | §10.2 | Default export is not a `WorkflowDescriptor` → exit code 2 |
| CLI-LOAD-005 | P0 | E2E | §10.2 | `run.export` names a non-existent export → exit code 2 |
| CLI-LOAD-006 | P0 | E2E | §10.2 | `run.module` relative path resolves correctly; observable as workflow loading without code 3 |
| CLI-LOAD-007 | P0 | E2E | §10.2 | `run.module` path does not exist → exit code 3 |
| CLI-LOAD-008 | P0 | E2E | §10.1 | `run.module` omitted → workflow function resolved from descriptor module; successful execution |
| CLI-LOAD-009 | P0 | E2E | §10.5.1 | TypeScript descriptor module (`.ts`/`.mts`/`.cts`) loads successfully; reaches a later phase, not a load-phase error |
| CLI-LOAD-010 | P0 | E2E | §10.5.1 | Unsupported extension (for example `.tsx`) → exit code 3 with unsupported-extension diagnostic |
| CLI-LOAD-011 | P0 | E2E | §10.5.4 | Explicit TypeScript `run.module` target that is authored workflow source uses compiler-based rooted compilation, not module loading; observable via successful `tsn check` |
| CLI-LOAD-012 | P0 | E2E | §10.5.4 | Same-module workflow export in a TypeScript descriptor resolves from the descriptor module instead of the compiler path |
| CLI-LOAD-013 | P0 | E2E | §10.2 | `run.module` pointing to a generated workflow module is runtime-loaded; compiler is not invoked |
| CLI-LOAD-014 | P0 | E2E | §10.2 | Descriptor module itself is runtime-loaded and not treated as a workflow compilation root |

### E. Entrypoint Selection (`tsn run`)

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-ENT-001 | P0 | E2E | §10.1 | `--entrypoint dev` with an existing entrypoint → overlay applied; entrypoint-specific behavior differs from base |
| CLI-ENT-002 | P0 | E2E | §10.1 | `--entrypoint unknown` → exit code 2 |
| CLI-ENT-003 | P0 | E2E | §10.1 | No `--entrypoint` → base descriptor used |
| CLI-ENT-004 | P0 | E2E | §10.1 | Overlay that introduces a validation error → exit code 2 |

### F. Invocation Input Schema Contract

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-IS-001 | P0 | E2E | §8.1 | Schema unavailable → exit code 2 |
| CLI-IS-002 | P0 | E2E | §8.1 | Schema contains unsupported shape → exit code 2 with diagnostic naming the unsupported construct |
| CLI-IS-003 | P0 | E2E | §8.1 | Zero-parameter workflow → no derived flags, no failure |
| CLI-IS-004 | P0 | E2E | §8.2 | Flat object parameter → one flag per field |
| CLI-IS-005 | P0 | E2E | §8.4 | Multiple parameters → rejected with exit code 2 |
| CLI-IS-006 | P0 | E2E | §8.4 | Non-object parameter → rejected |
| CLI-IS-007 | P0 | E2E | §8.4 | Array-typed field → rejected |
| CLI-IS-008 | P0 | E2E | §8.4 | Nested object field → rejected |
| CLI-IS-009 | P0 | E2E | §8.4 | Union-typed field other than optionality unions → rejected |
| CLI-IS-010 | P0 | E2E | §8.4 | Enum-typed field → rejected |
| CLI-IS-011 | P0 | E2E | §8.4 | Config-node-typed field → rejected |

**Note.** CLI-IS-005 through CLI-IS-011 validate the schema
contract (§8.4), not any specific derivation mechanism.
Implemented using fixture modules that produce the
unsupported shapes.

### G. CLI Flag Derivation and Mapping

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-FLG-001 | P0 | Unit | §9.1 | `maxTurns` → `--max-turns` |
| CLI-FLG-002 | P0 | Unit | §9.1 | `model` → `--model` (no case change) |
| CLI-FLG-003 | P0 | Unit | §9.1 | `outputDir` → `--output-dir` |
| CLI-FLG-004 | P0 | Unit | §9.1 | `a` (single char) → `--a` |
| CLI-FLG-005 | P0 | E2E | §9.2 | Required string: `--model foo` → `"foo"` |
| CLI-FLG-006 | P0 | E2E | §9.2 | Required string missing → exit code 4 |
| CLI-FLG-007 | P0 | E2E | §9.2 | Optional string: `--model foo` → `"foo"` |
| CLI-FLG-008 | P0 | E2E | §9.2 | Optional string omitted → `undefined` |
| CLI-FLG-009 | P0 | E2E | §9.2 | Required number: `--max-turns 10` → `10` |
| CLI-FLG-010 | P0 | E2E | §9.2 | Required number missing → exit code 4 |
| CLI-FLG-011 | P0 | E2E | §9.3 | Number coercion failure: `--max-turns abc` → exit code 4 |
| CLI-FLG-012 | P0 | E2E | §9.4 | Unknown invocation flag → exit code 4 |
| CLI-FLG-013 | P0 | E2E | §9.2 | Multiple missing required fields → all reported in one diagnostic |
| CLI-FLG-014 | P0 | E2E | §16.2 | `--verbose` after module does not leak into workflow flag parsing (not rejected as unknown) |
| CLI-FLG-015 | P0 | E2E | §16.2 | `--entrypoint <name>` after module does not leak into workflow flag parsing |
| CLI-FLG-016 | P0 | E2E | §16.2 | Built-in and workflow flags coexist: `--entrypoint dev --max-turns 10` parses both correctly |
| CLI-FLG-017 | P0 | E2E | §9.4 | Unknown short flag `-x` after module → exit code 4 |
| CLI-FLG-018 | P0 | E2E | §9.4 | Bare positional arg `stray` after module → exit code 4 |
| CLI-FLG-019 | P0 | E2E | §9.4 | Zero-parameter workflow + unknown flag → exit code 4 |
| CLI-FLG-020 | P0 | E2E | §9.4 | Empty-object-schema workflow + unknown flag → exit code 4 |

### H. Boolean v1 Semantics

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-BOOL-001 | P0 | E2E | §8.3 | `boolean` field: `--flag` present → `true` |
| CLI-BOOL-002 | P0 | E2E | §8.3 | `boolean` field: flag absent → `false` |
| CLI-BOOL-003 | P0 | E2E | §8.3 | `boolean?` field: `--flag` present → `true` |
| CLI-BOOL-004 | P0 | E2E | §8.3 | `boolean?` field: flag absent → `false` (not `undefined`) |
| CLI-BOOL-005 | P0 | E2E | §8.3 | Non-optional `boolean` is NOT treated as a required CLI flag — absent → `false` |
| CLI-BOOL-006 | P0 | E2E | §8.3 | `--no-flag` syntax → exit code 4 (rejected as unknown flag) |
| CLI-BOOL-007 | P0 | Unit | §8.3 | `boolean` and `boolean?` map to identical CLI surface |

### I. Flag Collision

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-COL-001 | P0 | E2E | §9.5 | Derived `--verbose` (from `verbose` parameter) collides with built-in → built-in wins, workflow parameter not addressable via `--verbose` |
| CLI-COL-002 | P0 | Unit | §9.5 | Collision check operates on derived kebab-case names |
| CLI-COL-003 | P0 | E2E | §9.5 | Collision produces advisory diagnostic (SHOULD) |

**Note on CLI-COL-001.** The CLI spec §9.5 normatively
states "the built-in takes precedence" and "The workflow
parameter MUST be renamed to avoid the conflict." This is
a MUST-level rule in the current spec, so CLI-COL-001 is
P0. The spec's final section notes that this *resolution
strategy* (precedence vs. namespacing) is an open question
for potential future revision — but the current rule is
settled and testable. If a future spec revision adopts
namespacing, this test must be updated.

### J. Help Generation

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-HLP-001 | P0 | E2E | §9.6 | Help output includes usage line |
| CLI-HLP-002 | P0 | E2E | §9.6 | Help includes built-in options |
| CLI-HLP-003 | P0 | E2E | §9.6 | Help includes workflow-derived flags with type indicators |
| CLI-HLP-004 | P0 | E2E | §9.6 | Help marks required vs optional for each derived flag |
| CLI-HLP-005 | P0 | E2E | §8.5 | JSDoc descriptions appear in help (SHOULD) |
| CLI-HLP-006 | P0 | E2E | §9.6 | Help does NOT describe `Config.useConfig()` internals |
| CLI-HLP-007 | P1 | E2E | §9.6 | Help lists available entrypoints |
| CLI-HLP-008 | P0 | E2E | §9.6 | Module load failure → help shows built-in options + diagnostic, exits with error code |
| CLI-HLP-009 | P0 | E2E | §9.6 | Schema derivation failure → help shows built-in options + diagnostic, exits with error code |
| CLI-HLP-010 | P0 | E2E | §9.6 | Help MUST NOT silently omit workflow inputs section without explanation |
| CLI-HLP-011 | P0 | Golden | §9.6 | Snapshot: help output for `with-inputs` fixture |
| CLI-HLP-012 | P0 | E2E | §10.5.1 | `tsn run <ts-descriptor> --help` loads a TypeScript descriptor module and shows workflow-derived help |

### K. `tsn check`

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-CHK-001 | P0 | E2E | §10.2 | Valid descriptor + env vars set → exit 0 |
| CLI-CHK-002 | P0 | E2E | §10.2 | Invalid descriptor → exit code 2 |
| CLI-CHK-003 | P0 | E2E | §3.4 | Missing required env var → exit code 5 |
| CLI-CHK-004 | P0 | E2E | §2.4 | `tsn check` does not start transports; observable as process exiting promptly after checks |
| CLI-CHK-005 | P0 | E2E | §2.4 | `tsn check` does not execute the workflow; `side-effect` fixture sentinel file NOT created |
| CLI-CHK-006 | P0 | E2E | §2.4 | `--entrypoint dev` applies overlay before checking |
| CLI-CHK-007 | P0 | E2E | §2.4 | Reports invocation input schema if derivation succeeds (MAY) |
| CLI-CHK-008 | P0 | E2E | §2.4 | Schema derivation failure does NOT cause `tsn check` to fail |
| CLI-CHK-009 | P0 | E2E | §2.4 | `tsn check` does NOT validate specific invocation input values |
| CLI-CHK-010 | P0 | E2E | §2.4 | `--env-example` prints environment variable template to stdout and exits 0 |
| CLI-CHK-011 | P0 | Golden | §2.4 | Snapshot: `tsn check` output for `multi-agent` fixture |
| CLI-CHK-012 | P0 | E2E | §10.5.1 | `tsn check` accepts a TypeScript descriptor module and respects explicit TS workflow-source compilation behavior |

### L. Startup Lifecycle Ordering

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-LIFE-001 | P0 | E2E | §10.3 | Phase A before B. Fixture: `bad-descriptor.ts`. Observable: exit 2 with only descriptor-related diagnostics, no input-parsing diagnostics |
| CLI-LIFE-002 | P0 | E2E | §10.3 | Phase B before C. Fixture: `with-inputs.ts` with a required input omitted and all env vars set. Observable: exit 4 for missing input |
| CLI-LIFE-003 | P0 | E2E | §10.3 | Phases A–C before transport startup: validation failure exits and `side-effect` fixture transport side effect is not observable |
| CLI-LIFE-004 | P0 | E2E | §10.3 | Phases A–C before workflow execution: validation failure exits and `side-effect` fixture sentinel file NOT created |
| CLI-LIFE-005 | P0 | E2E | §10.1 | Workflow receives validated invocation args. Observable: workflow produces output derived from args |
| CLI-LIFE-006 | P0 | E2E | §10.1 | Resolved config available via `yield* Config.useConfig(Token)` only after pre-execution validation/resolution complete |
| CLI-LIFE-007 | P0 | E2E | §10.1 | Invocation args and `Config.useConfig(Token)` return value are separate. Observable: workflow asserts the two are distinct |

### M. Exit Code Behavior

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-EXIT-001 | P0 | E2E | §3.4 | Successful `tsn generate` → exit 0 |
| CLI-EXIT-002 | P0 | E2E | §3.4 | Compilation error → exit 1 |
| CLI-EXIT-003 | P0 | E2E | §3.4 | Loaded module, invalid descriptor → exit 2 |
| CLI-EXIT-004 | P0 | E2E | §3.4 | Module file not found → exit 3 |
| CLI-EXIT-005 | P0 | E2E | §3.4 | Module file not readable → exit 3 |
| CLI-EXIT-006 | P0 | E2E | §3.4 | Missing required invocation input → exit 4 |
| CLI-EXIT-007 | P0 | E2E | §3.4 | Unknown invocation flag (`tsn run`) → exit 4 |
| CLI-EXIT-008 | P0 | E2E | §3.4 | Number coercion failure → exit 4 |
| CLI-EXIT-009 | P0 | E2E | §3.4 | Missing required env var → exit 5 |
| CLI-EXIT-010 | P0 | E2E | §3.4 | Unrecognized built-in flag (`generate`) → exit 2 |
| CLI-EXIT-011 | P0 | E2E | §3.4 | Code 2 vs 3: loaded but invalid → exit 2 |
| CLI-EXIT-012 | P0 | E2E | §3.4 | Code 2 vs 3: path does not exist → exit 3 |
| CLI-EXIT-013 | P0 | E2E | §3.4 | Successful `tsn run` → exit 0 |
| CLI-EXIT-014 | P0 | E2E | §3.4 | Runtime error → exit 6 |

### N. Combined Error Reporting

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-CER-001 | P0 | E2E | §10.4 | Both missing input and missing env var → both reported before exit (SHOULD) |

§10.4 uses SHOULD for combined reporting and MAY for
continued diagnostic collection. P1.

### O. Golden/Snapshot Tests

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-SNAP-001 | P0 | Golden | §9.6 | Help output: zero-parameter workflow |
| CLI-SNAP-002 | P0 | Golden | §9.6 | Help output: multi-field workflow |
| CLI-SNAP-003 | P0 | Golden | §2.4 | `tsn check` output: passing descriptor |
| CLI-SNAP-004 | P0 | Golden | §2.4 | `tsn check` output: failing descriptor |
| CLI-SNAP-005 | P0 | Golden | §7.1 | Compilation error diagnostic |
| CLI-SNAP-006 | P0 | Golden | §3.4 | Missing required invocation input diagnostic |
| CLI-SNAP-007 | P0 | Golden | §3.4 | Unknown flag diagnostic |

### P. Authored Source Execution (`tsn run`)

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| RUN-SRC-001 | P0 | E2E | §10.5.4 | Authored `.ts` with same-file helper executes without `UnboundVariable` |
| RUN-SRC-002 | P0 | E2E | §10.5.4 | Authored `.ts` with cross-module helper executes without `UnboundVariable` |
| RUN-SRC-003 | P0 | E2E | §10.5.4 | Authored `.ts` with aliased import executes without `UnboundVariable` |

---

## 7. Summary

| Category | P0 | P1 | GOLDEN | Total |
| --- | --- | --- | --- | --- |
| A. Command surface | 7 | 0 | 0 | 7 |
| B. `tsn generate` | 6 | 0 | 0 | 6 |
| C. `tsn build` | 8 | 1 | 0 | 9 |
| D. Descriptor loading | 14 | 0 | 0 | 14 |
| E. Entrypoint selection | 4 | 0 | 0 | 4 |
| F. Input schema contract | 11 | 0 | 0 | 11 |
| G. Flag derivation | 20 | 0 | 0 | 20 |
| H. Boolean v1 | 7 | 0 | 0 | 7 |
| I. Flag collision | 2 | 1 | 0 | 3 |
| J. Help generation | 9 | 2 | 1 | 12 |
| K. `tsn check` | 9 | 1 | 1 | 11 |
| L. Startup lifecycle | 7 | 0 | 0 | 7 |
| M. Exit codes | 13 | 1 | 0 | 14 |
| N. Combined reporting | 0 | 1 | 0 | 1 |
| O. Golden/snapshot | 0 | 0 | 7 | 7 |
| P. Authored source execution | 3 | 0 | 0 | 3 |
| **Total** | **120** | **7** | **9** | **136** |

GOLDEN counts are **orthogonal output-stability coverage**,
not a third priority bucket parallel to P0/P1. An
implementation conforms by passing all P0 tests regardless
of GOLDEN results. GOLDEN tests are included in the total
count for planning purposes only.

## 8. Assumptions

- E2E tests invoke `tsn` as a child process and capture
  stdout, stderr, and exit code.
- Golden tests compare output against checked-in snapshot
  files. Snapshot updates MUST be explicitly reviewed and
  approved. Automated acceptance is prohibited.
- Schema-related tests depend on fixture modules that
  produce the relevant schema shapes. The test plan does
  not prescribe the derivation mechanism.
- Lifecycle tests use the `side-effect` fixture, which
  writes a sentinel file on workflow execution. Tests
  check for presence/absence of this file.
- Environment manipulation tests MUST restore `process.env`
  after each test, regardless of pass/fail outcome.

## 9. Implementation Readiness

- Categories A, B, C, M are **immediately implementable**.
- Categories D, E, F, G, H, I, J require descriptor
  fixtures and schema derivation infrastructure.
- Categories K, L require `@tisyn/runtime` or equivalent.
- Category N requires both input and env validation in the
  same test run.
- Category O requires golden file infrastructure.

---

## Highest-Risk Drift Areas

1. **Exit code 2 vs 3 boundary.** CLI-EXIT-011 and
   CLI-EXIT-012 enforce the filesystem vs structural
   error distinction.

2. **Boolean v1 collapse.** CLI-BOOL-004 and CLI-BOOL-005
   prevent treating non-optional `boolean` as required.

3. **Help-path failure behavior.** CLI-HLP-008 through
   CLI-HLP-010 enforce the `--help` failure contract.

4. **Invocation vs `Config.useConfig()` separation.**
   CLI-LIFE-005 and CLI-LIFE-007 prevent channel collapse.

5. **`tsn check` scope boundary.** CLI-CHK-009 prevents
   scope creep into input-value validation.

---

## Final Conformance Notes

1. **CLI-IS-009 completed.** The table pipe character in
   the union-type assertion was breaking markdown table
   rendering. Rephrased to "Union-typed field other than
   optionality unions → rejected" — semantically
   equivalent, table-safe.

2. **CLI-LIFE-002 reconciled with combined reporting.**
   Previously asserted "input error exits before any
   env-related diagnostic appears" — which conflicted
   with the spec's SHOULD-level combined reporting rule.
   Revised fixture design: env vars are set (Phase C
   would pass), so the test verifies ordering without
   forbidding combined diagnostics. The assertion is now
   "Phase B failures are detected even when Phase C would
   pass."

3. **CLI-COL-001 grounding clarified.** The distinction
   between the current normative rule (MUST-level, P0)
   and the future-open resolution strategy question is
   now explicit. The test validates the current spec; the
   open question is about whether a future revision might
   change the strategy.

4. **GOLDEN summary accounting.** A note after the summary
   table clarifies that GOLDEN counts are orthogonal
   output-stability coverage, not a conformance priority
   bucket.

5. **Lifecycle/load observability tightened.**
   CLI-LOAD-001 now names the fixture (`minimal.ts`) and
   explains why absence of load errors is meaningful.
   CLI-LIFE-001 now names the fixture (`bad-descriptor.ts`)
   and explains that Phase B would produce distinct
   diagnostics if reached. CLI-LIFE-002 now explicitly
   specifies that env vars are satisfied in the fixture,
   making the ordering assertion independent of combined
   reporting.
