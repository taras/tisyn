# Tisyn CLI Specification

**Version:** 0.3.4
**Complements:** Tisyn Compiler Specification 1.2.0, Tisyn Configuration Specification 0.4.1
**Status:** Draft

---

## 1. Overview

This document specifies `tsn`, the Tisyn command-line interface.

`tsn` provides four commands:

- `tsn generate` — compile one workflow source into a generated
  module
- `tsn build` — run config-driven multi-pass generation
- `tsn run` — load a workflow descriptor, validate readiness,
  and execute
- `tsn check` — validate descriptor readiness without executing

### 1.1 Package and Binary

Package: `@tisyn/cli`. Binary: `tsn`.

The package MUST register `tsn` as a `bin` entry in
`package.json`.

### 1.2 Scope

The CLI is responsible for:

- command dispatch, flag parsing, and help generation
- source assembly and compilation orchestration
  (`generate`, `build`)
- workflow descriptor loading, entrypoint selection, and
  environment validation (`run`, `check`)
- workflow invocation input parsing from CLI flags (`run`)
- startup lifecycle orchestration (`run`)
- diagnostics formatting and process lifecycle (all commands)

The CLI is NOT responsible for:

- IR lowering or validation (compiler)
- IR execution, replay, or transport management (runtime)
- descriptor data model, constructor vocabulary, or
  `Config.useConfig()` semantics (config specification)
- transport protocols (transport specification)

### 1.3 Relationship to the Config Specification

The config specification defines `WorkflowDescriptor` shapes,
`EnvDescriptor` semantics, entrypoint overlay rules, and the
`Config.useConfig()` contract.

This CLI specification defines how the CLI loads, validates,
and acts on those structures. In particular:

- **Invocation inputs** (CLI-derived, user-facing) flow
  through the workflow function's parameters.
- **Resolved workflow config** (descriptor-derived,
  deployment-facing) flows through `Config.useConfig()`.

These are separate channels. This specification governs
invocation inputs. The config specification governs
`Config.useConfig()`.

### 1.4 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY
are used as defined in RFC 2119.

---

## 2. Commands

### 2.1 `tsn generate`

Single-file generation. Compiles one set of source files into
one output module.

```
tsn generate <input> [options]
```

**Arguments:**

| Argument | Required | Description |
| --- | --- | --- |
| `input` | YES | Path to declaration file (`.ts`) |

**Options:**

| Flag | Alias | Default | Description |
| --- | --- | --- | --- |
| `--output <path>` | `-o` | stdout | Output file path |
| `--format <type>` | | `printed` | Output format: `printed` or `json` |
| `--no-validate` | | validate | Skip IR validation |
| `--include <glob>` | `-i` | | Additional workflow files to include |
| `--verbose` | | false | Show detailed diagnostics |
| `--help` | `-h` | | Show help |
| `--version` | `-v` | | Show version |

**Behavior:**

1. Parse and validate options.
2. Read the declaration file at `<input>`.
3. If `--include` is specified, read each matching workflow
   file.
4. Concatenate declaration source with workflow source texts,
   separated by blank lines (§6).
5. Call `generateWorkflowModule()` with the concatenated
   source.
6. If `--output` is specified, write the generated source to
   the file. Otherwise, write to stdout.
7. Exit with code 0 on success.

### 2.2 `tsn build`

Config-driven multi-pass generation. Reads a build config
file, infers pass ordering from import dependencies, and
executes passes in dependency order.

```
tsn build [options]
```

**Options:**

| Flag | Alias | Default | Description |
| --- | --- | --- | --- |
| `--config <path>` | `-c` | auto-discover | Build config file path |
| `--filter <n>` | | | Run only the named pass |
| `--verbose` | | false | Show detailed diagnostics |
| `--help` | `-h` | | Show help |

**Config auto-discovery:** If `--config` is not specified, the
CLI MUST walk from the current working directory toward the
filesystem root, stopping at the first directory that contains
a file named `tisyn.config.ts` or `tisyn.config.json`. If
none is found, the CLI MUST fail with exit code 2.

**Behavior:**

