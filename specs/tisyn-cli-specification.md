<!-- Generated from packages/spec/corpus — do not edit by hand. -->

# Tisyn CLI Specification

**Complements:** Tisyn Compiler Specification, Tisyn Configuration Specification

---

## 1. Overview

This document specifies `tsn`, the Tisyn command-line interface. `tsn` provides four commands: `tsn generate`, `tsn build`, `tsn run`, and `tsn check`.

### 1.1. Package and Binary

Package: `@tisyn/cli`. Binary: `tsn`.

- **MUST** — The `@tisyn/cli` package registers `tsn` as a `bin` entry in `package.json`.

### 1.2. Scope

The CLI owns command dispatch, compilation orchestration, descriptor loading and validation, module loading, invocation input parsing, startup lifecycle, and diagnostics. It does NOT own compiler graph semantics, runtime execution, descriptor data model, or transport protocols.

### 1.3. Relationship to the Config Specification

Invocation inputs flow through the workflow function's parameters. Resolved workflow config flows through `Config.useConfig()`. These are separate channels.

### 1.4. Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used as defined in RFC 2119.

## 2. Commands

The CLI surface consists of four commands.

### 2.1. tsn generate

Compile the workflow module graph rooted at one or more source files. Options include `--output/-o`, `--format` (default `printed`, also `json`), `--no-validate`, `--verbose`, `--help/-h`, `--version/-v`.

- **MUST NOT** — The CLI assembles source text, strips imports, or injects stubs for `tsn generate`; those are compiler responsibilities.
- **MUST** — `tsn generate` supports `--format printed` (default) and `--format json` output formats.
- **MUST** — `tsn generate` writes generated source to the `--output` path when specified, else to stdout.

### 2.2. tsn build

Config-driven multi-pass generation. Reads a build config file, infers pass ordering from import dependencies, and executes passes in dependency order. Options include `--config/-c`, `--filter`, `--verbose`, `--help`.

- **MUST** — If `--config` is not specified, `tsn build` walks from the current working directory toward the filesystem root and stops at the first `tisyn.config.ts` or `tisyn.config.json`.
- **MUST** — If no config is found, `tsn build` fails with exit code 2.
- **MUST** — `tsn build` with `--filter <name>` executes the named pass and its dependencies.
- **MUST** — `tsn build --filter` with an unknown name fails with exit code 2.

### 2.3. tsn run

Load a workflow descriptor, validate readiness, parse invocation inputs, and execute the workflow. Built-in options: `--entrypoint/-e`, `--verbose`, `--help/-h`. Additional workflow-derived flags come from the workflow's invocation input schema.

### 2.4. tsn check

Validate a workflow descriptor's readiness without executing. Validates descriptor validity and environment readiness. Options: `--entrypoint/-e`, `--env-example`, `--help/-h`.

- **MUST NOT** — `tsn check` validates specific invocation input values.
- **MUST NOT** — `tsn check` starts transports, servers, or executes the workflow.
- **MUST** — `tsn check --env-example` prints an environment variable template to stdout and exits 0.
- **MUST** — `tsn check --entrypoint <name>` applies the named entrypoint overlay before validation.
- **MAY** — `tsn check` may report an advisory invocation input schema when derivation succeeds.
- **MUST** — Schema derivation failure does not cause `tsn check` to fail; it is reported as a warning.

## 3. Process Lifecycle

Process lifecycle and exit code semantics for all commands (§3).

### 3.1. Effection Entrypoint

The CLI entrypoint uses Effection's `main()` for structured signal handling and scope boundaries.

### 3.2. Compilation Is Synchronous

For `tsn generate` and `tsn build`, rooted compilation via `compileGraph()` is synchronous. The CLI does not introduce unnecessary async boundaries.

### 3.3. tsn run Is Long-Lived

For `tsn run`, the process remains alive after startup completes. It exits when the workflow completes, errors, or the process receives an interrupt signal.

### 3.4. Exit Codes

Exit code 0 is success. Code 1 is a compilation error (generate/build). Code 2 is a structural descriptor, schema, or configuration error. Code 3 is an I/O error (module not found, file unreadable). Code 4 is an invocation input error (missing required input, type mismatch, unknown flag) for `run`. Code 5 is an environment validation error (missing required or secret env vars). Code 6 is a runtime execution error. This is the §3.4 exit code table.

