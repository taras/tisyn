<!-- Generated from packages/spec/corpus — do not edit by hand. -->

# Tisyn CLI Test Plan

**Validates:** Tisyn CLI Specification
**Version:** 0.1.0

---

## A. Command Surface

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-CMD-001 | P0 | E2E | §2.1 | `tsn generate --help` exits 0 and shows usage |
| CLI-CMD-002 | P0 | E2E | §2.2 | `tsn build --help` exits 0 and shows usage |
| CLI-CMD-003 | P0 | E2E | §9.6 | `tsn run <valid-module> --help` loads the module and shows workflow-derived help (see CLI-HLP-008/009 for the failure path) |
| CLI-CMD-003a | P0 | E2E | §9.6 | `tsn run --help` (no module argument) shows static command help and exits 0 |
| CLI-CMD-004 | P0 | E2E | §2.4 | `tsn check --help` exits 0 and shows usage |
| CLI-CMD-005 | P0 | E2E | §1.1 | `tsn --version` prints version and exits 0 |
| CLI-CMD-006 | P0 | E2E | §3.4 | Unknown command `tsn foo` exits with code 2 |

## B. `tsn generate`

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-GEN-001 | P0 | E2E | §2.1 | Single valid root → exits 0, generated output on stdout |
| CLI-GEN-002 | P0 | E2E | §2.1 | Multiple valid roots with `-o` → exits 0, output file written |
| CLI-GEN-003 | P0 | E2E | §3.4 | Nonexistent root file → exit code 3 |
| CLI-GEN-004 | P0 | E2E | §3.4 | Unrecognized built-in flag → exit code 2 |
| CLI-GEN-005 | P0 | E2E | §2.1 | `--format json` → exits 0 with JSON output |
| CLI-GEN-006 | P0 | E2E | §2.1 | Legacy `--include` flag is rejected as unrecognized |

## C. `tsn build`

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

## D. Descriptor Loading (`tsn run`)

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

## E. Entrypoint Selection (`tsn run`)

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-ENT-001 | P0 | E2E | §10.1 | `--entrypoint dev` with an existing entrypoint → overlay applied; entrypoint-specific behavior differs from base |
| CLI-ENT-002 | P0 | E2E | §10.1 | `--entrypoint unknown` → exit code 2 |
| CLI-ENT-003 | P0 | E2E | §10.1 | No `--entrypoint` → base descriptor used |
| CLI-ENT-004 | P0 | E2E | §10.1 | Overlay that introduces a validation error → exit code 2 |

## F. Invocation Input Schema Contract

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

## G. CLI Flag Derivation and Mapping

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

## H. Boolean v1 Semantics

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-BOOL-001 | P0 | E2E | §8.3 | `boolean` field: `--flag` present → `true` |
| CLI-BOOL-002 | P0 | E2E | §8.3 | `boolean` field: flag absent → `false` |
| CLI-BOOL-003 | P0 | E2E | §8.3 | `boolean?` field: `--flag` present → `true` |
| CLI-BOOL-004 | P0 | E2E | §8.3 | `boolean?` field: flag absent → `false` (not `undefined`) |
| CLI-BOOL-005 | P0 | E2E | §8.3 | Non-optional `boolean` is NOT treated as a required CLI flag — absent → `false` |
| CLI-BOOL-006 | P0 | E2E | §8.3 | `--no-flag` syntax → exit code 4 (rejected as unknown flag) |
| CLI-BOOL-007 | P0 | Unit | §8.3 | `boolean` and `boolean?` map to identical CLI surface |

## I. Flag Collision

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-COL-001 | P0 | E2E | §9.5 | Derived `--verbose` (from `verbose` parameter) collides with built-in → built-in wins, workflow parameter not addressable via `--verbose` |
| CLI-COL-002 | P0 | Unit | §9.5 | Collision check operates on derived kebab-case names |
| CLI-COL-003 | P0 | E2E | §9.5 | Collision produces advisory diagnostic (SHOULD) |

## J. Help Generation

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

## K. `tsn check`

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