1. Locate and load the build config file (§4).
2. Validate the config against the schema (§4.3).
3. Resolve all paths relative to the config file's directory.
4. Build the pass dependency graph (§5).
5. Topological-sort passes. If a cycle is detected, fail with
   exit code 2.
6. If `--filter` is specified, execute only the named pass
   (and its dependencies). Unknown name → exit code 2.
7. For each pass in dependency order:
   a. Read source files.
   b. Inject stubs if needed (§5.3).
   c. Concatenate sources (§6).
   d. Call `generateWorkflowModule()`.
   e. Write generated output.
8. Exit with code 0 on success.

### 2.3 `tsn run`

Load a workflow descriptor, validate readiness, parse
invocation inputs, and execute the workflow.

```
tsn run <module> [options]
```

**Arguments:**

| Argument | Required | Description |
| --- | --- | --- |
| `module` | YES | Path to a module exporting a `WorkflowDescriptor` as its default export |

**Built-in options:**

| Flag | Alias | Description |
| --- | --- | --- |
| `--entrypoint <n>` | `-e` | Apply a named entrypoint overlay |
| `--verbose` | | Show detailed diagnostics |
| `--help` | `-h` | Show help (includes workflow-derived flags) |

**Workflow-derived flags:** Additional flags are derived from
the workflow's invocation input schema (§8). These appear in
`--help` output alongside built-in options.

**Behavior:** See §10 (Startup Lifecycle).

**Examples:**

```bash
tsn run workflow.ts
tsn run workflow.ts --entrypoint dev
tsn run workflow.ts --max-turns 10 --model claude-sonnet
tsn run workflow.ts --help
```

### 2.4 `tsn check`

Validate a workflow descriptor's readiness without executing.

```
tsn check <module> [options]
```

**Arguments:**

| Argument | Required | Description |
| --- | --- | --- |
| `module` | YES | Path to a module exporting a `WorkflowDescriptor` as its default export |

**Options:**

| Flag | Alias | Description |
| --- | --- | --- |
| `--entrypoint <n>` | `-e` | Apply a named entrypoint overlay |
| `--env-example` | | Print environment variable template to stdout |
| `--help` | `-h` | Show help |

**Scope.** `tsn check` validates two categories of
deployment readiness:

1. **Descriptor validity.** The merged descriptor conforms
   to config-owned validation rules.
2. **Environment readiness.** All required and secret
   environment variables referenced by the descriptor are
   set in the current environment.

`tsn check` MAY additionally report whether a well-formed
invocation input schema can be derived from the workflow
entrypoint. This is an **advisory diagnostic only**. Schema
derivation failure does not cause `tsn check` to fail —
it is reported as a warning.

`tsn check` MUST NOT validate specific invocation input
values. It does not parse `--max-turns 10` or check
whether required inputs are supplied. That is `tsn run`'s
responsibility.

`tsn check` MUST NOT start transports, servers, or execute
the workflow.

**Output example** (when schema derivation succeeds):

```
Workflow: chat (from ./workflow.ts)
Entrypoint: dev

Environment variables:
  JOURNAL_PATH    optional    default: "./data/chat.journal"
  PORT            optional    default: 3000

Invocation inputs (advisory):
  --max-turns <n>     number (required)
  --model <s>         string (optional)

✓ All checks passed.
```

If schema derivation fails or is not attempted, the
invocation inputs section is omitted and a warning MAY
be shown instead.

**Exit codes:** Per §3 (exit code table).

---

## 3. Process Lifecycle

### 3.1 Effection Entrypoint

The CLI entrypoint MUST use Effection's `main()` function.
This provides structured SIGINT/SIGTERM handling, clean
process exit, and a scope boundary for async operations.

### 3.2 Compilation Is Synchronous

For `tsn generate` and `tsn build`, `generateWorkflowModule()`
is a pure synchronous function. The CLI MUST NOT introduce
unnecessary async boundaries around it.

### 3.3 `tsn run` Is Long-Lived

For `tsn run`, the process remains alive after startup
completes. It exits when the workflow completes, errors, or
the process receives SIGINT/SIGTERM. The runtime owns
structured shutdown. The CLI owns exit code mapping.