- **MUST** — The CLI exits with the appropriate exit code and does not exit with code 0 when an error occurred.
- **MUST** — Unrecognized built-in CLI flags for `generate`, `build`, or `check` fail with exit code 2.
- **MUST** — Unknown top-level commands (e.g. `tsn foo`) and nonexistent root files for `tsn generate` are reported with exit codes 2 and 3 respectively.
- **MUST** — Code 2 applies to loaded-but-structurally-invalid content; code 3 applies when the CLI cannot locate or read a file or module at the filesystem level.
- **MUST** — Missing required invocation inputs, coercion failures, and unknown invocation flags for `tsn run` fail with exit code 4.
- **MUST** — Missing required or secret environment variables fail with exit code 5.
- **MAY** — Runtime execution errors during workflow execution are reported with exit code 6.
- **MUST** — A successful `tsn generate` or `tsn run` exits with code 0.
- **MUST** — Compilation errors during `tsn generate`/`tsn build` fail with exit code 1.

- **CLI-E0** — Success
- **CLI-E1** — Compilation error during `tsn generate` or `tsn build`
- **CLI-E2** — Descriptor, schema, or configuration structural error
- **CLI-E3** — I/O error — module not found, file not readable, permission denied
- **CLI-E4** — Invocation input error — missing required input, type mismatch, unknown flag
- **CLI-E5** — Environment validation error — missing required or secret env vars
- **CLI-E6** — Runtime execution error — workflow failure, transport error

## 4. Build Configuration

Build config file format and schema for `tsn build` (§4).

### 4.1. Build Config File

The build config file (`tisyn.config.ts` or `tisyn.config.json`) declares generation passes for `tsn build`. It is distinct from the workflow descriptor used by `tsn run`.

### 4.2. Config File Format

TypeScript format uses `defineConfig()` (a passthrough identity). JSON format uses the same schema without the wrapper function.

### 4.3. Config Schema

A `TsynConfig` has a `generates` array of `GeneratePass` entries with `name`, `roots`, `output`, optional `format`, `noValidate`, `dependsOn`. The CLI validates the config against this schema (§4.3).

- **MUST** — Build config validation: `generates` contains at least one entry; each `name` is unique and matches `[a-z][a-z0-9-]*`; each `roots` is non-empty; each root resolves to an existing file; each `output` is writable; `dependsOn` references name passes in `generates`.
- **MUST** — Legacy fields (e.g. `input`) on the build config are rejected as unknown with exit code 2.

## 5. Multi-Pass Ordering

Ordering and cross-pass-boundary handling for multi-pass builds (§5 pass dependency graph).

### 5.1. Import-Graph Inference

The CLI infers pass dependencies from declared roots and output paths. If a root's import graph references another pass's declared output, that pass runs first.

- **MUST** — The CLI infers pass dependencies from the declared roots' import graph and orders passes topologically.
- **MUST** — A dependency cycle detected during topological sorting fails with exit code 2 and a diagnostic.

### 5.2. dependsOn Escape Hatch

Explicit ordering for cases where dependencies are not visible in imports. Inferred and explicit edges are equivalent.

### 5.3. Cross-Pass Boundary Handling

Cross-pass boundaries are handled by the compiler during graph traversal. The CLI communicates prior pass output paths via `generatedModulePaths`.

- **MUST** — Cross-pass boundaries are communicated by passing prior pass output paths as `generatedModulePaths`. The CLI does not perform source-level stub injection or import stripping.

### 5.4. Single-Pass Shortcut

A single pass with no dependencies skips dependency analysis.

## 6. Source Assembly

Reserved section. Source assembly is no longer a CLI concern.

### 6.1. Reserved

This section is reserved. Source assembly, concatenation, deduplication, and filename derivation are compiler responsibilities.

## 7. Diagnostics

Error formatting and verbosity conventions.

### 7.1. Error Formatting

Compilation errors are formatted for terminal display with error code, message, and source location if available.

- **MUST** — Compilation errors are formatted for terminal display with error code, message, and source location if available.

### 7.2. Verbose Output

When `--verbose` is active, the CLI displays command-relevant details such as config provenance, pass inputs, and elapsed time.

### 7.3. Quiet Success

On success without `--verbose`, compilation commands print a single confirmation line to stderr when writing to a file, or no non-output content when writing to stdout.

## 8. Workflow Invocation Input Model

Schema contract and supported shapes for the workflow invocation input schema (§8).

### 8.1. Input Schema Contract

`tsn run` has access to a workflow invocation input schema (IS1, §8.1). Unsupported shapes in the schema fail with exit code 2 (IS2). Zero-parameter workflows produce no derived flags and are not a failure (IS3).

