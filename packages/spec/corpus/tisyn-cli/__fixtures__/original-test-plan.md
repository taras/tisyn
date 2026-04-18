<!-- GENERATED FILE — do not edit. Regenerate from the canonical corpus module. -->

# Tisyn CLI Test Plan

_Validates: tisyn-cli_
_Categories section: 6_
_Style: Blocking Scope Conformance Test Plan_

## Purpose

This document defines the conformance test plan for the
Tisyn CLI Specification. An implementation of `@tisyn/cli`
proves conformance by passing all tests marked **P0**
(blocking). Tests marked **P1** are recommended but not
blocking for initial conformance. Tests marked **GOLDEN**
lock down output format through snapshot comparison.

## Scope

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

## Conformance Targets

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

## Test Strategy

### Priority Model

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

### Black-Box vs. White-Box

P0 conformance tests SHOULD prefer **black-box observable
CLI behavior**: exit codes, stdout/stderr content, file
outputs, and process lifecycle outcomes.

Integration or structural assertions are used only when the
CLI spec explicitly defines a structural contract (e.g.,
module contracts M1–M3) and the behavior cannot be observed
through CLI output alone.

### Schema-Related Tests

Schema rejection tests validate that the CLI rejects
schemas containing unsupported constructs — not that the CLI
inspects any particular source-language representation. This
keeps tests stable regardless of the schema derivation
mechanism used.

### Lifecycle Observability

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

## Required Test Fixtures

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

## Test Matrix

### CLI-TC-A: Command Surface

- [CLI-CMD-001] [p0] [e2e] (CLI-2.1-R2) `tsn generate --help` exits 0 and shows usage
- [CLI-CMD-002] [p0] [e2e] (CLI-2.2-R1) `tsn build --help` exits 0 and shows usage
- [CLI-CMD-003] [p0] [e2e] (CLI-9.6-R1) `tsn run <valid-module> --help` loads the module and shows workflow-derived help (see CLI-HLP-008/009 for the failure path)
- [CLI-CMD-003a] [p0] [e2e] (CLI-9.6-R5) `tsn run --help` (no module argument) shows static command help and exits 0
- [CLI-CMD-004] [p0] [e2e] (CLI-2.4-R3) `tsn check --help` exits 0 and shows usage
- [CLI-CMD-005] [p0] [e2e] (CLI-1.1-R1) `tsn --version` prints version and exits 0
- [CLI-CMD-006] [p0] [e2e] (CLI-3.4-R3) Unknown command `tsn foo` exits with code 2

### CLI-TC-B: `tsn generate`

- [CLI-GEN-001] [p0] [e2e] (CLI-2.1-R3) Single valid root → exits 0, generated output on stdout
- [CLI-GEN-002] [p0] [e2e] (CLI-2.1-R3) Multiple valid roots with `-o` → exits 0, output file written
- [CLI-GEN-003] [p0] [e2e] (CLI-3.4-R3) Nonexistent root file → exit code 3
- [CLI-GEN-004] [p0] [e2e] (CLI-3.4-R2) Unrecognized built-in flag → exit code 2
- [CLI-GEN-005] [p0] [e2e] (CLI-2.1-R2) `--format json` → exits 0 with JSON output
- [CLI-GEN-006] [p0] [e2e] (CLI-2.1-R1) Legacy `--include` flag is rejected as unrecognized

### CLI-TC-C: `tsn build`

**Note on CLI-BLD-007.** The CLI's normative contribution is
generated-module path handoff and pass ordering. Compiler
internals remain out of scope.

- [CLI-BLD-001] [p0] [e2e] (CLI-2.2-R1) Valid rooted config → exits 0, output files written
- [CLI-BLD-002] [p0] [e2e] (CLI-2.2-R2) No config file found → exit code 2
- [CLI-BLD-003] [p0] [e2e] (CLI-4.3-R1) Empty `generates` array → exit code 2
- [CLI-BLD-004] [p0] [e2e] (CLI-5.1-R2) Dependency cycle → exit code 2 with diagnostic
- [CLI-BLD-005] [p0] [e2e] (CLI-2.2-R3) `--filter` runs named pass and its dependencies
- [CLI-BLD-006] [p0] [e2e] (CLI-2.2-R4) `--filter` unknown name → exit code 2
- [CLI-BLD-007] [p0] [e2e] (CLI-5.3-R1) Multi-pass rooted build passes prior outputs as generated-module boundaries; no stub injection or import stripping required
- [CLI-BLD-008] [p0] [e2e] (CLI-4.3-R2) Legacy `input` field in build config is rejected
- [CLI-BLD-009] [p0] [e2e] (CLI-5.1-R1) Inferred import-graph dependency ordering matches declared output paths in a two-pass build