### 3.4 Exit Codes

| Code | Category | Applies to |
| --- | --- | --- |
| 0 | Success | all |
| 1 | Compilation error | generate, build |
| 2 | Descriptor, schema, or configuration error (structural) | all |
| 3 | I/O error (module not found, file not readable, permission denied) | all |
| 4 | Invocation input error (missing required input, type mismatch, unknown flag) | run |
| 5 | Environment validation error (missing required or secret env vars) | run, check |
| 6 | Runtime execution error (workflow failure, transport error) | run |

The CLI MUST exit with the appropriate code. It MUST NOT
exit with code 0 when an error occurred.

**Boundary between code 2 and code 3.** Code 3 applies when
the CLI cannot locate or read a file or module at the
filesystem level — the path does not resolve, the file does
not exist, or the OS denies access. Code 2 applies when a
file or module was successfully loaded but its contents are
structurally invalid — the default export is not a valid
`WorkflowDescriptor`, a named entrypoint does not exist, or
the invocation input schema is unsupported.

**Exit code 2 covers:**

- Unrecognized built-in CLI flags (for `generate`, `build`,
  `check`; for `tsn run` unknown flags are code 4 — see §9.4)
- Default export is not a valid `WorkflowDescriptor`
- Named entrypoint not found in descriptor
- Descriptor fails config-owned validation
- Invocation input schema unavailable or contains
  unsupported shapes (§8.1 IS1, IS2)

These are **structural errors** discoverable after loading.
They contrast with code 3 (cannot load at all), code 4
(user-provided invocation values are wrong), and code 5
(deployment environment is misconfigured).

---

## 4. Build Configuration

### 4.1 Build Config File

The build config file (`tisyn.config.ts` or
`tisyn.config.json`) declares generation passes for
`tsn build`. It is distinct from the workflow descriptor
used by `tsn run`.

### 4.2 Config File Format

**TypeScript format:**

```typescript
import { defineConfig } from "@tisyn/cli";

export default defineConfig({
  generates: [
    {
      name: "dom-workflows",
      input: "workflows/dom-declarations.ts",
      include: ["workflows/dom/**/*.workflow.ts"],
      output: "dom-workflows.generated.ts",
      format: "json",
    },
  ],
});
```

`defineConfig()` is a passthrough identity function for
TypeScript type inference.

**JSON format** (`tisyn.config.json`) uses the same schema
without the wrapper function.

### 4.3 Config Schema

```typescript
interface TsynConfig {
  generates: GeneratePass[];
}

interface GeneratePass {
  name: string;
  input: string;
  include?: string[];
  output: string;
  format?: "printed" | "json";
  noValidate?: boolean;
  dependsOn?: string[];
}
```

**Validation rules:**

- `generates` MUST contain at least one entry.
- Each `name` MUST be unique and match `[a-z][a-z0-9-]*`.
- Each `input` MUST resolve to an existing file.
- Each `output` MUST be writable.
- `dependsOn` references MUST name passes in `generates`.

---

## 5. Multi-Pass Ordering

### 5.1 Import-Graph Inference

The CLI MUST infer pass dependencies from the import graph
of source files. For each pass, the CLI collects source files
and extracts relative import specifiers. If an import
resolves to another pass's output path, the other pass MUST
run first.

### 5.2 `dependsOn` Escape Hatch

Explicit ordering for cases where dependencies are not
visible in imports. Inferred and explicit edges are
equivalent.

### 5.3 Cross-Pass Stub Injection

When pass `B` depends on pass `A`, the CLI MUST inject
declaration stubs into `B`'s source for contracts and
workflows exported by `A`'s generated module. Import
declarations referencing `A`'s output MUST be stripped
and replaced by stubs.

### 5.4 Single-Pass Shortcut

A single pass with no dependencies skips dependency analysis.

---

## 6. Source Assembly

### 6.1 Concatenation Model

For `tsn generate` and each pass in `tsn build`, source
assembly order is: declaration file, blank line, cross-pass
stubs (if any), blank line, workflow files.

### 6.2 Filename

The CLI MUST pass a `filename` option to
`generateWorkflowModule()` for error messages.

