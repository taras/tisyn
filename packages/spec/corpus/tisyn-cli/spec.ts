// v2 tisyn-cli specification module. Ported verbatim from the v1 corpus at
// packages/spec/corpus/tisyn-cli/spec.ts (main tree). Rule text, section
// prose, IDs, and error codes are preserved byte-for-byte. The v1 flat
// `rules` / `errorCodes` arrays are re-nested under their owning sections
// via the v1 `section` field. v1 `complements: [...]` became a single
// `relationships: [{ type: "complements", target: ... }]` array.

import {
  errorCode,
  relationship,
  rule,
  section,
  spec,
} from "../../src/constructors.ts";
import type { SpecModule } from "../../src/types.ts";

export const tisynCliSpec: SpecModule = spec({
  id: "tisyn-cli",
  title: "Tisyn CLI Specification",
  status: "active",
  implementationPackage: "@tisyn/cli",
  relationships: [
    relationship({ type: "complements", target: "tisyn-compiler" }),
    relationship({ type: "complements", target: "tisyn-config" }),
  ],
  sections: [
    section({
      id: "1",
      title: "Overview",
      prose:
        "This document specifies `tsn`, the Tisyn command-line interface. `tsn` provides four commands: `tsn generate`, `tsn build`, `tsn run`, and `tsn check`.",
      subsections: [
        section({
          id: "1.1",
          title: "Package and Binary",
          prose: "Package: `@tisyn/cli`. Binary: `tsn`.",
          rules: [
            rule({
              id: "CLI-1.1-R1",
              level: "must",
              text:
                "The `@tisyn/cli` package registers `tsn` as a `bin` entry in `package.json`.",
            }),
          ],
        }),
        section({
          id: "1.2",
          title: "Scope",
          prose:
            "The CLI owns command dispatch, compilation orchestration, descriptor loading and validation, module loading, invocation input parsing, startup lifecycle, and diagnostics. It does NOT own compiler graph semantics, runtime execution, descriptor data model, or transport protocols.",
        }),
        section({
          id: "1.3",
          title: "Relationship to the Config Specification",
          prose:
            "Invocation inputs flow through the workflow function's parameters. Resolved workflow config flows through `Config.useConfig()`. These are separate channels.",
        }),
        section({
          id: "1.4",
          title: "Normative Language",
          prose:
            "The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used as defined in RFC 2119.",
        }),
      ],
    }),
    section({
      id: "2",
      title: "Commands",
      prose: "The CLI surface consists of four commands.",
      subsections: [
        section({
          id: "2.1",
          title: "tsn generate",
          prose:
            "Compile the workflow module graph rooted at one or more source files. Options include `--output/-o`, `--format` (default `printed`, also `json`), `--no-validate`, `--verbose`, `--help/-h`, `--version/-v`.",
          rules: [
            rule({
              id: "CLI-2.1-R1",
              level: "must-not",
              text:
                "The CLI assembles source text, strips imports, or injects stubs for `tsn generate`; those are compiler responsibilities.",
            }),
            rule({
              id: "CLI-2.1-R2",
              level: "must",
              text:
                "`tsn generate` supports `--format printed` (default) and `--format json` output formats.",
            }),
            rule({
              id: "CLI-2.1-R3",
              level: "must",
              text:
                "`tsn generate` writes generated source to the `--output` path when specified, else to stdout.",
            }),
          ],
        }),
        section({
          id: "2.2",
          title: "tsn build",
          prose:
            "Config-driven multi-pass generation. Reads a build config file, infers pass ordering from import dependencies, and executes passes in dependency order. Options include `--config/-c`, `--filter`, `--verbose`, `--help`.",
          rules: [
            rule({
              id: "CLI-2.2-R1",
              level: "must",
              text:
                "If `--config` is not specified, `tsn build` walks from the current working directory toward the filesystem root and stops at the first `tisyn.config.ts` or `tisyn.config.json`.",
            }),
            rule({
              id: "CLI-2.2-R2",
              level: "must",
              text: "If no config is found, `tsn build` fails with exit code 2.",
            }),
            rule({
              id: "CLI-2.2-R3",
              level: "must",
              text:
                "`tsn build` with `--filter <name>` executes the named pass and its dependencies.",
            }),
            rule({
              id: "CLI-2.2-R4",
              level: "must",
              text: "`tsn build --filter` with an unknown name fails with exit code 2.",
            }),
          ],
        }),
        section({
          id: "2.3",
          title: "tsn run",
          prose:
            "Load a workflow descriptor, validate readiness, parse invocation inputs, and execute the workflow. Built-in options: `--entrypoint/-e`, `--verbose`, `--help/-h`. Additional workflow-derived flags come from the workflow's invocation input schema.",
        }),
        section({
          id: "2.4",
          title: "tsn check",
          prose:
            "Validate a workflow descriptor's readiness without executing. Validates descriptor validity and environment readiness. Options: `--entrypoint/-e`, `--env-example`, `--help/-h`.",
          rules: [
            rule({
              id: "CLI-2.4-R1",
              level: "must-not",
              text: "`tsn check` validates specific invocation input values.",
            }),
            rule({
              id: "CLI-2.4-R2",
              level: "must-not",
              text: "`tsn check` starts transports, servers, or executes the workflow.",
            }),
            rule({
              id: "CLI-2.4-R3",
              level: "must",
              text:
                "`tsn check --env-example` prints an environment variable template to stdout and exits 0.",
            }),
            rule({
              id: "CLI-2.4-R4",
              level: "must",
              text:
                "`tsn check --entrypoint <name>` applies the named entrypoint overlay before validation.",
            }),
            rule({
              id: "CLI-2.4-R5",
              level: "may",
              text:
                "`tsn check` may report an advisory invocation input schema when derivation succeeds.",
            }),
            rule({
              id: "CLI-2.4-R6",
              level: "must",
              text:
                "Schema derivation failure does not cause `tsn check` to fail; it is reported as a warning.",
            }),
          ],
        }),
      ],
    }),
    section({
      id: "3",
      title: "Process Lifecycle",
      prose: "Process lifecycle and exit code semantics for all commands (§3).",
      subsections: [
        section({
          id: "3.1",
          title: "Effection Entrypoint",
          prose:
            "The CLI entrypoint uses Effection's `main()` for structured signal handling and scope boundaries.",
        }),
        section({
          id: "3.2",
          title: "Compilation Is Synchronous",
          prose:
            "For `tsn generate` and `tsn build`, rooted compilation via `compileGraph()` is synchronous. The CLI does not introduce unnecessary async boundaries.",
        }),
        section({
          id: "3.3",
          title: "tsn run Is Long-Lived",
          prose:
            "For `tsn run`, the process remains alive after startup completes. It exits when the workflow completes, errors, or the process receives an interrupt signal.",
        }),
        section({
          id: "3.4",
          title: "Exit Codes",
          prose:
            "Exit code 0 is success. Code 1 is a compilation error (generate/build). Code 2 is a structural descriptor, schema, or configuration error. Code 3 is an I/O error (module not found, file unreadable). Code 4 is an invocation input error (missing required input, type mismatch, unknown flag) for `run`. Code 5 is an environment validation error (missing required or secret env vars). Code 6 is a runtime execution error. This is the §3.4 exit code table.",
          rules: [
            rule({
              id: "CLI-3.4-R1",
              level: "must",
              text:
                "The CLI exits with the appropriate exit code and does not exit with code 0 when an error occurred.",
            }),
            rule({
              id: "CLI-3.4-R2",
              level: "must",
              text:
                "Unrecognized built-in CLI flags for `generate`, `build`, or `check` fail with exit code 2.",
            }),
            rule({
              id: "CLI-3.4-R3",
              level: "must",
              text:
                "Unknown top-level commands (e.g. `tsn foo`) and nonexistent root files for `tsn generate` are reported with exit codes 2 and 3 respectively.",
            }),
            rule({
              id: "CLI-3.4-R4",
              level: "must",
              text:
                "Code 2 applies to loaded-but-structurally-invalid content; code 3 applies when the CLI cannot locate or read a file or module at the filesystem level.",
            }),
            rule({
              id: "CLI-3.4-R5",
              level: "must",
              text:
                "Missing required invocation inputs, coercion failures, and unknown invocation flags for `tsn run` fail with exit code 4.",
            }),
            rule({
              id: "CLI-3.4-R6",
              level: "must",
              text: "Missing required or secret environment variables fail with exit code 5.",
            }),
            rule({
              id: "CLI-3.4-R7",
              level: "may",
              text:
                "Runtime execution errors during workflow execution are reported with exit code 6.",
            }),
            rule({
              id: "CLI-3.4-R8",
              level: "must",
              text: "A successful `tsn generate` or `tsn run` exits with code 0.",
            }),
            rule({
              id: "CLI-3.4-R9",
              level: "must",
              text: "Compilation errors during `tsn generate`/`tsn build` fail with exit code 1.",
            }),
          ],
          errorCodes: [
            errorCode({ code: "CLI-E0", trigger: "Success" }),
            errorCode({
              code: "CLI-E1",
              trigger: "Compilation error during `tsn generate` or `tsn build`",
            }),
            errorCode({
              code: "CLI-E2",
              trigger: "Descriptor, schema, or configuration structural error",
            }),
            errorCode({
              code: "CLI-E3",
              trigger: "I/O error — module not found, file not readable, permission denied",
            }),
            errorCode({
              code: "CLI-E4",
              trigger:
                "Invocation input error — missing required input, type mismatch, unknown flag",
            }),
            errorCode({
              code: "CLI-E5",
              trigger: "Environment validation error — missing required or secret env vars",
            }),
            errorCode({
              code: "CLI-E6",
              trigger: "Runtime execution error — workflow failure, transport error",
            }),
          ],
        }),
      ],
    }),
    section({
      id: "4",
      title: "Build Configuration",
      prose: "Build config file format and schema for `tsn build` (§4).",
      subsections: [
        section({
          id: "4.1",
          title: "Build Config File",
          prose:
            "The build config file (`tisyn.config.ts` or `tisyn.config.json`) declares generation passes for `tsn build`. It is distinct from the workflow descriptor used by `tsn run`.",
        }),
        section({
          id: "4.2",
          title: "Config File Format",
          prose:
            "TypeScript format uses `defineConfig()` (a passthrough identity). JSON format uses the same schema without the wrapper function.",
        }),
        section({
          id: "4.3",
          title: "Config Schema",
          prose:
            "A `TsynConfig` has a `generates` array of `GeneratePass` entries with `name`, `roots`, `output`, optional `format`, `noValidate`, `dependsOn`. The CLI validates the config against this schema (§4.3).",
          rules: [
            rule({
              id: "CLI-4.3-R1",
              level: "must",
              text:
                "Build config validation: `generates` contains at least one entry; each `name` is unique and matches `[a-z][a-z0-9-]*`; each `roots` is non-empty; each root resolves to an existing file; each `output` is writable; `dependsOn` references name passes in `generates`.",
            }),
            rule({
              id: "CLI-4.3-R2",
              level: "must",
              text:
                "Legacy fields (e.g. `input`) on the build config are rejected as unknown with exit code 2.",
            }),
          ],
        }),
      ],
    }),
    section({
      id: "5",
      title: "Multi-Pass Ordering",
      prose:
        "Ordering and cross-pass-boundary handling for multi-pass builds (§5 pass dependency graph).",
      subsections: [
        section({
          id: "5.1",
          title: "Import-Graph Inference",
          prose:
            "The CLI infers pass dependencies from declared roots and output paths. If a root's import graph references another pass's declared output, that pass runs first.",
          rules: [
            rule({
              id: "CLI-5.1-R1",
              level: "must",
              text:
                "The CLI infers pass dependencies from the declared roots' import graph and orders passes topologically.",
            }),
            rule({
              id: "CLI-5.1-R2",
              level: "must",
              text:
                "A dependency cycle detected during topological sorting fails with exit code 2 and a diagnostic.",
            }),
          ],
        }),
        section({
          id: "5.2",
          title: "dependsOn Escape Hatch",
          prose:
            "Explicit ordering for cases where dependencies are not visible in imports. Inferred and explicit edges are equivalent.",
        }),
        section({
          id: "5.3",
          title: "Cross-Pass Boundary Handling",
          prose:
            "Cross-pass boundaries are handled by the compiler during graph traversal. The CLI communicates prior pass output paths via `generatedModulePaths`.",
          rules: [
            rule({
              id: "CLI-5.3-R1",
              level: "must",
              text:
                "Cross-pass boundaries are communicated by passing prior pass output paths as `generatedModulePaths`. The CLI does not perform source-level stub injection or import stripping.",
            }),
          ],
        }),
        section({
          id: "5.4",
          title: "Single-Pass Shortcut",
          prose: "A single pass with no dependencies skips dependency analysis.",
        }),
      ],
    }),
    section({
      id: "6",
      title: "Source Assembly",
      prose: "Reserved section. Source assembly is no longer a CLI concern.",
      subsections: [
        section({
          id: "6.1",
          title: "Reserved",
          prose:
            "This section is reserved. Source assembly, concatenation, deduplication, and filename derivation are compiler responsibilities.",
        }),
      ],
    }),
    section({
      id: "7",
      title: "Diagnostics",
      prose: "Error formatting and verbosity conventions.",
      subsections: [
        section({
          id: "7.1",
          title: "Error Formatting",
          prose:
            "Compilation errors are formatted for terminal display with error code, message, and source location if available.",
          rules: [
            rule({
              id: "CLI-7.1-R1",
              level: "must",
              text:
                "Compilation errors are formatted for terminal display with error code, message, and source location if available.",
            }),
          ],
        }),
        section({
          id: "7.2",
          title: "Verbose Output",
          prose:
            "When `--verbose` is active, the CLI displays command-relevant details such as config provenance, pass inputs, and elapsed time.",
        }),
        section({
          id: "7.3",
          title: "Quiet Success",
          prose:
            "On success without `--verbose`, compilation commands print a single confirmation line to stderr when writing to a file, or no non-output content when writing to stdout.",
        }),
      ],
    }),
    section({
      id: "8",
      title: "Workflow Invocation Input Model",
      prose: "Schema contract and supported shapes for the workflow invocation input schema (§8).",
      subsections: [
        section({
          id: "8.1",
          title: "Input Schema Contract",
          prose:
            "`tsn run` has access to a workflow invocation input schema (IS1, §8.1). Unsupported shapes in the schema fail with exit code 2 (IS2). Zero-parameter workflows produce no derived flags and are not a failure (IS3).",
          rules: [
            rule({
              id: "CLI-8.1-R1",
              level: "must",
              text:
                "IS1: The CLI must obtain a conforming workflow invocation input schema before parsing invocation flags; if no schema is available, it fails with exit code 2.",
            }),
            rule({
              id: "CLI-8.1-R2",
              level: "must",
              text:
                "IS2: If the obtained schema contains unsupported shapes, the CLI fails with exit code 2 and a diagnostic identifying the unsupported construct.",
            }),
            rule({
              id: "CLI-8.1-R3",
              level: "must",
              text:
                "IS3: A zero-parameter workflow has an empty schema, produces no derived invocation flags, and is not a failure.",
            }),
          ],
        }),
        section({
          id: "8.2",
          title: "Supported Shapes (v1)",
          prose:
            "S1: no inputs. S2: a single flat object parameter whose fields become derived invocation inputs. Supported field types: string, number, boolean, and their optional counterparts.",
          rules: [
            rule({
              id: "CLI-8.2-R1",
              level: "must",
              text:
                "S2: A flat object parameter is supported; each field of the object becomes a derived invocation input.",
            }),
          ],
        }),
        section({
          id: "8.3",
          title: "Boolean Semantics (v1 Design Choice)",
          prose:
            "Boolean fields follow a presence-flag model (§8.3). `boolean` and `boolean?` are equivalent in CLI mapping (B1). Presence sets `true`, absence sets `false` — never `undefined` (B2). `--no-flag` is unsupported in v1 (B3). These are owned design choices for v1 (B4).",
          rules: [
            rule({
              id: "CLI-8.3-R1",
              level: "must",
              text:
                "B1: `boolean` and `boolean?` are equivalent in CLI mapping — both produce an optional presence flag.",
            }),
            rule({
              id: "CLI-8.3-R2",
              level: "must",
              text:
                "B2: Supplying `--flag` sets the value to `true`; omitting it sets the value to `false`. The CLI always provides a concrete `boolean`, never `undefined`.",
            }),
            rule({
              id: "CLI-8.3-R3",
              level: "must",
              text: "B3: `--no-flag` negation syntax is unsupported in v1 and yields exit code 4.",
            }),
          ],
        }),
        section({
          id: "8.4",
          title: "Unsupported Shapes",
          prose:
            "Rejected shapes (§8.4) include multiple parameters, non-object parameters, array-typed fields, nested object fields, union-typed fields other than `T | undefined`, enums, tuples, mapped types, and `EnvDescriptor` or config-node-typed fields.",
          rules: [
            rule({
              id: "CLI-8.4-R1",
              level: "must",
              text:
                "Schema derivation rejects multiple parameters, non-object parameter types, array-typed fields, nested object fields, union-typed fields (other than `T | undefined`), enum/tuple/mapped types, and fields typed as `EnvDescriptor` or any config-node type.",
            }),
          ],
        }),
        section({
          id: "8.5",
          title: "JSDoc Descriptions",
          prose:
            "If a field has a JSDoc comment or `@param` annotation, the description should be included in help output.",
          rules: [
            rule({
              id: "CLI-8.5-R1",
              level: "should",
              text:
                "If a field has a JSDoc or `@param` annotation, its description is included in help output.",
            }),
          ],
        }),
      ],
    }),
    section({
      id: "9",
      title: "CLI Flag Mapping and Help",
      prose: "Flag derivation, mapping, coercion, and help generation for `tsn run` (§9).",
      subsections: [
        section({
          id: "9.1",
          title: "Name Conversion",
          prose:
            "Field names are converted from `camelCase` to `--kebab-case` (§9.1) by splitting on uppercase boundaries.",
          rules: [
            rule({
              id: "CLI-9.1-R1",
              level: "must",
              text:
                "Field names are converted from `camelCase` to `--kebab-case` by splitting on uppercase boundaries, lowercasing, and joining with hyphens.",
            }),
          ],
        }),
        section({
          id: "9.2",
          title: "Required vs. Optional",
          prose:
            "Non-boolean non-optional fields must be supplied via their CLI flag. Missing required fields cause exit code 4 with a diagnostic listing all missing inputs. Optional fields may be omitted; omitted values are `undefined` in the workflow parameter object.",
          rules: [
            rule({
              id: "CLI-9.2-R1",
              level: "must",
              text:
                "Non-boolean non-optional fields are supplied via their CLI flag; missing required fields cause exit code 4 with a diagnostic listing all missing inputs.",
            }),
            rule({
              id: "CLI-9.2-R2",
              level: "must",
              text: "Optional fields may be omitted; omitted values are `undefined`.",
            }),
          ],
        }),
        section({
          id: "9.3",
          title: "Value Coercion",
          prose:
            "`string` uses the value verbatim. `number` uses `parseFloat`; `NaN` yields exit code 4. `boolean` follows presence semantics.",
          rules: [
            rule({
              id: "CLI-9.3-R1",
              level: "must",
              text:
                "Value coercion: `string` is verbatim; `number` uses `parseFloat`, and `NaN` causes exit code 4.",
            }),
          ],
        }),
        section({
          id: "9.4",
          title: "Unknown Flags",
          prose:
            "During `tsn run` input parsing (§9.4), any CLI token in the workflow-input remainder that does not match a derived invocation input causes exit code 4. This includes unknown long flags, short flags, and bare positional arguments.",
          rules: [
            rule({
              id: "CLI-9.4-R1",
              level: "must",
              text:
                "During `tsn run` input parsing, any CLI token in the workflow-input remainder that does not match a derived input (including unknown long flags, short flags, and bare positionals) causes exit code 4.",
            }),
          ],
        }),
        section({
          id: "9.5",
          title: "Flag Collision",
          prose:
            "Collision is checked on the derived kebab-case flag names. If a derived flag collides with a built-in option, the built-in takes precedence; the workflow parameter must be renamed. The CLI should emit an advisory diagnostic noting the collision.",
          rules: [
            rule({
              id: "CLI-9.5-R1",
              level: "must",
              text:
                "Collision is checked on derived kebab-case flag names. If a derived flag collides with a built-in option, the built-in takes precedence and the workflow parameter must be renamed.",
            }),
            rule({
              id: "CLI-9.5-R2",
              level: "should",
              text: "The CLI emits an advisory diagnostic noting a flag collision.",
            }),
          ],
        }),
        section({
          id: "9.6",
          title: "Help Generation",
          prose:
            "Static help (`tsn run --help` with no module) shows built-in options. Dynamic help (`tsn run <module> --help`) loads the descriptor and shows usage, built-in options, workflow-derived flags, and entrypoints. On help-path failure, the CLI shows built-in options and a diagnostic explaining why workflow-derived flags cannot be shown, then exits with the appropriate error code (§9.6).",
          rules: [
            rule({
              id: "CLI-9.6-R1",
              level: "must",
              text:
                "Dynamic help for `tsn run <module> --help` produces a usage line, built-in options, workflow-derived flags with type and required/optional status and descriptions, and named entrypoints from the descriptor.",
            }),
            rule({
              id: "CLI-9.6-R2",
              level: "must",
              text:
                "Help describes invocation inputs only and must not describe resolved workflow config or `Config.useConfig()` internals.",
            }),
            rule({
              id: "CLI-9.6-R3",
              level: "must",
              text:
                "If module loading, descriptor validation, or schema derivation fails during dynamic help, the CLI displays built-in options and a diagnostic explaining why workflow-derived flags cannot be shown, then exits with the appropriate error code.",
            }),
            rule({
              id: "CLI-9.6-R4",
              level: "must-not",
              text: "Help silently omits the workflow inputs section without explanation.",
            }),
            rule({
              id: "CLI-9.6-R5",
              level: "must",
              text:
                "Static help (`tsn run --help` with no module argument) displays the command's built-in options and usage and exits 0 without loading any descriptor or workflow metadata.",
            }),
          ],
        }),
      ],
    }),
    section({
      id: "10",
      title: "Startup Lifecycle (`tsn run`)",
      prose: "Lifecycle orchestration for `tsn run` (§10).",
      subsections: [
        section({
          id: "10.1",
          title: "End-to-End Sequence",
          prose:
            "Phase A (load/validate descriptor) precedes Phase B (derive/validate inputs) precedes Phase C (resolve environment) precedes Phase D (execute). Steps 1–12 are performed in order.",
          rules: [
            rule({
              id: "CLI-10.1-R1",
              level: "must",
              text:
                "`tsn run <module>` performs the steps of §10.1 in order: module loading, run-target resolution, entrypoint overlay, descriptor validation, schema derivation, input parsing, environment collection, environment resolution, environment validation, resource startup, workflow execution, and process lifecycle.",
            }),
            rule({
              id: "CLI-10.1-R2",
              level: "must",
              text:
                "If `--entrypoint` is specified, the named entrypoint overlay is applied; an unknown name fails with exit code 2.",
            }),
            rule({
              id: "CLI-10.1-R3",
              level: "must",
              text:
                "The workflow receives validated invocation arguments, and resolved workflow config is accessed via `yield* Config.useConfig(Token)`. Invocation arguments and `Config.useConfig()` return values are separate channels.",
            }),
          ],
        }),
        section({
          id: "10.2",
          title: "Module Contracts",
          prose:
            "Module contracts (§10.2). M1: the descriptor module must have a `default` export that is a valid `WorkflowDescriptor`. M2: the workflow function module must export the entrypoint under the `run.export` name. M3: `run.module`, if specified, is resolved relative to the descriptor module.",
          rules: [
            rule({
              id: "CLI-10.2-R1",
              level: "must",
              text:
                "M1: The descriptor module has a `default` export that is a valid `WorkflowDescriptor`.",
            }),
            rule({
              id: "CLI-10.2-R2",
              level: "must",
              text:
                "M2: The workflow function module exports the workflow entrypoint under the name specified by `run.export`.",
            }),
            rule({
              id: "CLI-10.2-R3",
              level: "must",
              text:
                "M3: `run.module`, if specified, is resolved relative to the descriptor module's location.",
            }),
            rule({
              id: "CLI-10.2-R4",
              level: "must",
              text:
                "When `run.module` points to a generated workflow module, the CLI loads it at runtime and the compiler is not invoked. The descriptor module itself is runtime-loaded and is not treated as a workflow compilation root.",
            }),
          ],
        }),
        section({
          id: "10.3",
          title: "Fail-Before-Execute",
          prose: "Phases A–C must succeed before any transport starts or any workflow executes.",
          rules: [
            rule({
              id: "CLI-10.3-R1",
              level: "must",
              text:
                "Phases A–C (steps 1–9) must succeed before any transport starts (step 10) or any workflow executes (step 11).",
            }),
          ],
        }),
        section({
          id: "10.4",
          title: "Combined Error Reporting",
          prose:
            "When both invocation input errors and environment errors exist, the CLI should report both before exiting.",
          rules: [
            rule({
              id: "CLI-10.4-R1",
              level: "should",
              text:
                "When both invocation input errors and environment errors exist, the CLI reports both before exiting.",
            }),
          ],
        }),
        section({
          id: "10.5",
          title: "Module Loading",
          prose: "Module loading for descriptor, workflow, and transport binding modules (§10.5).",
          subsections: [
            section({
              id: "10.5.1",
              title: "Supported Module Inputs",
              prose:
                "`tsn run` and `tsn check` accept both TypeScript (`.ts`, `.mts`, `.cts`) and JavaScript (`.js`, `.mjs`, `.cjs`) descriptor modules. `.tsx` is not supported.",
              rules: [
                rule({
                  id: "CLI-10.5.1-R1",
                  level: "must",
                  text:
                    "`tsn run` and `tsn check` accept TypeScript (`.ts`, `.mts`, `.cts`) and JavaScript (`.js`, `.mjs`, `.cjs`) descriptor modules.",
                }),
                rule({
                  id: "CLI-10.5.1-R2",
                  level: "must",
                  text:
                    "`.tsx` is not a supported module extension; unsupported extensions fail with exit code 3 and an unsupported-extension diagnostic.",
                }),
              ],
            }),
            section({
              id: "10.5.2",
              title: "Bootstrap Loading",
              prose:
                "Module loading for `tsn run` and `tsn check` occurs before any Effection scope exists. The CLI uses a bootstrap loading path (§10.5.2) — a plain async function — for all pre-scope module loading.",
            }),
            section({
              id: "10.5.3",
              title: "Shared Default Implementation",
              prose:
                "The default module-loading logic is owned by `@tisyn/runtime` and exported as `loadModule()` (§10.5.3).",
            }),
            section({
              id: "10.5.4",
              title: "Module Loading vs. Workflow Source Compilation",
              prose:
                "When `run.module` points to authored workflow source, the CLI uses the Tisyn compiler via `compileGraphForRuntime()` — not module loading — to produce IR.",
              rules: [
                rule({
                  id: "CLI-10.5.4-R1",
                  level: "must",
                  text:
                    "When `run.module` points to authored workflow source, the CLI uses the Tisyn compiler to produce IR. Module loading must not replace workflow source compilation.",
                }),
              ],
            }),
            section({
              id: "10.5.5",
              title: "Module Loading Errors",
              prose:
                "Module-loading errors (unsupported extension, module not found, syntax error, loader init failure, evaluation failure) are reported with exit code 3.",
            }),
            section({
              id: "10.5.6",
              title: "Runtime Context API",
              prose:
                "`Runtime` is a context API exported from `@tisyn/runtime` via `createApi()` (§10.5.6). It exposes `loadModule` as a middleware-interceptable capability via `Runtime.around()`.",
            }),
          ],
        }),
      ],
    }),
    section({
      id: "11",
      title: "Validation Summary",
      prose: "Validation categories and their independence.",
      subsections: [
        section({
          id: "11.1",
          title: "Validation Categories",
          prose:
            "Descriptor validation (exit 2), input schema validation (exit 2), input value validation (exit 4), and environment validation (exit 5) are distinct.",
        }),
        section({
          id: "11.2",
          title: "Independence",
          prose:
            "Descriptor validation, input validation, and environment validation are independent concerns. All must succeed before execution starts.",
        }),
      ],
    }),
    section({
      id: "12",
      title: "Compiler API",
      prose: "The CLI's relationship to the compiler's public API.",
      subsections: [
        section({
          id: "12.1",
          title: "compileGraph() Is the Core",
          prose:
            "The CLI invokes `compileGraph()` for rooted compilation. It does not read workflow source files, resolve imports, classify modules, concatenate source, strip imports, or inject stubs.",
        }),
        section({
          id: "12.2",
          title: "What the CLI Adds",
          prose:
            "Beyond compilation, the CLI provides file I/O, multi-pass orchestration, generated-module path handoff, diagnostics, and workflow invocation lifecycle.",
        }),
      ],
    }),
    section({
      id: "13",
      title: "Migration Path",
      prose: "Migration from legacy build scripts to `tsn` commands.",
      subsections: [
        section({
          id: "13.1",
          title: "tsn generate Replaces build-workflow.ts",
          prose: "`tsn generate` replaces legacy `build-workflow.ts` scripts.",
        }),
        section({
          id: "13.2",
          title: "tsn build Replaces build-test-workflows.ts",
          prose: "`tsn build` replaces `build-test-workflows.ts`.",
        }),
        section({
          id: "13.3",
          title: "tsn run Replaces host.ts",
          prose: "`tsn run` replaces bespoke host.ts drivers.",
        }),
        section({
          id: "13.4",
          title: "Remove Legacy Compiler Binary",
          prose: "`tisyn-compile` is removed once `tsn` is established (§13.4).",
        }),
      ],
    }),
    section({
      id: "14",
      title: "Explicit Non-Goals",
      prose:
        "Watch mode, plugin system, incremental generation, IDE integration, remote inputs, parallel pass execution, `tsn validate`/`tsn print`, advanced input shapes, boolean negation syntax, and input defaults from descriptors are deferred.",
    }),
    section({
      id: "15",
      title: "Risks",
      prose: "Known risks.",
      subsections: [
        section({
          id: "15.1",
          title: "Compiler API Stability",
          prose:
            "The CLI depends on `compileGraph()` and its public result shape. The rooted compiler entry point must be treated as stable public API.",
        }),
        section({
          id: "15.2",
          title: "Rooted Graph Boundary Drift",
          prose:
            "The CLI must not reintroduce source assembly, stub injection, or its own import classification logic.",
        }),
        section({
          id: "15.3",
          title: "Input Derivation Scope",
          prose:
            "The v1 input model supports only flat primitive-field objects. Complex shapes require alternative input mechanisms.",
        }),
      ],
    }),
    section({
      id: "16",
      title: "Non-Normative Implementation Notes",
      prose: "Implementation guidance that is not a normative requirement.",
      subsections: [
        section({
          id: "16.1",
          title: "CLI Parsing Backend",
          prose:
            "The CLI may use Configliere or any other parsing library. No normative concept depends on a particular library.",
        }),
        section({
          id: "16.2",
          title: "Two-Phase Parsing Model for tsn run",
          prose:
            "Phase 1 parses built-in command options into a consumed set, leaving the remainder. Phase 2 loads the descriptor and parses the remainder against derived flags. The remainder is the sole source of workflow invocation flags — built-in options like `--verbose` and `--entrypoint` must not leak into workflow flag parsing. This two-phase model (§16.2) is an implementation concern, not a normative requirement.",
          rules: [
            rule({
              id: "CLI-16.2-R1",
              level: "must",
              text:
                "The CLI must not derive workflow flags from raw `process.argv`; built-in options such as `--verbose` and `--entrypoint` are consumed in Phase 1 and must not leak into workflow-derived flag parsing.",
            }),
          ],
        }),
        section({
          id: "16.3",
          title: "Input Schema Derivation Mechanism",
          prose:
            "How the schema is obtained is an implementation choice. Options include extracting from source, emitting metadata, or reading declaration files.",
        }),
        section({
          id: "16.4",
          title: "Provenance",
          prose:
            "When `--verbose` is active, the CLI should display the resolved value and origin of each flag and environment variable.",
        }),
      ],
    }),
    section({
      id: "final-consistency-changes",
      title: "Final Consistency Changes",
      prose: [
        "1. **Exit code 2 vs 3 boundary.** Code 2 and code 3 had",
        "   overlapping coverage (\"module not found\" appeared",
        "   under code 2; \"file not found\" under code 3). The",
        "   boundary is now unambiguous: code 3 applies when the",
        "   CLI cannot locate or read a file at the filesystem",
        "   level; code 2 applies when a file was loaded but its",
        "   contents are structurally invalid. §10.1 step 1 now",
        "   specifies both failure modes explicitly.",
        "",
        "2. **M2 softened.** \"Compiled workflow function\" replaced",
        "   with \"workflow entrypoint function\" plus \"the CLI does",
        "   not prescribe how this function was produced.\" The",
        "   module contract is now stable regardless of compiler",
        "   or runtime internals.",
        "",
        "3. **`tsn check` example qualified.** The output example",
        "   now labels the invocation inputs section as",
        "   \"(advisory)\" and adds prose clarifying that the",
        "   section is omitted when schema derivation fails or",
        "   is not attempted.",
        "",
        "4. **Document ending consolidated.** The previous",
        "   \"Remaining Open Questions\" and \"Final Cleanup Changes\"",
        "   sections merged into this single section.",
        "",
        "**Open question.** One question remains genuinely",
        "unresolved: whether flag collisions (§9.5) should be",
        "handled by built-in-wins precedence (current rule) or",
        "by namespacing workflow inputs (e.g., `--input.max-turns`).",
        "The current rule is simpler. This may be revisited if",
        "collision surprises users in practice.",
      ].join("\n"),
    }),
  ],
  openQuestions: [
    {
      id: "CLI-OQ-flag-collision-strategy",
      text:
        "Whether flag collisions (§9.5) should be handled by built-in-wins precedence (current rule) or by namespacing workflow inputs (e.g., `--input.max-turns`). The current rule is simpler. This may be revisited if collision surprises users in practice.",
      status: "open",
    },
  ],
});