### CLI-TC-D: Descriptor Loading (`tsn run`)

- [CLI-LOAD-001] [p0] [e2e] (CLI-10.1-R1) `tsn run <valid-module>` proceeds past loading (fixture `minimal.ts`); observable as reaching a later phase, not a load-phase error
- [CLI-LOAD-002] [p0] [e2e] (CLI-3.4-R4) Nonexistent module path → exit code 3
- [CLI-LOAD-003] [p0] [e2e] (CLI-10.2-R1) Module with no default export → exit code 2
- [CLI-LOAD-004] [p0] [e2e] (CLI-10.2-R1) Default export is not a `WorkflowDescriptor` → exit code 2
- [CLI-LOAD-005] [p0] [e2e] (CLI-10.2-R2) `run.export` names a non-existent export → exit code 2
- [CLI-LOAD-006] [p0] [e2e] (CLI-10.2-R3) `run.module` relative path resolves correctly; observable as workflow loading without code 3
- [CLI-LOAD-007] [p0] [e2e] (CLI-10.2-R3) `run.module` path does not exist → exit code 3
- [CLI-LOAD-008] [p0] [e2e] (CLI-10.1-R1) `run.module` omitted → workflow function resolved from descriptor module; successful execution
- [CLI-LOAD-009] [p0] [e2e] (CLI-10.5.1-R1) TypeScript descriptor module (`.ts`/`.mts`/`.cts`) loads successfully; reaches a later phase, not a load-phase error
- [CLI-LOAD-010] [p0] [e2e] (CLI-10.5.1-R2) Unsupported extension (for example `.tsx`) → exit code 3 with unsupported-extension diagnostic
- [CLI-LOAD-011] [p0] [e2e] (CLI-10.5.4-R1) Explicit TypeScript `run.module` target that is authored workflow source uses compiler-based rooted compilation, not module loading; observable via successful `tsn check`
- [CLI-LOAD-012] [p0] [e2e] (CLI-10.5.4-R1) Same-module workflow export in a TypeScript descriptor resolves from the descriptor module instead of the compiler path
- [CLI-LOAD-013] [p0] [e2e] (CLI-10.2-R4) `run.module` pointing to a generated workflow module is runtime-loaded; compiler is not invoked
- [CLI-LOAD-014] [p0] [e2e] (CLI-10.2-R4) Descriptor module itself is runtime-loaded and not treated as a workflow compilation root

### CLI-TC-E: Entrypoint Selection (`tsn run`)

- [CLI-ENT-001] [p0] [e2e] (CLI-10.1-R2) `--entrypoint dev` with an existing entrypoint → overlay applied; entrypoint-specific behavior differs from base
- [CLI-ENT-002] [p0] [e2e] (CLI-10.1-R2) `--entrypoint unknown` → exit code 2
- [CLI-ENT-003] [p0] [e2e] (CLI-10.1-R2) No `--entrypoint` → base descriptor used
- [CLI-ENT-004] [p0] [e2e] (CLI-10.1-R1) Overlay that introduces a validation error → exit code 2

### CLI-TC-F: Invocation Input Schema Contract

**Note.** CLI-IS-005 through CLI-IS-011 validate the schema
contract (§8.4), not any specific derivation mechanism.
Implemented using fixture modules that produce the
unsupported shapes.