## L. Startup Lifecycle Ordering

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-LIFE-001 | P0 | E2E | §10.3 | Phase A before B. Fixture: `bad-descriptor.ts`. Observable: exit 2 with only descriptor-related diagnostics, no input-parsing diagnostics |
| CLI-LIFE-002 | P0 | E2E | §10.3 | Phase B before C. Fixture: `with-inputs.ts` with a required input omitted and all env vars set. Observable: exit 4 for missing input |
| CLI-LIFE-003 | P0 | E2E | §10.3 | Phases A–C before transport startup: validation failure exits and `side-effect` fixture transport side effect is not observable |
| CLI-LIFE-004 | P0 | E2E | §10.3 | Phases A–C before workflow execution: validation failure exits and `side-effect` fixture sentinel file NOT created |
| CLI-LIFE-005 | P0 | E2E | §10.1 | Workflow receives validated invocation args. Observable: workflow produces output derived from args |
| CLI-LIFE-006 | P0 | E2E | §10.1 | Resolved config available via `yield* Config.useConfig(Token)` only after pre-execution validation/resolution complete |
| CLI-LIFE-007 | P0 | E2E | §10.1 | Invocation args and `Config.useConfig(Token)` return value are separate. Observable: workflow asserts the two are distinct |

## M. Exit Code Behavior

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

## N. Combined Error Reporting

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-CER-001 | P0 | E2E | §10.4 | Both missing input and missing env var → both reported before exit (SHOULD) |

## O. Golden/Snapshot Tests

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| CLI-SNAP-001 | P0 | Golden | §9.6 | Help output: zero-parameter workflow |
| CLI-SNAP-002 | P0 | Golden | §9.6 | Help output: multi-field workflow |
| CLI-SNAP-003 | P0 | Golden | §2.4 | `tsn check` output: passing descriptor |
| CLI-SNAP-004 | P0 | Golden | §2.4 | `tsn check` output: failing descriptor |
| CLI-SNAP-005 | P0 | Golden | §7.1 | Compilation error diagnostic |
| CLI-SNAP-006 | P0 | Golden | §3.4 | Missing required invocation input diagnostic |
| CLI-SNAP-007 | P0 | Golden | §3.4 | Unknown flag diagnostic |

## P. Authored Source Execution (`tsn run`)

| ID | P | Type | Spec | Assertion |
| --- | --- | --- | --- | --- |
| RUN-SRC-001 | P0 | E2E | §10.5.4 | Authored `.ts` with same-file helper executes without `UnboundVariable` |
| RUN-SRC-002 | P0 | E2E | §10.5.4 | Authored `.ts` with cross-module helper executes without `UnboundVariable` |
| RUN-SRC-003 | P0 | E2E | §10.5.4 | Authored `.ts` with aliased import executes without `UnboundVariable` |

## Coverage Matrix