### 6.3 Deduplication

If the declaration file matches an `include` glob, the CLI
MUST NOT include it twice.

---

## 7. Diagnostics

### 7.1 Error Formatting

Compilation errors MUST be formatted for terminal display
with error code, message, and source location if available.

### 7.2 Verbose Output

When `--verbose` is active, the CLI MUST display command-
relevant details: config provenance, pass names and inputs,
discovered contracts/workflows, elapsed time, and for
`tsn run`, descriptor loading and environment resolution
details.

### 7.3 Quiet Success

On success without `--verbose`, compilation commands MUST
print a single confirmation line to stderr when writing to
a file, or no non-output content when writing to stdout.

---

## 8. Workflow Invocation Input Model

### 8.1 Input Schema Contract

`tsn run` MUST have access to a **workflow invocation input
schema** in order to parse invocation flags. The input schema
describes the fields the workflow function accepts as its
invocation-time parameter: their names, types, optionality,
and descriptions.

IS1. The CLI MUST obtain a conforming input schema before
     parsing invocation flags. If no schema is available,
     the CLI MUST fail with exit code 2.

IS2. If the obtained schema contains unsupported shapes
     (§8.4), the CLI MUST fail with exit code 2 and a
     diagnostic identifying the unsupported construct.

IS3. If the workflow function accepts zero parameters, the
     schema is empty. No invocation flags are derived.
     This is not a failure.

The input schema is separate from the `WorkflowDescriptor`.
It describes what the user provides at invocation time. The
descriptor describes deployment-time configuration. How the
schema is obtained — whether extracted from source, emitted
as metadata, or provided by other means — is an
implementation concern (§16.2), not a normative requirement
of this specification.

### 8.2 Supported Shapes (v1)

In this version of the specification, the input schema
supports two shapes:

**S1. No inputs.** The workflow function accepts zero
parameters. No invocation flags are derived.

**S2. Flat object parameter.** The workflow function accepts
exactly one parameter of object type. Each field of the
object becomes a derived invocation input.

Supported field types:

| Field type | CLI behavior |
| --- | --- |
| `string` | `--flag <value>` (required) |
| `number` | `--flag <n>` (required, coerced) |
| `boolean` | `--flag` (optional presence flag) |
| `string?` | `--flag <value>` (optional) |
| `number?` | `--flag <n>` (optional) |
| `boolean?` | `--flag` (optional presence flag) |

### 8.3 Boolean Semantics (v1 Design Choice)

Boolean fields follow a presence-flag model. This is a
**deliberate v1 simplification** that trades expressiveness
for predictability.

B1. `boolean` and `boolean?` are **equivalent** in CLI
    mapping. Both produce an optional presence flag. This
    intentional collapse means required boolean fields in
    TypeScript are not represented as required CLI flags.

B2. Supplying `--flag` sets the value to `true`.
    Omitting `--flag` sets the value to `false`.
    The CLI always provides a concrete `boolean` value to
    the workflow function, never `undefined`.

B3. Negation syntax (`--no-flag`) is intentionally
    unsupported in v1. Explicit `false` is representable
    only by omitting the flag.

B4. These rules are owned design choices for v1, not
    accidental limitations. Future versions MAY introduce
    `--no-flag` negation, required boolean semantics, or
    `--flag=true`/`--flag=false` value syntax.

### 8.4 Unsupported Shapes

The following shapes MUST be rejected at schema derivation
time with a diagnostic identifying the unsupported
construct:

- Multiple parameters
- Non-object parameter types
- Array-typed fields
- Nested object fields
- Union-typed fields (other than `T | undefined`)
- Enum, tuple, or mapped types
- Fields typed as `EnvDescriptor` or any config node type

### 8.5 JSDoc Descriptions

If a field has a JSDoc comment or `@param` annotation, the
description SHOULD be included in help output (§9). Fields
without JSDoc appear in help without a description.

---

## 9. CLI Flag Mapping and Help

### 9.1 Name Conversion

Field names MUST be converted from `camelCase` to
`--kebab-case`:

| Field | Flag |
| --- | --- |
| `maxTurns` | `--max-turns` |
| `model` | `--model` |
| `outputDir` | `--output-dir` |