- [CLI-IS-001] [p0] [e2e] (CLI-8.1-R1) Schema unavailable → exit code 2
- [CLI-IS-002] [p0] [e2e] (CLI-8.1-R2) Schema contains unsupported shape → exit code 2 with diagnostic naming the unsupported construct
- [CLI-IS-003] [p0] [e2e] (CLI-8.1-R3) Zero-parameter workflow → no derived flags, no failure
- [CLI-IS-004] [p0] [e2e] (CLI-8.2-R1) Flat object parameter → one flag per field
- [CLI-IS-005] [p0] [e2e] (CLI-8.4-R1) Multiple parameters → rejected with exit code 2
- [CLI-IS-006] [p0] [e2e] (CLI-8.4-R1) Non-object parameter → rejected
- [CLI-IS-007] [p0] [e2e] (CLI-8.4-R1) Array-typed field → rejected
- [CLI-IS-008] [p0] [e2e] (CLI-8.4-R1) Nested object field → rejected
- [CLI-IS-009] [p0] [e2e] (CLI-8.4-R1) Union-typed field other than optionality unions → rejected
- [CLI-IS-010] [p0] [e2e] (CLI-8.4-R1) Enum-typed field → rejected
- [CLI-IS-011] [p0] [e2e] (CLI-8.4-R1) Config-node-typed field → rejected

### CLI-TC-G: CLI Flag Derivation and Mapping

- [CLI-FLG-001] [p0] [unit] (CLI-9.1-R1) [Unit] `maxTurns` → `--max-turns`
- [CLI-FLG-002] [p0] [unit] (CLI-9.1-R1) [Unit] `model` → `--model` (no case change)
- [CLI-FLG-003] [p0] [unit] (CLI-9.1-R1) [Unit] `outputDir` → `--output-dir`
- [CLI-FLG-004] [p0] [unit] (CLI-9.1-R1) [Unit] `a` (single char) → `--a`
- [CLI-FLG-005] [p0] [e2e] (CLI-9.2-R1) Required string: `--model foo` → `"foo"`
- [CLI-FLG-006] [p0] [e2e] (CLI-9.2-R1) Required string missing → exit code 4
- [CLI-FLG-007] [p0] [e2e] (CLI-9.2-R1) Optional string: `--model foo` → `"foo"`
- [CLI-FLG-008] [p0] [e2e] (CLI-9.2-R2) Optional string omitted → `undefined`
- [CLI-FLG-009] [p0] [e2e] (CLI-9.2-R1) Required number: `--max-turns 10` → `10`
- [CLI-FLG-010] [p0] [e2e] (CLI-9.2-R1) Required number missing → exit code 4
- [CLI-FLG-011] [p0] [e2e] (CLI-9.3-R1) Number coercion failure: `--max-turns abc` → exit code 4
- [CLI-FLG-012] [p0] [e2e] (CLI-9.4-R1) Unknown invocation flag → exit code 4
- [CLI-FLG-013] [p0] [e2e] (CLI-9.2-R1) Multiple missing required fields → all reported in one diagnostic
- [CLI-FLG-014] [p0] [e2e] (CLI-16.2-R1) `--verbose` after module does not leak into workflow flag parsing (not rejected as unknown)
- [CLI-FLG-015] [p0] [e2e] (CLI-16.2-R1) `--entrypoint <name>` after module does not leak into workflow flag parsing
- [CLI-FLG-016] [p0] [e2e] (CLI-16.2-R1) Built-in and workflow flags coexist: `--entrypoint dev --max-turns 10` parses both correctly
- [CLI-FLG-017] [p0] [e2e] (CLI-9.4-R1) Unknown short flag `-x` after module → exit code 4
- [CLI-FLG-018] [p0] [e2e] (CLI-9.4-R1) Bare positional arg `stray` after module → exit code 4
- [CLI-FLG-019] [p0] [e2e] (CLI-9.4-R1) Zero-parameter workflow + unknown flag → exit code 4
- [CLI-FLG-020] [p0] [e2e] (CLI-9.4-R1) Empty-object-schema workflow + unknown flag → exit code 4

### CLI-TC-H: Boolean v1 Semantics