- **MUST** — IS1: The CLI must obtain a conforming workflow invocation input schema before parsing invocation flags; if no schema is available, it fails with exit code 2.
- **MUST** — IS2: If the obtained schema contains unsupported shapes, the CLI fails with exit code 2 and a diagnostic identifying the unsupported construct.
- **MUST** — IS3: A zero-parameter workflow has an empty schema, produces no derived invocation flags, and is not a failure.

### 8.2. Supported Shapes (v1)

S1: no inputs. S2: a single flat object parameter whose fields become derived invocation inputs. Supported field types: string, number, boolean, and their optional counterparts.

- **MUST** — S2: A flat object parameter is supported; each field of the object becomes a derived invocation input.

### 8.3. Boolean Semantics (v1 Design Choice)

Boolean fields follow a presence-flag model (§8.3). `boolean` and `boolean?` are equivalent in CLI mapping (B1). Presence sets `true`, absence sets `false` — never `undefined` (B2). `--no-flag` is unsupported in v1 (B3). These are owned design choices for v1 (B4).

- **MUST** — B1: `boolean` and `boolean?` are equivalent in CLI mapping — both produce an optional presence flag.
- **MUST** — B2: Supplying `--flag` sets the value to `true`; omitting it sets the value to `false`. The CLI always provides a concrete `boolean`, never `undefined`.
- **MUST** — B3: `--no-flag` negation syntax is unsupported in v1 and yields exit code 4.

### 8.4. Unsupported Shapes

Rejected shapes (§8.4) include multiple parameters, non-object parameters, array-typed fields, nested object fields, union-typed fields other than `T | undefined`, enums, tuples, mapped types, and `EnvDescriptor` or config-node-typed fields.

- **MUST** — Schema derivation rejects multiple parameters, non-object parameter types, array-typed fields, nested object fields, union-typed fields (other than `T | undefined`), enum/tuple/mapped types, and fields typed as `EnvDescriptor` or any config-node type.

### 8.5. JSDoc Descriptions

If a field has a JSDoc comment or `@param` annotation, the description should be included in help output.

- **SHOULD** — If a field has a JSDoc or `@param` annotation, its description is included in help output.

## 9. CLI Flag Mapping and Help

Flag derivation, mapping, coercion, and help generation for `tsn run` (§9).

### 9.1. Name Conversion

Field names are converted from `camelCase` to `--kebab-case` (§9.1) by splitting on uppercase boundaries.

- **MUST** — Field names are converted from `camelCase` to `--kebab-case` by splitting on uppercase boundaries, lowercasing, and joining with hyphens.

### 9.2. Required vs. Optional

Non-boolean non-optional fields must be supplied via their CLI flag. Missing required fields cause exit code 4 with a diagnostic listing all missing inputs. Optional fields may be omitted; omitted values are `undefined` in the workflow parameter object.

- **MUST** — Non-boolean non-optional fields are supplied via their CLI flag; missing required fields cause exit code 4 with a diagnostic listing all missing inputs.
- **MUST** — Optional fields may be omitted; omitted values are `undefined`.

### 9.3. Value Coercion

`string` uses the value verbatim. `number` uses `parseFloat`; `NaN` yields exit code 4. `boolean` follows presence semantics.

- **MUST** — Value coercion: `string` is verbatim; `number` uses `parseFloat`, and `NaN` causes exit code 4.

### 9.4. Unknown Flags

During `tsn run` input parsing (§9.4), any CLI token in the workflow-input remainder that does not match a derived invocation input causes exit code 4. This includes unknown long flags, short flags, and bare positional arguments.

- **MUST** — During `tsn run` input parsing, any CLI token in the workflow-input remainder that does not match a derived input (including unknown long flags, short flags, and bare positionals) causes exit code 4.

### 9.5. Flag Collision

Collision is checked on the derived kebab-case flag names. If a derived flag collides with a built-in option, the built-in takes precedence; the workflow parameter must be renamed. The CLI should emit an advisory diagnostic noting the collision.

- **MUST** — Collision is checked on derived kebab-case flag names. If a derived flag collides with a built-in option, the built-in takes precedence and the workflow parameter must be renamed.
- **SHOULD** — The CLI emits an advisory diagnostic noting a flag collision.

### 9.6. Help Generation

Static help (`tsn run --help` with no module) shows built-in options. Dynamic help (`tsn run <module> --help`) loads the descriptor and shows usage, built-in options, workflow-derived flags, and entrypoints. On help-path failure, the CLI shows built-in options and a diagnostic explaining why workflow-derived flags cannot be shown, then exits with the appropriate error code (§9.6).