The conversion splits on uppercase boundaries, lowercases
all segments, and joins with hyphens.

### 9.2 Required vs. Optional

Non-boolean, non-optional fields MUST be supplied via their
CLI flag. Missing required fields cause exit code 4 with a
diagnostic listing all missing inputs.

Optional fields MAY be omitted. Omitted values are
`undefined` in the workflow parameter object. Boolean fields
follow §8.3.

### 9.3 Value Coercion

| Type | Rule |
| --- | --- |
| `string` | Value used verbatim |
| `number` | `parseFloat(value)`. `NaN` → exit code 4. |
| `boolean` | Presence → `true`. Absence → `false`. |

### 9.4 Unknown Flags

During `tsn run` input parsing (§10.1 step 6), any CLI
token in the workflow-input remainder that does not match a
derived invocation input MUST cause exit code 4 with a
diagnostic. This includes unknown `--` flags, short flags
(`-x`), and bare positional arguments. The v1 invocation
surface is long flags only; no short-flag aliases or
positional workflow arguments are supported.

### 9.5 Flag Collision

Collision is checked on the **derived kebab-case flag
names** (after §9.1 name conversion), not on raw parameter
identifiers. For example, a workflow parameter named
`verbose` produces `--verbose`, which collides with the
built-in `--verbose` option.

If a derived flag name collides with a built-in option, the
built-in takes precedence. The CLI SHOULD emit an advisory
diagnostic noting the collision. The workflow parameter MUST
be renamed to avoid the conflict.

### 9.6 Help Generation

Help for `tsn run` has two modes:

**Static help.** `tsn run --help` (no module argument)
displays the command's built-in options and usage, then
exits 0. No descriptor or workflow metadata is loaded.

**Dynamic help.** `tsn run <module> --help` MUST produce:

1. **Usage line.**
2. **Built-in options.** `--entrypoint`, `--verbose`,
   `--help`.
3. **Workflow inputs.** Derived flags with type, required/
   optional status, and descriptions.
4. **Entrypoints.** Named entrypoints from the descriptor,
   if any.

Dynamic help requires loading the descriptor module and
deriving the input schema. Help describes invocation inputs
only. It MUST NOT describe resolved workflow config or
`Config.useConfig()` internals.

**Help failure behavior.** If module loading, descriptor
validation, or schema derivation fails during dynamic help,
the CLI MUST display built-in options and a diagnostic
explaining why workflow-derived flags cannot be shown, then
exit with the appropriate error code (§3.4). It MUST NOT
silently omit the workflow inputs section without
explanation.

---

## 10. Startup Lifecycle (`tsn run`)

### 10.1 End-to-End Sequence

When `tsn run <module>` is invoked, the CLI MUST perform
the following steps in order:

**Phase A: Load and Validate Descriptor**

1. **Module loading.** Evaluate the module at `<module>` and
   extract its `default` export. If the module cannot be
   located or read, fail with exit code 3. If the default
   export is not a valid `WorkflowDescriptor`, fail with
   exit code 2.

2. **Run target resolution.** Resolve the descriptor's `run`
   field to a workflow function. If `run.module` is
   specified, import that module and locate the named export.
   If `run.module` is omitted, locate the named export in the
   same module that produced the descriptor (§10.2). If the
   export does not exist, fail with exit code 2.

3. **Entrypoint overlay.** If `--entrypoint` is specified,
   look up the named entrypoint and apply the overlay per the
   config specification. Unknown name → exit code 2.

4. **Descriptor validation.** Validate the merged descriptor
   against config-owned validation rules. Failure →
   exit code 2.

**Phase B: Derive and Validate Inputs**

5. **Input schema derivation.** Obtain the invocation input
   schema for the workflow function per §8. If the schema
   contains unsupported shapes, fail with exit code 2.

6. **Input parsing.** Parse CLI flags against the derived
   schema per §9. Missing required inputs, coercion
   failures, or unknown flags → exit code 4.

**Phase C: Resolve Environment**

7. **Environment collection.** Walk the merged descriptor
   and collect all `EnvDescriptor` nodes.