- [CLI-BOOL-001] [p0] [e2e] (CLI-8.3-R1) `boolean` field: `--flag` present → `true`
- [CLI-BOOL-002] [p0] [e2e] (CLI-8.3-R2) `boolean` field: flag absent → `false`
- [CLI-BOOL-003] [p0] [e2e] (CLI-8.3-R1) `boolean?` field: `--flag` present → `true`
- [CLI-BOOL-004] [p0] [e2e] (CLI-8.3-R2) `boolean?` field: flag absent → `false` (not `undefined`)
- [CLI-BOOL-005] [p0] [e2e] (CLI-8.3-R1) Non-optional `boolean` is NOT treated as a required CLI flag — absent → `false`
- [CLI-BOOL-006] [p0] [e2e] (CLI-8.3-R3) `--no-flag` syntax → exit code 4 (rejected as unknown flag)
- [CLI-BOOL-007] [p0] [unit] (CLI-8.3-R1) [Unit] `boolean` and `boolean?` map to identical CLI surface

### CLI-TC-I: Flag Collision

**Note on CLI-COL-001.** The CLI spec §9.5 normatively
states "the built-in takes precedence" and "The workflow
parameter MUST be renamed to avoid the conflict." This is
a MUST-level rule in the current spec, so CLI-COL-001 is
P0. The spec's final section notes that this *resolution
strategy* (precedence vs. namespacing) is an open question
for potential future revision — but the current rule is
settled and testable. If a future spec revision adopts
namespacing, this test must be updated.

- [CLI-COL-001] [p0] [e2e] (CLI-9.5-R1) Derived `--verbose` (from `verbose` parameter) collides with built-in → built-in wins, workflow parameter not addressable via `--verbose`
- [CLI-COL-002] [p0] [unit] (CLI-9.5-R1) [Unit] Collision check operates on derived kebab-case names
- [CLI-COL-003] [p0] [e2e] (CLI-9.5-R2) Collision produces advisory diagnostic (SHOULD)

### CLI-TC-J: Help Generation

- [CLI-HLP-001] [p0] [e2e] (CLI-9.6-R1) Help output includes usage line
- [CLI-HLP-002] [p0] [e2e] (CLI-9.6-R1) Help includes built-in options
- [CLI-HLP-003] [p0] [e2e] (CLI-9.6-R1) Help includes workflow-derived flags with type indicators
- [CLI-HLP-004] [p0] [e2e] (CLI-9.6-R1) Help marks required vs optional for each derived flag
- [CLI-HLP-005] [p0] [e2e] (CLI-8.5-R1) JSDoc descriptions appear in help (SHOULD)
- [CLI-HLP-006] [p0] [e2e] (CLI-9.6-R2) Help does NOT describe `Config.useConfig()` internals
- [CLI-HLP-007] [p1] [e2e] (CLI-9.6-R1) Help lists available entrypoints
- [CLI-HLP-008] [p0] [e2e] (CLI-9.6-R3) Module load failure → help shows built-in options + diagnostic, exits with error code
- [CLI-HLP-009] [p0] [e2e] (CLI-9.6-R3) Schema derivation failure → help shows built-in options + diagnostic, exits with error code
- [CLI-HLP-010] [p0] [e2e] (CLI-9.6-R4) Help MUST NOT silently omit workflow inputs section without explanation
- [CLI-HLP-011] [p0] [e2e] (CLI-9.6-R1) [Golden] Snapshot: help output for `with-inputs` fixture
- [CLI-HLP-012] [p0] [e2e] (CLI-10.5.1-R1) `tsn run <ts-descriptor> --help` loads a TypeScript descriptor module and shows workflow-derived help

### CLI-TC-K: `tsn check`

- [CLI-CHK-001] [p0] [e2e] (CLI-10.2-R1) Valid descriptor + env vars set → exit 0
- [CLI-CHK-002] [p0] [e2e] (CLI-10.2-R1) Invalid descriptor → exit code 2
- [CLI-CHK-003] [p0] [e2e] (CLI-3.4-R6) Missing required env var → exit code 5
- [CLI-CHK-004] [p0] [e2e] (CLI-2.4-R2) `tsn check` does not start transports; observable as process exiting promptly after checks
- [CLI-CHK-005] [p0] [e2e] (CLI-2.4-R2) `tsn check` does not execute the workflow; `side-effect` fixture sentinel file NOT created
- [CLI-CHK-006] [p0] [e2e] (CLI-2.4-R4) `--entrypoint dev` applies overlay before checking
- [CLI-CHK-007] [p0] [e2e] (CLI-2.4-R5) Reports invocation input schema if derivation succeeds (MAY)
- [CLI-CHK-008] [p0] [e2e] (CLI-2.4-R6) Schema derivation failure does NOT cause `tsn check` to fail
- [CLI-CHK-009] [p0] [e2e] (CLI-2.4-R1) `tsn check` does NOT validate specific invocation input values
- [CLI-CHK-010] [p0] [e2e] (CLI-2.4-R3) `--env-example` prints environment variable template to stdout and exits 0
- [CLI-CHK-011] [p0] [e2e] (CLI-2.4-R3) [Golden] Snapshot: `tsn check` output for `multi-agent` fixture
- [CLI-CHK-012] [p0] [e2e] (CLI-10.5.1-R1) `tsn check` accepts a TypeScript descriptor module and respects explicit TS workflow-source compilation behavior