- **MUST** — Dynamic help for `tsn run <module> --help` produces a usage line, built-in options, workflow-derived flags with type and required/optional status and descriptions, and named entrypoints from the descriptor.
- **MUST** — Help describes invocation inputs only and must not describe resolved workflow config or `Config.useConfig()` internals.
- **MUST** — If module loading, descriptor validation, or schema derivation fails during dynamic help, the CLI displays built-in options and a diagnostic explaining why workflow-derived flags cannot be shown, then exits with the appropriate error code.
- **MUST NOT** — Help silently omits the workflow inputs section without explanation.
- **MUST** — Static help (`tsn run --help` with no module argument) displays the command's built-in options and usage and exits 0 without loading any descriptor or workflow metadata.

## 10. Startup Lifecycle (`tsn run`)

Lifecycle orchestration for `tsn run` (§10).

### 10.1. End-to-End Sequence

Phase A (load/validate descriptor) precedes Phase B (derive/validate inputs) precedes Phase C (resolve environment) precedes Phase D (execute). Steps 1–12 are performed in order.

- **MUST** — `tsn run <module>` performs the steps of §10.1 in order: module loading, run-target resolution, entrypoint overlay, descriptor validation, schema derivation, input parsing, environment collection, environment resolution, environment validation, resource startup, workflow execution, and process lifecycle.
- **MUST** — If `--entrypoint` is specified, the named entrypoint overlay is applied; an unknown name fails with exit code 2.
- **MUST** — The workflow receives validated invocation arguments, and resolved workflow config is accessed via `yield* Config.useConfig(Token)`. Invocation arguments and `Config.useConfig()` return values are separate channels.

### 10.2. Module Contracts

Module contracts (§10.2). M1: the descriptor module must have a `default` export that is a valid `WorkflowDescriptor`. M2: the workflow function module must export the entrypoint under the `run.export` name. M3: `run.module`, if specified, is resolved relative to the descriptor module.

- **MUST** — M1: The descriptor module has a `default` export that is a valid `WorkflowDescriptor`.
- **MUST** — M2: The workflow function module exports the workflow entrypoint under the name specified by `run.export`.
- **MUST** — M3: `run.module`, if specified, is resolved relative to the descriptor module's location.
- **MUST** — When `run.module` points to a generated workflow module, the CLI loads it at runtime and the compiler is not invoked. The descriptor module itself is runtime-loaded and is not treated as a workflow compilation root.

### 10.3. Fail-Before-Execute

Phases A–C must succeed before any transport starts or any workflow executes.

- **MUST** — Phases A–C (steps 1–9) must succeed before any transport starts (step 10) or any workflow executes (step 11).

### 10.4. Combined Error Reporting

When both invocation input errors and environment errors exist, the CLI should report both before exiting.

- **SHOULD** — When both invocation input errors and environment errors exist, the CLI reports both before exiting.

### 10.5. Module Loading

Module loading for descriptor, workflow, and transport binding modules (§10.5).

#### 10.5.1. Supported Module Inputs

`tsn run` and `tsn check` accept both TypeScript (`.ts`, `.mts`, `.cts`) and JavaScript (`.js`, `.mjs`, `.cjs`) descriptor modules. `.tsx` is not supported.

- **MUST** — `tsn run` and `tsn check` accept TypeScript (`.ts`, `.mts`, `.cts`) and JavaScript (`.js`, `.mjs`, `.cjs`) descriptor modules.
- **MUST** — `.tsx` is not a supported module extension; unsupported extensions fail with exit code 3 and an unsupported-extension diagnostic.

#### 10.5.2. Bootstrap Loading

Module loading for `tsn run` and `tsn check` occurs before any Effection scope exists. The CLI uses a bootstrap loading path (§10.5.2) — a plain async function — for all pre-scope module loading.

#### 10.5.3. Shared Default Implementation

The default module-loading logic is owned by `@tisyn/runtime` and exported as `loadModule()` (§10.5.3).

#### 10.5.4. Module Loading vs. Workflow Source Compilation

When `run.module` points to authored workflow source, the CLI uses the Tisyn compiler via `compileGraphForRuntime()` — not module loading — to produce IR.

- **MUST** — When `run.module` points to authored workflow source, the CLI uses the Tisyn compiler to produce IR. Module loading must not replace workflow source compilation.

#### 10.5.5. Module Loading Errors

Module-loading errors (unsupported extension, module not found, syntax error, loader init failure, evaluation failure) are reported with exit code 3.

#### 10.5.6. Runtime Context API