8. **Environment resolution.** Resolve each node per the
   config specification. Record missing required/secret
   variables.

9. **Environment validation.** If any required or secret
   variables are missing, report ALL missing variables in
   a single diagnostic and fail with exit code 5.

**Phase D: Execute**

10. **Resource startup.** Create journal. Start server if the
    merged descriptor includes one, producing a
    `LocalServerBinding` (address and accepted-connection
    stream). Load local/inprocess module bindings. For each
    binding that provides a `bindServer` hook, call it with
    the server binding. `bindServer` is a setup-only hook: it
    MUST spawn any long-lived work (e.g., connection
    acceptance loops) and return promptly. Install all agent
    transports.

    The ordering MUST be: server start, then bind, then
    transport installation, then workflow execution. This
    ensures browser connection handling is ready before
    any workflow can trigger connections.

    `LocalAgentBinding` and `LocalServerBinding` are defined
    in `@tisyn/transport`. Local/inprocess modules export
    `createBinding()` (preferred) or `createTransport()`
    (backward-compatible fallback). See the config
    specification §10 Q1 for module contract details.

11. **Workflow execution.** Invoke the workflow function with
    validated invocation arguments. Make resolved workflow
    config available through `yield* Config.useConfig(Token)`.

12. **Process lifecycle.** Remain alive until the workflow
    completes, errors, or SIGINT/SIGTERM. Map outcome to
    exit code per §3.4.

### 10.2 Module Contracts

`tsn run` loads two artifacts, which MAY or MAY NOT reside
in the same module:

| Artifact | Role | How identified |
| --- | --- | --- |
| **Descriptor module** | The module loaded by the CLI | `<module>` argument to `tsn run` |
| **Workflow function module** | The module containing the executable workflow function | `run` field of the descriptor |

When `run.module` is omitted, the workflow function is
resolved from the descriptor module itself. When `run.module`
is specified, the CLI imports that module separately.

The CLI imposes no constraint on whether these modules are
authored source, generated output, or any other form. The
contract is:

M1. The descriptor module MUST have a `default` export
    that is a valid `WorkflowDescriptor`.

M2. The workflow function module MUST export the workflow
    entrypoint function under the name specified by
    `run.export`. The CLI does not prescribe how this
    function was produced.

M3. `run.module`, if specified, is resolved relative to
    the descriptor module's location.

### 10.3 Fail-Before-Execute

Phases A–C (steps 1–9) MUST succeed before any transport
starts (step 10) or any workflow executes (step 11).

### 10.4 Combined Error Reporting

When both invocation input errors and environment errors
exist, the CLI SHOULD report both before exiting, rather
than failing on the first category and hiding the second.

To support this, the CLI MAY continue collecting pre-
execution validation diagnostics after detecting an initial
validation failure in steps 6–9, solely to improve the
quality of the error report. This does not change the
sequencing of §10.1 — the steps remain ordered — but the
CLI is not required to abort immediately on the first
validation error within the pre-execution phases.

---

## 11. Validation Summary

### 11.1 Validation Categories

| Category | What it checks | When it runs | Failure code |
| --- | --- | --- | --- |
| **Descriptor validation** | Descriptor structure, agent uniqueness, transport requirements | §10.1 step 4 | 2 |
| **Input schema validation** | Supported parameter shapes | §10.1 step 5 | 2 |
| **Input value validation** | Required inputs present, coercion succeeds, no unknown flags | §10.1 step 6 | 4 |
| **Environment validation** | Required/secret env vars set | §10.1 step 9 | 5 |

### 11.2 Independence

Descriptor validation, input validation, and environment
validation are independent concerns. Passing one does not
imply passing another. All three MUST succeed before
execution starts.

---

## 12. Compiler API

### 12.1 `generateWorkflowModule()` Is the Core

The CLI wraps `generateWorkflowModule()` for compilation. It
does NOT introduce a new compilation API, replace it, or
bypass it.

### 12.2 What the CLI Adds

Beyond compilation, the CLI provides: file I/O, multi-pass
orchestration, source assembly, and workflow invocation
lifecycle.

---

## 13. Migration Path