### CLI-TC-L: Startup Lifecycle Ordering

- [CLI-LIFE-001] [p0] [e2e] (CLI-10.3-R1) Phase A before B. Fixture: `bad-descriptor.ts`. Observable: exit 2 with only descriptor-related diagnostics, no input-parsing diagnostics
- [CLI-LIFE-002] [p0] [e2e] (CLI-10.3-R1) Phase B before C. Fixture: `with-inputs.ts` with a required input omitted and all env vars set. Observable: exit 4 for missing input
- [CLI-LIFE-003] [p0] [e2e] (CLI-10.3-R1) Phases A–C before transport startup: validation failure exits and `side-effect` fixture transport side effect is not observable
- [CLI-LIFE-004] [p0] [e2e] (CLI-10.3-R1) Phases A–C before workflow execution: validation failure exits and `side-effect` fixture sentinel file NOT created
- [CLI-LIFE-005] [p0] [e2e] (CLI-10.1-R3) Workflow receives validated invocation args. Observable: workflow produces output derived from args
- [CLI-LIFE-006] [p0] [e2e] (CLI-10.1-R3) Resolved config available via `yield* Config.useConfig(Token)` only after pre-execution validation/resolution complete
- [CLI-LIFE-007] [p0] [e2e] (CLI-10.1-R3) Invocation args and `Config.useConfig(Token)` return value are separate. Observable: workflow asserts the two are distinct

### CLI-TC-M: Exit Code Behavior

- [CLI-EXIT-001] [p0] [e2e] (CLI-3.4-R8) Successful `tsn generate` → exit 0
- [CLI-EXIT-002] [p0] [e2e] (CLI-3.4-R9) Compilation error → exit 1
- [CLI-EXIT-003] [p0] [e2e] (CLI-3.4-R4) Loaded module, invalid descriptor → exit 2
- [CLI-EXIT-004] [p0] [e2e] (CLI-3.4-R4) Module file not found → exit 3
- [CLI-EXIT-005] [p0] [e2e] (CLI-3.4-R4) Module file not readable → exit 3
- [CLI-EXIT-006] [p0] [e2e] (CLI-3.4-R5) Missing required invocation input → exit 4
- [CLI-EXIT-007] [p0] [e2e] (CLI-3.4-R5) Unknown invocation flag (`tsn run`) → exit 4
- [CLI-EXIT-008] [p0] [e2e] (CLI-3.4-R5) Number coercion failure → exit 4
- [CLI-EXIT-009] [p0] [e2e] (CLI-3.4-R6) Missing required env var → exit 5
- [CLI-EXIT-010] [p0] [e2e] (CLI-3.4-R2) Unrecognized built-in flag (`generate`) → exit 2
- [CLI-EXIT-011] [p0] [e2e] (CLI-3.4-R4) Code 2 vs 3: loaded but invalid → exit 2
- [CLI-EXIT-012] [p0] [e2e] (CLI-3.4-R4) Code 2 vs 3: path does not exist → exit 3
- [CLI-EXIT-013] [p0] [e2e] (CLI-3.4-R8) Successful `tsn run` → exit 0
- [CLI-EXIT-014] [p0] [e2e] (CLI-3.4-R7) Runtime error → exit 6

### CLI-TC-N: Combined Error Reporting

§10.4 uses SHOULD for combined reporting and MAY for
continued diagnostic collection. P1.

- [CLI-CER-001] [p0] [e2e] (CLI-10.4-R1) Both missing input and missing env var → both reported before exit (SHOULD)