- CLI-1.1-R1 → CLI-CMD-005
- CLI-2.1-R1 → CLI-GEN-006
- CLI-2.1-R2 → CLI-CMD-001, CLI-GEN-005
- CLI-2.1-R3 → CLI-GEN-001, CLI-GEN-002
- CLI-2.2-R1 → CLI-CMD-002, CLI-BLD-001
- CLI-2.2-R2 → CLI-BLD-002
- CLI-2.2-R3 → CLI-BLD-005
- CLI-2.2-R4 → CLI-BLD-006
- CLI-2.4-R1 → CLI-CHK-009
- CLI-2.4-R2 → CLI-CHK-004, CLI-CHK-005
- CLI-2.4-R3 → CLI-CMD-004, CLI-CHK-010, CLI-CHK-011, CLI-SNAP-003, CLI-SNAP-004
- CLI-2.4-R4 → CLI-CHK-006
- CLI-2.4-R5 → CLI-CHK-007
- CLI-2.4-R6 → CLI-CHK-008
- CLI-3.4-R1 → CLI-CMD-006
- CLI-3.4-R2 → CLI-GEN-004, CLI-EXIT-010
- CLI-3.4-R3 → CLI-CMD-006, CLI-GEN-003
- CLI-3.4-R4 → CLI-LOAD-002, CLI-EXIT-003, CLI-EXIT-004, CLI-EXIT-005, CLI-EXIT-011, CLI-EXIT-012
- CLI-3.4-R5 → CLI-EXIT-006, CLI-EXIT-007, CLI-EXIT-008, CLI-SNAP-006, CLI-SNAP-007
- CLI-3.4-R6 → CLI-CHK-003, CLI-EXIT-009
- CLI-3.4-R7 → CLI-EXIT-014
- CLI-3.4-R8 → CLI-EXIT-001, CLI-EXIT-013
- CLI-3.4-R9 → CLI-EXIT-002
- CLI-4.3-R1 → CLI-BLD-003
- CLI-4.3-R2 → CLI-BLD-008
- CLI-5.1-R1 → CLI-BLD-009
- CLI-5.1-R2 → CLI-BLD-004
- CLI-5.3-R1 → CLI-BLD-007
- CLI-7.1-R1 → CLI-SNAP-005
- CLI-8.1-R1 → CLI-IS-001
- CLI-8.1-R2 → CLI-IS-002
- CLI-8.1-R3 → CLI-IS-003
- CLI-8.2-R1 → CLI-IS-004
- CLI-8.3-R1 → CLI-BOOL-001, CLI-BOOL-003, CLI-BOOL-005, CLI-BOOL-007
- CLI-8.3-R2 → CLI-BOOL-002, CLI-BOOL-004
- CLI-8.3-R3 → CLI-BOOL-006
- CLI-8.4-R1 → CLI-IS-005, CLI-IS-006, CLI-IS-007, CLI-IS-008, CLI-IS-009, CLI-IS-010, CLI-IS-011
- CLI-8.5-R1 → CLI-HLP-005
- CLI-9.1-R1 → CLI-FLG-001, CLI-FLG-002, CLI-FLG-003, CLI-FLG-004
- CLI-9.2-R1 → CLI-FLG-005, CLI-FLG-006, CLI-FLG-007, CLI-FLG-009, CLI-FLG-010, CLI-FLG-013
- CLI-9.2-R2 → CLI-FLG-008
- CLI-9.3-R1 → CLI-FLG-011
- CLI-9.4-R1 → CLI-FLG-012, CLI-FLG-017, CLI-FLG-018, CLI-FLG-019, CLI-FLG-020
- CLI-9.5-R1 → CLI-COL-001, CLI-COL-002
- CLI-9.5-R2 → CLI-COL-003
- CLI-9.6-R1 → CLI-CMD-003, CLI-HLP-001, CLI-HLP-002, CLI-HLP-003, CLI-HLP-004, CLI-HLP-007, CLI-HLP-011, CLI-SNAP-001, CLI-SNAP-002
- CLI-9.6-R2 → CLI-HLP-006
- CLI-9.6-R3 → CLI-HLP-008, CLI-HLP-009
- CLI-9.6-R4 → CLI-HLP-010
- CLI-9.6-R5 → CLI-CMD-003a
- CLI-10.1-R1 → CLI-LOAD-001, CLI-LOAD-008, CLI-ENT-004
- CLI-10.1-R2 → CLI-ENT-001, CLI-ENT-002, CLI-ENT-003
- CLI-10.1-R3 → CLI-LIFE-005, CLI-LIFE-006, CLI-LIFE-007
- CLI-10.2-R1 → CLI-LOAD-003, CLI-LOAD-004, CLI-CHK-001, CLI-CHK-002
- CLI-10.2-R2 → CLI-LOAD-005
- CLI-10.2-R3 → CLI-LOAD-006, CLI-LOAD-007
- CLI-10.2-R4 → CLI-LOAD-013, CLI-LOAD-014
- CLI-10.3-R1 → CLI-LIFE-001, CLI-LIFE-002, CLI-LIFE-003, CLI-LIFE-004
- CLI-10.4-R1 → CLI-CER-001
- CLI-10.5.1-R1 → CLI-LOAD-009, CLI-HLP-012, CLI-CHK-012
- CLI-10.5.1-R2 → CLI-LOAD-010
- CLI-10.5.4-R1 → CLI-LOAD-011, CLI-LOAD-012, RUN-SRC-001, RUN-SRC-002, RUN-SRC-003
- CLI-16.2-R1 → CLI-FLG-014, CLI-FLG-015, CLI-FLG-016