### 13.1 `tsn generate` Replaces `build-workflow.ts`

```json
{ "build:workflow": "tsn generate src/workflow.ts -o src/workflow.generated.ts" }
```

### 13.2 `tsn build` Replaces `build-test-workflows.ts`

```json
{ "build:test-workflows": "tsn build -c tisyn.config.ts" }
```

### 13.3 `tsn run` Replaces `host.ts`

```json
{ "dev": "tsn run workflow.ts --entrypoint dev" }
```

The bespoke `host.ts` is deleted. Transport wiring, journal
setup, and connection management move to the runtime.

### 13.4 Remove Legacy Compiler Binary

`tisyn-compile` MUST be removed once `tsn` is established.

---

## 14. Explicit Non-Goals

- **Watch mode.** Deferred.
- **Plugin system.**
- **Incremental generation.**
- **IDE integration.**
- **Remote inputs.**
- **Parallel pass execution.**
- **`tsn validate`, `tsn print`.** May be added later.
- **Advanced input shapes.** Arrays, nested objects, enums,
  unions deferred (§8.4).
- **Boolean negation syntax.** `--no-flag` deferred (§8.3).
- **Input defaults from descriptors.** Invocation input
  defaults use TypeScript optional-field semantics only.

---

## 15. Risks

### 15.1 Compiler API Stability

The CLI depends on `GenerateResult` exposing `workflows` and
`contracts`. These MUST be treated as stable public API.

### 15.2 Source Concatenation Fragility

Edge cases in concatenation (conflicting declarations,
duplicate imports, name collisions) SHOULD be handled by
clear compiler error surfacing, not heroic merges.

### 15.3 Input Derivation Scope

The v1 input model supports only flat primitive-field
objects. Complex shapes require alternative input mechanisms.
This is deliberate.

---

## 16. Non-Normative Implementation Notes

### 16.1 CLI Parsing Backend

The CLI MAY use Configliere, or any other parsing library,
as a backend for flag parsing, coercion, help generation,
provenance tracking, and environment variable handling.

For `tsn run`, workflow-derived flags require dynamic schema
construction. The implementation MAY use a library that
supports programmatic parser construction or MAY implement
derived flag parsing independently.

No normative concept in this specification depends on any
particular parsing library.

### 16.2 Two-Phase Parsing Model for `tsn run`

The current implementation uses a two-phase parsing model
for `tsn run`:

**Phase 1 (Configliere).** The CLI parsing library parses
built-in command options (`module`, `--entrypoint`,
`--verbose`) and detects `--help`/`--version`. Flags not
recognized by the library remain in its **remainder** — the
unconsumed portion of the input after parsing.

**Phase 2 (application-owned).** The CLI loads the
descriptor module, resolves the workflow export, derives the
invocation input schema (§8), and parses the remainder
against the derived flags (§9). This phase is also
responsible for assembling dynamic help (§9.6) when
`--help` appears in the remainder.

The remainder is the sole source of workflow invocation
flags. The CLI MUST NOT derive workflow flags from raw
`process.argv` or any other source that includes
already-consumed built-in options.

This two-phase model is an implementation choice, not a
normative requirement. Any implementation that correctly
separates built-in options from workflow-derived flags and
produces the specified behavior is conforming.

### 16.3 Input Schema Derivation Mechanism

The normative requirement (§8.1) is that the CLI has access
to a workflow invocation input schema conforming to the
supported shapes. How this schema is obtained is an
implementation choice. Options include:

- Extracting parameter types from the workflow source via
  the TypeScript compiler API
- Emitting schema metadata as a colocated artifact during
  `tsn generate` / `tsn build`
- Reading type information from declaration files

The mechanism is not prescribed. The requirement is that the
schema accurately reflects the authored parameter shape.

The invocation input schema is not part of the
`WorkflowDescriptor` as defined by the config specification.
Whether future tooling chooses to colocate schema metadata
alongside the descriptor is an implementation decision
outside the scope of both specifications.

### 16.4 Provenance

When `--verbose` is active, the CLI SHOULD display the
resolved value and origin of each built-in CLI flag,
invocation input flag, and environment variable.

---

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