### CLI-TC-O: Golden/Snapshot Tests

- [CLI-SNAP-001] [p0] [e2e] (CLI-9.6-R1) [Golden] Help output: zero-parameter workflow
- [CLI-SNAP-002] [p0] [e2e] (CLI-9.6-R1) [Golden] Help output: multi-field workflow
- [CLI-SNAP-003] [p0] [e2e] (CLI-2.4-R3) [Golden] `tsn check` output: passing descriptor
- [CLI-SNAP-004] [p0] [e2e] (CLI-2.4-R3) [Golden] `tsn check` output: failing descriptor
- [CLI-SNAP-005] [p0] [e2e] (CLI-7.1-R1) [Golden] Compilation error diagnostic
- [CLI-SNAP-006] [p0] [e2e] (CLI-3.4-R5) [Golden] Missing required invocation input diagnostic
- [CLI-SNAP-007] [p0] [e2e] (CLI-3.4-R5) [Golden] Unknown flag diagnostic

### CLI-TC-P: Authored Source Execution (`tsn run`)

- [RUN-SRC-001] [p0] [e2e] (CLI-10.5.4-R1) Authored `.ts` with same-file helper executes without `UnboundVariable`
- [RUN-SRC-002] [p0] [e2e] (CLI-10.5.4-R1) Authored `.ts` with cross-module helper executes without `UnboundVariable`
- [RUN-SRC-003] [p0] [e2e] (CLI-10.5.4-R1) Authored `.ts` with aliased import executes without `UnboundVariable`

---

## Summary

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

## Assumptions

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

## Implementation Readiness

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

## Coverage Matrix