`Runtime` is a context API exported from `@tisyn/runtime` via `createApi()` (§10.5.6). It exposes `loadModule` as a middleware-interceptable capability via `Runtime.around()`.

## 11. Validation Summary

Validation categories and their independence.

### 11.1. Validation Categories

Descriptor validation (exit 2), input schema validation (exit 2), input value validation (exit 4), and environment validation (exit 5) are distinct.

### 11.2. Independence

Descriptor validation, input validation, and environment validation are independent concerns. All must succeed before execution starts.

## 12. Compiler API

The CLI's relationship to the compiler's public API.

### 12.1. compileGraph() Is the Core

The CLI invokes `compileGraph()` for rooted compilation. It does not read workflow source files, resolve imports, classify modules, concatenate source, strip imports, or inject stubs.

### 12.2. What the CLI Adds

Beyond compilation, the CLI provides file I/O, multi-pass orchestration, generated-module path handoff, diagnostics, and workflow invocation lifecycle.

## 13. Migration Path

Migration from legacy build scripts to `tsn` commands.

### 13.1. tsn generate Replaces build-workflow.ts

`tsn generate` replaces legacy `build-workflow.ts` scripts.

### 13.2. tsn build Replaces build-test-workflows.ts

`tsn build` replaces `build-test-workflows.ts`.

### 13.3. tsn run Replaces host.ts

`tsn run` replaces bespoke host.ts drivers.

### 13.4. Remove Legacy Compiler Binary

`tisyn-compile` is removed once `tsn` is established (§13.4).

## 14. Explicit Non-Goals

Watch mode, plugin system, incremental generation, IDE integration, remote inputs, parallel pass execution, `tsn validate`/`tsn print`, advanced input shapes, boolean negation syntax, and input defaults from descriptors are deferred.

## 15. Risks

Known risks.

### 15.1. Compiler API Stability

The CLI depends on `compileGraph()` and its public result shape. The rooted compiler entry point must be treated as stable public API.

### 15.2. Rooted Graph Boundary Drift

The CLI must not reintroduce source assembly, stub injection, or its own import classification logic.

### 15.3. Input Derivation Scope

The v1 input model supports only flat primitive-field objects. Complex shapes require alternative input mechanisms.

## 16. Non-Normative Implementation Notes

Implementation guidance that is not a normative requirement.

### 16.1. CLI Parsing Backend

The CLI may use Configliere or any other parsing library. No normative concept depends on a particular library.

### 16.2. Two-Phase Parsing Model for tsn run

Phase 1 parses built-in command options into a consumed set, leaving the remainder. Phase 2 loads the descriptor and parses the remainder against derived flags. The remainder is the sole source of workflow invocation flags — built-in options like `--verbose` and `--entrypoint` must not leak into workflow flag parsing. This two-phase model (§16.2) is an implementation concern, not a normative requirement.

- **MUST** — The CLI must not derive workflow flags from raw `process.argv`; built-in options such as `--verbose` and `--entrypoint` are consumed in Phase 1 and must not leak into workflow-derived flag parsing.

### 16.3. Input Schema Derivation Mechanism

How the schema is obtained is an implementation choice. Options include extracting from source, emitting metadata, or reading declaration files.

### 16.4. Provenance

When `--verbose` is active, the CLI should display the resolved value and origin of each flag and environment variable.

## Final Consistency Changes

1. **Exit code 2 vs 3 boundary.** Code 2 and code 3 had
   overlapping coverage ("module not found" appeared
   under code 2; "file not found" under code 3). The
   boundary is now unambiguous: code 3 applies when the
   CLI cannot locate or read a file at the filesystem
   level; code 2 applies when a file was loaded but its
   contents are structurally invalid. §10.1 step 1 now
   specifies both failure modes explicitly.

2. **M2 softened.** "Compiled workflow function" replaced
   with "workflow entrypoint function" plus "the CLI does
   not prescribe how this function was produced." The
   module contract is now stable regardless of compiler
   or runtime internals.

3. **`tsn check` example qualified.** The output example
   now labels the invocation inputs section as
   "(advisory)" and adds prose clarifying that the
   section is omitted when schema derivation fails or
   is not attempted.

4. **Document ending consolidated.** The previous
   "Remaining Open Questions" and "Final Cleanup Changes"
   sections merged into this single section.

**Open question.** One question remains genuinely
unresolved: whether flag collisions (§9.5) should be
handled by built-in-wins precedence (current rule) or
by namespacing workflow inputs (e.g., `--input.max-turns`).
The current rule is simpler. This may be revisited if
collision surprises users in practice.