| Rule | Status | Tests | Reason |
| --- | --- | --- | --- |
| CLI-1.1-R1 | covered | CLI-CMD-005 |  |
| CLI-2.1-R1 | covered | CLI-GEN-006 |  |
| CLI-2.1-R2 | covered | CLI-CMD-001, CLI-GEN-005 |  |
| CLI-2.1-R3 | covered | CLI-GEN-001, CLI-GEN-002 |  |
| CLI-2.2-R1 | covered | CLI-CMD-002, CLI-BLD-001 |  |
| CLI-2.2-R2 | covered | CLI-BLD-002 |  |
| CLI-2.2-R3 | covered | CLI-BLD-005 |  |
| CLI-2.2-R4 | covered | CLI-BLD-006 |  |
| CLI-2.4-R1 | covered | CLI-CHK-009 |  |
| CLI-2.4-R2 | covered | CLI-CHK-004, CLI-CHK-005 |  |
| CLI-2.4-R3 | covered | CLI-CMD-004, CLI-CHK-010, CLI-CHK-011, CLI-SNAP-003, CLI-SNAP-004 |  |
| CLI-2.4-R4 | covered | CLI-CHK-006 |  |
| CLI-2.4-R5 | covered | CLI-CHK-007 |  |
| CLI-2.4-R6 | covered | CLI-CHK-008 |  |
| CLI-3.4-R1 | covered | CLI-CMD-006 |  |
| CLI-3.4-R2 | covered | CLI-GEN-004, CLI-EXIT-010 |  |
| CLI-3.4-R3 | covered | CLI-CMD-006, CLI-GEN-003 |  |
| CLI-3.4-R4 | covered | CLI-LOAD-002, CLI-EXIT-003, CLI-EXIT-004, CLI-EXIT-005, CLI-EXIT-011, CLI-EXIT-012 |  |
| CLI-3.4-R5 | covered | CLI-EXIT-006, CLI-EXIT-007, CLI-EXIT-008, CLI-SNAP-006, CLI-SNAP-007 |  |
| CLI-3.4-R6 | covered | CLI-CHK-003, CLI-EXIT-009 |  |
| CLI-3.4-R7 | covered | CLI-EXIT-014 |  |
| CLI-3.4-R8 | covered | CLI-EXIT-001, CLI-EXIT-013 |  |
| CLI-3.4-R9 | covered | CLI-EXIT-002 |  |
| CLI-4.3-R1 | covered | CLI-BLD-003 |  |
| CLI-4.3-R2 | covered | CLI-BLD-008 |  |
| CLI-5.1-R1 | covered | CLI-BLD-009 |  |
| CLI-5.1-R2 | covered | CLI-BLD-004 |  |
| CLI-5.3-R1 | covered | CLI-BLD-007 |  |
| CLI-7.1-R1 | covered | CLI-SNAP-005 |  |
| CLI-8.1-R1 | covered | CLI-IS-001 |  |
| CLI-8.1-R2 | covered | CLI-IS-002 |  |
| CLI-8.1-R3 | covered | CLI-IS-003 |  |
| CLI-8.2-R1 | covered | CLI-IS-004 |  |
| CLI-8.3-R1 | covered | CLI-BOOL-001, CLI-BOOL-003, CLI-BOOL-005, CLI-BOOL-007 |  |
| CLI-8.3-R2 | covered | CLI-BOOL-002, CLI-BOOL-004 |  |
| CLI-8.3-R3 | covered | CLI-BOOL-006 |  |
| CLI-8.4-R1 | covered | CLI-IS-005, CLI-IS-006, CLI-IS-007, CLI-IS-008, CLI-IS-009, CLI-IS-010, CLI-IS-011 |  |
| CLI-8.5-R1 | covered | CLI-HLP-005 |  |
| CLI-9.1-R1 | covered | CLI-FLG-001, CLI-FLG-002, CLI-FLG-003, CLI-FLG-004 |  |
| CLI-9.2-R1 | covered | CLI-FLG-005, CLI-FLG-006, CLI-FLG-007, CLI-FLG-009, CLI-FLG-010, CLI-FLG-013 |  |
| CLI-9.2-R2 | covered | CLI-FLG-008 |  |
| CLI-9.3-R1 | covered | CLI-FLG-011 |  |
| CLI-9.4-R1 | covered | CLI-FLG-012, CLI-FLG-017, CLI-FLG-018, CLI-FLG-019, CLI-FLG-020 |  |
| CLI-9.5-R1 | covered | CLI-COL-001, CLI-COL-002 |  |
| CLI-9.5-R2 | covered | CLI-COL-003 |  |
| CLI-9.6-R1 | covered | CLI-CMD-003, CLI-HLP-001, CLI-HLP-002, CLI-HLP-003, CLI-HLP-004, CLI-HLP-007, CLI-HLP-011, CLI-SNAP-001, CLI-SNAP-002 |  |
| CLI-9.6-R2 | covered | CLI-HLP-006 |  |
| CLI-9.6-R3 | covered | CLI-HLP-008, CLI-HLP-009 |  |
| CLI-9.6-R4 | covered | CLI-HLP-010 |  |
| CLI-9.6-R5 | covered | CLI-CMD-003a |  |
| CLI-10.1-R1 | covered | CLI-LOAD-001, CLI-LOAD-008, CLI-ENT-004 |  |
| CLI-10.1-R2 | covered | CLI-ENT-001, CLI-ENT-002, CLI-ENT-003 |  |
| CLI-10.1-R3 | covered | CLI-LIFE-005, CLI-LIFE-006, CLI-LIFE-007 |  |
| CLI-10.2-R1 | covered | CLI-LOAD-003, CLI-LOAD-004, CLI-CHK-001, CLI-CHK-002 |  |
| CLI-10.2-R2 | covered | CLI-LOAD-005 |  |
| CLI-10.2-R3 | covered | CLI-LOAD-006, CLI-LOAD-007 |  |
| CLI-10.2-R4 | covered | CLI-LOAD-013, CLI-LOAD-014 |  |
| CLI-10.3-R1 | covered | CLI-LIFE-001, CLI-LIFE-002, CLI-LIFE-003, CLI-LIFE-004 |  |
| CLI-10.4-R1 | covered | CLI-CER-001 |  |
| CLI-10.5.1-R1 | covered | CLI-LOAD-009, CLI-HLP-012, CLI-CHK-012 |  |
| CLI-10.5.1-R2 | covered | CLI-LOAD-010 |  |
| CLI-10.5.4-R1 | covered | CLI-LOAD-011, CLI-LOAD-012, RUN-SRC-001, RUN-SRC-002, RUN-SRC-003 |  |
| CLI-16.2-R1 | covered | CLI-FLG-014, CLI-FLG-015, CLI-FLG-016 |  |
