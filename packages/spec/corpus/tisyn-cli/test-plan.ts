// v2 tisyn-cli test plan. Ported verbatim from the v1 corpus at
// packages/spec/corpus/tisyn-cli/test-plan.ts (main tree). Test IDs,
// category IDs, section prose, rule→test bindings are preserved
// byte-for-byte. The v1 `testsSpec` relation became `validatesSpec`.
// v1 tier Core→p0, Extended→p1. TestCase.type is assigned by the
// surface a test exercises: explicit `[Unit]` descriptions → "unit";
// all others → "e2e" (the CLI is invoked as a child process).
// TestCase.specRef carries the first rule from the v1 `rules` array;
// the complete rule→test bindings live in `coverageMatrix`.
//
// Every coverageMatrix row ports with status "covered" because every
// v1 row carried a non-empty testIds array (D27: covered iff
// testIds.length > 0).

import {
  coverageEntry,
  testCase,
  testCategory,
  testPlan,
  testPlanSection,
} from "../../src/constructors.ts";
import type { TestPlanModule } from "../../src/types.ts";

const PURPOSE_PROSE = `This document defines the conformance test plan for the
Tisyn CLI Specification. An implementation of \`@tisyn/cli\`
proves conformance by passing all tests marked **P0**
(blocking). Tests marked **P1** are recommended but not
blocking for initial conformance. Tests marked **GOLDEN**
lock down output format through snapshot comparison.`;

const SCOPE_PROSE = `This test plan covers:

- Command dispatch and surface
- Rooted \`tsn generate\` and graph-aware \`tsn build\`
- Descriptor loading and workflow function loading
- \`tsn run\` dispatch between authored source and generated modules
- TypeScript-family module loading for descriptors and transport bindings
- Invocation input schema contract (IS1–IS3)
- CLI flag derivation and mapping
- Boolean v1 semantics (B1–B4)
- Help generation and help-path failure behavior
- Validation and coercion
- Startup lifecycle ordering
- \`tsn check\` readiness validation
- Exit code behavior
- Golden/snapshot tests for outputs

This test plan does NOT cover:

- Descriptor data model or constructor behavior
  (config test plan)
- \`Config.useConfig()\` semantics (config test plan)
- Environment resolution rules (config test plan)
- Rooted compiler graph semantics, helper compilation,
  contract visibility, or generated-module compiler
  boundaries (compiler test plan)`;

const CONFORMANCE_TARGETS_PROSE = `| Target | Package | Description |
| --- | --- | --- |
| **CLI-CMD** | \`@tisyn/cli\` | Command dispatch and flag parsing |
| **CLI-LOAD** | \`@tisyn/cli\` | Module loading and descriptor extraction |
| **CLI-SCHEMA** | \`@tisyn/cli\` | Input schema contract |
| **CLI-FLAG** | \`@tisyn/cli\` | Flag derivation, mapping, coercion |
| **CLI-HELP** | \`@tisyn/cli\` | Help text generation |
| **CLI-LIFE** | \`@tisyn/cli\` | Startup lifecycle and ordering |
| **CLI-CHECK** | \`@tisyn/cli\` | Readiness validation |
| **CLI-EXIT** | \`@tisyn/cli\` | Exit code correctness |`;

const PRIORITY_MODEL_PROSE = `- **P0** tests correspond to **MUST** behavior in the CLI
  specification. Blocking conformance.
- **P1** tests correspond to **SHOULD**, **MAY**, or
  advisory behavior. Recommended, not blocking.
- **GOLDEN** tests are an orthogonal test type, not a
  priority class. Golden tests lock down output format
  through snapshot comparison. They are **not required for
  conformance** — an implementation may produce different
  formatting and still conform. Golden tests are required
  for **output stability** once adopted.`;

const BLACK_BOX_PROSE = `P0 conformance tests SHOULD prefer **black-box observable
CLI behavior**: exit codes, stdout/stderr content, file
outputs, and process lifecycle outcomes.

Integration or structural assertions are used only when the
CLI spec explicitly defines a structural contract (e.g.,
module contracts M1–M3) and the behavior cannot be observed
through CLI output alone.`;

const SCHEMA_TESTS_PROSE = `Schema rejection tests validate that the CLI rejects
schemas containing unsupported constructs — not that the CLI
inspects any particular source-language representation. This
keeps tests stable regardless of the schema derivation
mechanism used.`;

const LIFECYCLE_OBS_PROSE = `Lifecycle ordering tests (category L) verify phase ordering
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
  execution are observable.`;

const REQUIRED_FIXTURES_PROSE = `| Fixture | Purpose | Used by |
| --- | --- | --- |
| \`fixtures/minimal.ts\` | Minimal valid descriptor, zero-parameter workflow | CMD, LOAD, CHK, SNAP |
| \`fixtures/generate-root.ts\` | Minimal authored workflow root for \`tsn generate\` | GEN |
| \`fixtures/generate-multi/\` | Two-root authored workflow project | GEN |
| \`fixtures/build-roots/\` | Multi-pass rooted build config and source graph | BLD |
| \`fixtures/generated-run.ts\` | Descriptor whose \`run.module\` points to a generated workflow module | LOAD |
| \`fixtures/source-run.ts\` | Descriptor whose \`run.module\` points to authored workflow source | LOAD, LIFE |
| \`fixtures/multi-agent.ts\` | Multi-agent descriptor with journal and entrypoint | ENT, CHK, SNAP |
| \`fixtures/with-inputs.ts\` | Workflow with \`{ maxTurns: number; model?: string; verbose: boolean }\` | FLG, BOOL, HLP, SNAP |
| \`fixtures/separate-module.ts\` | Descriptor with \`run.module\` pointing to separate file | LOAD |
| \`fixtures/bad-descriptor.ts\` | Module whose default export is not a \`WorkflowDescriptor\` | LOAD, EXIT |
| \`fixtures/no-default.ts\` | Module with no default export | LOAD |
| \`fixtures/ts-descriptor.ts\` | TypeScript descriptor module fixture (\`.ts\`, \`.mts\`, or \`.cts\`) | LOAD, HELP, CHK |
| \`fixtures/same-module-ts-descriptor.ts\` | TypeScript descriptor whose workflow export lives in the same module | LOAD |
| \`fixtures/unsupported-extension.tsx\` | Unsupported JSX-bearing descriptor module fixture | LOAD, EXIT |
| \`fixtures/local-binding.ts\` | TypeScript local/inprocess transport binding module | LIFE |
| \`fixtures/unsupported-schema.ts\` | Workflow whose input schema contains an unsupported shape | IS |
| \`fixtures/env-heavy.ts\` | Descriptor with required, optional, and secret env nodes | CHK, EXIT, SNAP |
| \`fixtures/collision.ts\` | Workflow with \`verbose\` parameter (collides with built-in) | COL |
| \`fixtures/jsDoc.ts\` | Workflow with JSDoc-annotated parameters | HLP |
| \`fixtures/side-effect.ts\` | Minimal workflow that writes a sentinel file on execution | LIFE |

**Harness requirements:**

- E2E tests invoke \`tsn\` as a child process and capture
  stdout, stderr, and exit code.
- Golden tests compare output against checked-in snapshot
  files. Snapshot updates MUST be reviewed and approved
  explicitly; automated snapshot acceptance is prohibited.
- Environment manipulation tests MUST restore \`process.env\`
  after each test, regardless of pass/fail.
- Fixture modules that produce specific schema shapes are
  the primary mechanism for schema-related tests. The test
  plan does not prescribe how fixtures produce schemas.`;

const SUMMARY_PROSE = `| Category | P0 | P1 | GOLDEN | Total |
| --- | --- | --- | --- | --- |
| A. Command surface | 7 | 0 | 0 | 7 |
| B. \`tsn generate\` | 6 | 0 | 0 | 6 |
| C. \`tsn build\` | 8 | 1 | 0 | 9 |
| D. Descriptor loading | 14 | 0 | 0 | 14 |
| E. Entrypoint selection | 4 | 0 | 0 | 4 |
| F. Input schema contract | 11 | 0 | 0 | 11 |
| G. Flag derivation | 20 | 0 | 0 | 20 |
| H. Boolean v1 | 7 | 0 | 0 | 7 |
| I. Flag collision | 2 | 1 | 0 | 3 |
| J. Help generation | 9 | 2 | 1 | 12 |
| K. \`tsn check\` | 9 | 1 | 1 | 11 |
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
count for planning purposes only.`;

const ASSUMPTIONS_PROSE = `- E2E tests invoke \`tsn\` as a child process and capture
  stdout, stderr, and exit code.
- Golden tests compare output against checked-in snapshot
  files. Snapshot updates MUST be explicitly reviewed and
  approved. Automated acceptance is prohibited.
- Schema-related tests depend on fixture modules that
  produce the relevant schema shapes. The test plan does
  not prescribe the derivation mechanism.
- Lifecycle tests use the \`side-effect\` fixture, which
  writes a sentinel file on workflow execution. Tests
  check for presence/absence of this file.
- Environment manipulation tests MUST restore \`process.env\`
  after each test, regardless of pass/fail outcome.`;

const READINESS_PROSE = `- Categories A, B, C, M are **immediately implementable**.
- Categories D, E, F, G, H, I, J require descriptor
  fixtures and schema derivation infrastructure.
- Categories K, L require \`@tisyn/runtime\` or equivalent.
- Category N requires both input and env validation in the
  same test run.
- Category O requires golden file infrastructure.`;

const RISKS_PROSE = `1. **Exit code 2 vs 3 boundary.** CLI-EXIT-011 and
   CLI-EXIT-012 enforce the filesystem vs structural
   error distinction.

2. **Boolean v1 collapse.** CLI-BOOL-004 and CLI-BOOL-005
   prevent treating non-optional \`boolean\` as required.

3. **Help-path failure behavior.** CLI-HLP-008 through
   CLI-HLP-010 enforce the \`--help\` failure contract.

4. **Invocation vs \`Config.useConfig()\` separation.**
   CLI-LIFE-005 and CLI-LIFE-007 prevent channel collapse.

5. **\`tsn check\` scope boundary.** CLI-CHK-009 prevents
   scope creep into input-value validation.`;

const NOTES_PROSE = `1. **CLI-IS-009 completed.** The table pipe character in
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
   CLI-LOAD-001 now names the fixture (\`minimal.ts\`) and
   explains why absence of load errors is meaningful.
   CLI-LIFE-001 now names the fixture (\`bad-descriptor.ts\`)
   and explains that Phase B would produce distinct
   diagnostics if reached. CLI-LIFE-002 now explicitly
   specifies that env vars are satisfied in the fixture,
   making the ordering assertion independent of combined
   reporting.`;

const CATEGORY_C_NOTES = `**Note on CLI-BLD-007.** The CLI's normative contribution is
generated-module path handoff and pass ordering. Compiler
internals remain out of scope.`;

const CATEGORY_F_NOTES = `**Note.** CLI-IS-005 through CLI-IS-011 validate the schema
contract (§8.4), not any specific derivation mechanism.
Implemented using fixture modules that produce the
unsupported shapes.`;

const CATEGORY_I_NOTES = `**Note on CLI-COL-001.** The CLI spec §9.5 normatively
states "the built-in takes precedence" and "The workflow
parameter MUST be renamed to avoid the conflict." This is
a MUST-level rule in the current spec, so CLI-COL-001 is
P0. The spec's final section notes that this *resolution
strategy* (precedence vs. namespacing) is an open question
for potential future revision — but the current rule is
settled and testable. If a future spec revision adopts
namespacing, this test must be updated.`;

const CATEGORY_N_NOTES = `§10.4 uses SHOULD for combined reporting and MAY for
continued diagnostic collection. P1.`;

const CLI_SECTIONS = [
  testPlanSection({
    id: "1",
    number: 1,
    title: "Purpose",
    prose: PURPOSE_PROSE,
  }),
  testPlanSection({
    id: "2",
    number: 2,
    title: "Scope",
    prose: SCOPE_PROSE,
  }),
  testPlanSection({
    id: "3",
    number: 3,
    title: "Conformance Targets",
    prose: CONFORMANCE_TARGETS_PROSE,
  }),
  testPlanSection({
    id: "4",
    number: 4,
    title: "Test Strategy",
    prose: "",
    subsections: [
      testPlanSection({
        id: "4.1",
        title: "Priority Model",
        prose: PRIORITY_MODEL_PROSE,
      }),
      testPlanSection({
        id: "4.2",
        title: "Black-Box vs. White-Box",
        prose: BLACK_BOX_PROSE,
      }),
      testPlanSection({
        id: "4.3",
        title: "Schema-Related Tests",
        prose: SCHEMA_TESTS_PROSE,
      }),
      testPlanSection({
        id: "4.4",
        title: "Lifecycle Observability",
        prose: LIFECYCLE_OBS_PROSE,
      }),
    ],
  }),
  testPlanSection({
    id: "5",
    number: 5,
    title: "Required Test Fixtures",
    prose: REQUIRED_FIXTURES_PROSE,
  }),
  testPlanSection({
    id: "6",
    number: 6,
    title: "Test Matrix",
    prose: "",
    precedingDivider: true,
  }),
  testPlanSection({
    id: "7",
    number: 7,
    title: "Summary",
    prose: SUMMARY_PROSE,
    precedingDivider: true,
  }),
  testPlanSection({
    id: "8",
    number: 8,
    title: "Assumptions",
    prose: ASSUMPTIONS_PROSE,
  }),
  testPlanSection({
    id: "9",
    number: 9,
    title: "Implementation Readiness",
    prose: READINESS_PROSE,
  }),
  testPlanSection({
    id: "risks",
    title: "Highest-Risk Drift Areas",
    prose: RISKS_PROSE,
    precedingDivider: true,
  }),
  testPlanSection({
    id: "notes",
    title: "Final Conformance Notes",
    prose: NOTES_PROSE,
    precedingDivider: true,
  }),
];

export const tisynCliTestPlan: TestPlanModule = testPlan({
  id: "tisyn-cli-test-plan",
  title: "Tisyn CLI Test Plan",
  validatesSpec: "tisyn-cli",
  styleReference: "Blocking Scope Conformance Test Plan",
  sections: CLI_SECTIONS,
  categoriesSectionId: "6",
  categories: [
    testCategory({
      id: "CLI-TC-A",
      title: "Command Surface",
      cases: [
        testCase({
          id: "CLI-CMD-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.1-R2",
          assertion: "`tsn generate --help` exits 0 and shows usage",
        }),
        testCase({
          id: "CLI-CMD-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.2-R1",
          assertion: "`tsn build --help` exits 0 and shows usage",
        }),
        testCase({
          id: "CLI-CMD-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R1",
          assertion:
            "`tsn run <valid-module> --help` loads the module and shows workflow-derived help (see CLI-HLP-008/009 for the failure path)",
        }),
        testCase({
          id: "CLI-CMD-003a",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R5",
          assertion:
            "`tsn run --help` (no module argument) shows static command help and exits 0",
        }),
        testCase({
          id: "CLI-CMD-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.4-R3",
          assertion: "`tsn check --help` exits 0 and shows usage",
        }),
        testCase({
          id: "CLI-CMD-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-1.1-R1",
          assertion: "`tsn --version` prints version and exits 0",
        }),
        testCase({
          id: "CLI-CMD-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R3",
          assertion: "Unknown command `tsn foo` exits with code 2",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-B",
      title: "`tsn generate`",
      cases: [
        testCase({
          id: "CLI-GEN-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.1-R3",
          assertion: "Single valid root → exits 0, generated output on stdout",
        }),
        testCase({
          id: "CLI-GEN-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.1-R3",
          assertion: "Multiple valid roots with `-o` → exits 0, output file written",
        }),
        testCase({
          id: "CLI-GEN-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R3",
          assertion: "Nonexistent root file → exit code 3",
        }),
        testCase({
          id: "CLI-GEN-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R2",
          assertion: "Unrecognized built-in flag → exit code 2",
        }),
        testCase({
          id: "CLI-GEN-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.1-R2",
          assertion: "`--format json` → exits 0 with JSON output",
        }),
        testCase({
          id: "CLI-GEN-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.1-R1",
          assertion: "Legacy `--include` flag is rejected as unrecognized",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-C",
      title: "`tsn build`",
      notes: CATEGORY_C_NOTES,
      cases: [
        testCase({
          id: "CLI-BLD-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.2-R1",
          assertion: "Valid rooted config → exits 0, output files written",
        }),
        testCase({
          id: "CLI-BLD-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.2-R2",
          assertion: "No config file found → exit code 2",
        }),
        testCase({
          id: "CLI-BLD-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-4.3-R1",
          assertion: "Empty `generates` array → exit code 2",
        }),
        testCase({
          id: "CLI-BLD-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-5.1-R2",
          assertion: "Dependency cycle → exit code 2 with diagnostic",
        }),
        testCase({
          id: "CLI-BLD-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.2-R3",
          assertion: "`--filter` runs named pass and its dependencies",
        }),
        testCase({
          id: "CLI-BLD-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.2-R4",
          assertion: "`--filter` unknown name → exit code 2",
        }),
        testCase({
          id: "CLI-BLD-007",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-5.3-R1",
          assertion:
            "Multi-pass rooted build passes prior outputs as generated-module boundaries; no stub injection or import stripping required",
        }),
        testCase({
          id: "CLI-BLD-008",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-4.3-R2",
          assertion: "Legacy `input` field in build config is rejected",
        }),
        testCase({
          id: "CLI-BLD-009",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-5.1-R1",
          assertion:
            "Inferred import-graph dependency ordering matches declared output paths in a two-pass build",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-D",
      title: "Descriptor Loading (`tsn run`)",
      cases: [
        testCase({
          id: "CLI-LOAD-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.1-R1",
          assertion:
            "`tsn run <valid-module>` proceeds past loading (fixture `minimal.ts`); observable as reaching a later phase, not a load-phase error",
        }),
        testCase({
          id: "CLI-LOAD-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R4",
          assertion: "Nonexistent module path → exit code 3",
        }),
        testCase({
          id: "CLI-LOAD-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.2-R1",
          assertion: "Module with no default export → exit code 2",
        }),
        testCase({
          id: "CLI-LOAD-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.2-R1",
          assertion: "Default export is not a `WorkflowDescriptor` → exit code 2",
        }),
        testCase({
          id: "CLI-LOAD-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.2-R2",
          assertion: "`run.export` names a non-existent export → exit code 2",
        }),
        testCase({
          id: "CLI-LOAD-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.2-R3",
          assertion:
            "`run.module` relative path resolves correctly; observable as workflow loading without code 3",
        }),
        testCase({
          id: "CLI-LOAD-007",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.2-R3",
          assertion: "`run.module` path does not exist → exit code 3",
        }),
        testCase({
          id: "CLI-LOAD-008",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.1-R1",
          assertion:
            "`run.module` omitted → workflow function resolved from descriptor module; successful execution",
        }),
        testCase({
          id: "CLI-LOAD-009",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.5.1-R1",
          assertion:
            "TypeScript descriptor module (`.ts`/`.mts`/`.cts`) loads successfully; reaches a later phase, not a load-phase error",
        }),
        testCase({
          id: "CLI-LOAD-010",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.5.1-R2",
          assertion:
            "Unsupported extension (for example `.tsx`) → exit code 3 with unsupported-extension diagnostic",
        }),
        testCase({
          id: "CLI-LOAD-011",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.5.4-R1",
          assertion:
            "Explicit TypeScript `run.module` target that is authored workflow source uses compiler-based rooted compilation, not module loading; observable via successful `tsn check`",
        }),
        testCase({
          id: "CLI-LOAD-012",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.5.4-R1",
          assertion:
            "Same-module workflow export in a TypeScript descriptor resolves from the descriptor module instead of the compiler path",
        }),
        testCase({
          id: "CLI-LOAD-013",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.2-R4",
          assertion:
            "`run.module` pointing to a generated workflow module is runtime-loaded; compiler is not invoked",
        }),
        testCase({
          id: "CLI-LOAD-014",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.2-R4",
          assertion:
            "Descriptor module itself is runtime-loaded and not treated as a workflow compilation root",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-E",
      title: "Entrypoint Selection (`tsn run`)",
      cases: [
        testCase({
          id: "CLI-ENT-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.1-R2",
          assertion:
            "`--entrypoint dev` with an existing entrypoint → overlay applied; entrypoint-specific behavior differs from base",
        }),
        testCase({
          id: "CLI-ENT-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.1-R2",
          assertion: "`--entrypoint unknown` → exit code 2",
        }),
        testCase({
          id: "CLI-ENT-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.1-R2",
          assertion: "No `--entrypoint` → base descriptor used",
        }),
        testCase({
          id: "CLI-ENT-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.1-R1",
          assertion: "Overlay that introduces a validation error → exit code 2",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-F",
      title: "Invocation Input Schema Contract",
      notes: CATEGORY_F_NOTES,
      cases: [
        testCase({
          id: "CLI-IS-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.1-R1",
          assertion: "Schema unavailable → exit code 2",
        }),
        testCase({
          id: "CLI-IS-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.1-R2",
          assertion:
            "Schema contains unsupported shape → exit code 2 with diagnostic naming the unsupported construct",
        }),
        testCase({
          id: "CLI-IS-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.1-R3",
          assertion: "Zero-parameter workflow → no derived flags, no failure",
        }),
        testCase({
          id: "CLI-IS-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.2-R1",
          assertion: "Flat object parameter → one flag per field",
        }),
        testCase({
          id: "CLI-IS-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.4-R1",
          assertion: "Multiple parameters → rejected with exit code 2",
        }),
        testCase({
          id: "CLI-IS-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.4-R1",
          assertion: "Non-object parameter → rejected",
        }),
        testCase({
          id: "CLI-IS-007",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.4-R1",
          assertion: "Array-typed field → rejected",
        }),
        testCase({
          id: "CLI-IS-008",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.4-R1",
          assertion: "Nested object field → rejected",
        }),
        testCase({
          id: "CLI-IS-009",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.4-R1",
          assertion: "Union-typed field other than optionality unions → rejected",
        }),
        testCase({
          id: "CLI-IS-010",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.4-R1",
          assertion: "Enum-typed field → rejected",
        }),
        testCase({
          id: "CLI-IS-011",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.4-R1",
          assertion: "Config-node-typed field → rejected",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-G",
      title: "CLI Flag Derivation and Mapping",
      cases: [
        testCase({
          id: "CLI-FLG-001",
          priority: "p0",
          type: "unit",
          specRef: "CLI-9.1-R1",
          assertion: "[Unit] `maxTurns` → `--max-turns`",
        }),
        testCase({
          id: "CLI-FLG-002",
          priority: "p0",
          type: "unit",
          specRef: "CLI-9.1-R1",
          assertion: "[Unit] `model` → `--model` (no case change)",
        }),
        testCase({
          id: "CLI-FLG-003",
          priority: "p0",
          type: "unit",
          specRef: "CLI-9.1-R1",
          assertion: "[Unit] `outputDir` → `--output-dir`",
        }),
        testCase({
          id: "CLI-FLG-004",
          priority: "p0",
          type: "unit",
          specRef: "CLI-9.1-R1",
          assertion: "[Unit] `a` (single char) → `--a`",
        }),
        testCase({
          id: "CLI-FLG-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.2-R1",
          assertion: "Required string: `--model foo` → `\"foo\"`",
        }),
        testCase({
          id: "CLI-FLG-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.2-R1",
          assertion: "Required string missing → exit code 4",
        }),
        testCase({
          id: "CLI-FLG-007",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.2-R1",
          assertion: "Optional string: `--model foo` → `\"foo\"`",
        }),
        testCase({
          id: "CLI-FLG-008",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.2-R2",
          assertion: "Optional string omitted → `undefined`",
        }),
        testCase({
          id: "CLI-FLG-009",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.2-R1",
          assertion: "Required number: `--max-turns 10` → `10`",
        }),
        testCase({
          id: "CLI-FLG-010",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.2-R1",
          assertion: "Required number missing → exit code 4",
        }),
        testCase({
          id: "CLI-FLG-011",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.3-R1",
          assertion: "Number coercion failure: `--max-turns abc` → exit code 4",
        }),
        testCase({
          id: "CLI-FLG-012",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.4-R1",
          assertion: "Unknown invocation flag → exit code 4",
        }),
        testCase({
          id: "CLI-FLG-013",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.2-R1",
          assertion: "Multiple missing required fields → all reported in one diagnostic",
        }),
        testCase({
          id: "CLI-FLG-014",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-16.2-R1",
          assertion:
            "`--verbose` after module does not leak into workflow flag parsing (not rejected as unknown)",
        }),
        testCase({
          id: "CLI-FLG-015",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-16.2-R1",
          assertion:
            "`--entrypoint <name>` after module does not leak into workflow flag parsing",
        }),
        testCase({
          id: "CLI-FLG-016",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-16.2-R1",
          assertion:
            "Built-in and workflow flags coexist: `--entrypoint dev --max-turns 10` parses both correctly",
        }),
        testCase({
          id: "CLI-FLG-017",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.4-R1",
          assertion: "Unknown short flag `-x` after module → exit code 4",
        }),
        testCase({
          id: "CLI-FLG-018",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.4-R1",
          assertion: "Bare positional arg `stray` after module → exit code 4",
        }),
        testCase({
          id: "CLI-FLG-019",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.4-R1",
          assertion: "Zero-parameter workflow + unknown flag → exit code 4",
        }),
        testCase({
          id: "CLI-FLG-020",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.4-R1",
          assertion: "Empty-object-schema workflow + unknown flag → exit code 4",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-H",
      title: "Boolean v1 Semantics",
      cases: [
        testCase({
          id: "CLI-BOOL-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.3-R1",
          assertion: "`boolean` field: `--flag` present → `true`",
        }),
        testCase({
          id: "CLI-BOOL-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.3-R2",
          assertion: "`boolean` field: flag absent → `false`",
        }),
        testCase({
          id: "CLI-BOOL-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.3-R1",
          assertion: "`boolean?` field: `--flag` present → `true`",
        }),
        testCase({
          id: "CLI-BOOL-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.3-R2",
          assertion: "`boolean?` field: flag absent → `false` (not `undefined`)",
        }),
        testCase({
          id: "CLI-BOOL-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.3-R1",
          assertion:
            "Non-optional `boolean` is NOT treated as a required CLI flag — absent → `false`",
        }),
        testCase({
          id: "CLI-BOOL-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.3-R3",
          assertion: "`--no-flag` syntax → exit code 4 (rejected as unknown flag)",
        }),
        testCase({
          id: "CLI-BOOL-007",
          priority: "p0",
          type: "unit",
          specRef: "CLI-8.3-R1",
          assertion: "[Unit] `boolean` and `boolean?` map to identical CLI surface",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-I",
      title: "Flag Collision",
      notes: CATEGORY_I_NOTES,
      cases: [
        testCase({
          id: "CLI-COL-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.5-R1",
          assertion:
            "Derived `--verbose` (from `verbose` parameter) collides with built-in → built-in wins, workflow parameter not addressable via `--verbose`",
        }),
        testCase({
          id: "CLI-COL-002",
          priority: "p0",
          type: "unit",
          specRef: "CLI-9.5-R1",
          assertion: "[Unit] Collision check operates on derived kebab-case names",
        }),
        testCase({
          id: "CLI-COL-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.5-R2",
          assertion: "Collision produces advisory diagnostic (SHOULD)",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-J",
      title: "Help Generation",
      cases: [
        testCase({
          id: "CLI-HLP-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R1",
          assertion: "Help output includes usage line",
        }),
        testCase({
          id: "CLI-HLP-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R1",
          assertion: "Help includes built-in options",
        }),
        testCase({
          id: "CLI-HLP-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R1",
          assertion: "Help includes workflow-derived flags with type indicators",
        }),
        testCase({
          id: "CLI-HLP-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R1",
          assertion: "Help marks required vs optional for each derived flag",
        }),
        testCase({
          id: "CLI-HLP-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-8.5-R1",
          assertion: "JSDoc descriptions appear in help (SHOULD)",
        }),
        testCase({
          id: "CLI-HLP-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R2",
          assertion: "Help does NOT describe `Config.useConfig()` internals",
        }),
        testCase({
          id: "CLI-HLP-007",
          priority: "p1",
          type: "e2e",
          specRef: "CLI-9.6-R1",
          assertion: "Help lists available entrypoints",
        }),
        testCase({
          id: "CLI-HLP-008",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R3",
          assertion:
            "Module load failure → help shows built-in options + diagnostic, exits with error code",
        }),
        testCase({
          id: "CLI-HLP-009",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R3",
          assertion:
            "Schema derivation failure → help shows built-in options + diagnostic, exits with error code",
        }),
        testCase({
          id: "CLI-HLP-010",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R4",
          assertion: "Help MUST NOT silently omit workflow inputs section without explanation",
        }),
        testCase({
          id: "CLI-HLP-011",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R1",
          assertion: "[Golden] Snapshot: help output for `with-inputs` fixture",
        }),
        testCase({
          id: "CLI-HLP-012",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.5.1-R1",
          assertion:
            "`tsn run <ts-descriptor> --help` loads a TypeScript descriptor module and shows workflow-derived help",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-K",
      title: "`tsn check`",
      cases: [
        testCase({
          id: "CLI-CHK-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.2-R1",
          assertion: "Valid descriptor + env vars set → exit 0",
        }),
        testCase({
          id: "CLI-CHK-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.2-R1",
          assertion: "Invalid descriptor → exit code 2",
        }),
        testCase({
          id: "CLI-CHK-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R6",
          assertion: "Missing required env var → exit code 5",
        }),
        testCase({
          id: "CLI-CHK-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.4-R2",
          assertion:
            "`tsn check` does not start transports; observable as process exiting promptly after checks",
        }),
        testCase({
          id: "CLI-CHK-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.4-R2",
          assertion:
            "`tsn check` does not execute the workflow; `side-effect` fixture sentinel file NOT created",
        }),
        testCase({
          id: "CLI-CHK-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.4-R4",
          assertion: "`--entrypoint dev` applies overlay before checking",
        }),
        testCase({
          id: "CLI-CHK-007",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.4-R5",
          assertion: "Reports invocation input schema if derivation succeeds (MAY)",
        }),
        testCase({
          id: "CLI-CHK-008",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.4-R6",
          assertion: "Schema derivation failure does NOT cause `tsn check` to fail",
        }),
        testCase({
          id: "CLI-CHK-009",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.4-R1",
          assertion: "`tsn check` does NOT validate specific invocation input values",
        }),
        testCase({
          id: "CLI-CHK-010",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.4-R3",
          assertion:
            "`--env-example` prints environment variable template to stdout and exits 0",
        }),
        testCase({
          id: "CLI-CHK-011",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.4-R3",
          assertion: "[Golden] Snapshot: `tsn check` output for `multi-agent` fixture",
        }),
        testCase({
          id: "CLI-CHK-012",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.5.1-R1",
          assertion:
            "`tsn check` accepts a TypeScript descriptor module and respects explicit TS workflow-source compilation behavior",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-L",
      title: "Startup Lifecycle Ordering",
      cases: [
        testCase({
          id: "CLI-LIFE-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.3-R1",
          assertion:
            "Phase A before B. Fixture: `bad-descriptor.ts`. Observable: exit 2 with only descriptor-related diagnostics, no input-parsing diagnostics",
        }),
        testCase({
          id: "CLI-LIFE-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.3-R1",
          assertion:
            "Phase B before C. Fixture: `with-inputs.ts` with a required input omitted and all env vars set. Observable: exit 4 for missing input",
        }),
        testCase({
          id: "CLI-LIFE-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.3-R1",
          assertion:
            "Phases A–C before transport startup: validation failure exits and `side-effect` fixture transport side effect is not observable",
        }),
        testCase({
          id: "CLI-LIFE-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.3-R1",
          assertion:
            "Phases A–C before workflow execution: validation failure exits and `side-effect` fixture sentinel file NOT created",
        }),
        testCase({
          id: "CLI-LIFE-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.1-R3",
          assertion:
            "Workflow receives validated invocation args. Observable: workflow produces output derived from args",
        }),
        testCase({
          id: "CLI-LIFE-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.1-R3",
          assertion:
            "Resolved config available via `yield* Config.useConfig(Token)` only after pre-execution validation/resolution complete",
        }),
        testCase({
          id: "CLI-LIFE-007",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.1-R3",
          assertion:
            "Invocation args and `Config.useConfig(Token)` return value are separate. Observable: workflow asserts the two are distinct",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-M",
      title: "Exit Code Behavior",
      cases: [
        testCase({
          id: "CLI-EXIT-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R8",
          assertion: "Successful `tsn generate` → exit 0",
        }),
        testCase({
          id: "CLI-EXIT-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R9",
          assertion: "Compilation error → exit 1",
        }),
        testCase({
          id: "CLI-EXIT-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R4",
          assertion: "Loaded module, invalid descriptor → exit 2",
        }),
        testCase({
          id: "CLI-EXIT-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R4",
          assertion: "Module file not found → exit 3",
        }),
        testCase({
          id: "CLI-EXIT-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R4",
          assertion: "Module file not readable → exit 3",
        }),
        testCase({
          id: "CLI-EXIT-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R5",
          assertion: "Missing required invocation input → exit 4",
        }),
        testCase({
          id: "CLI-EXIT-007",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R5",
          assertion: "Unknown invocation flag (`tsn run`) → exit 4",
        }),
        testCase({
          id: "CLI-EXIT-008",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R5",
          assertion: "Number coercion failure → exit 4",
        }),
        testCase({
          id: "CLI-EXIT-009",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R6",
          assertion: "Missing required env var → exit 5",
        }),
        testCase({
          id: "CLI-EXIT-010",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R2",
          assertion: "Unrecognized built-in flag (`generate`) → exit 2",
        }),
        testCase({
          id: "CLI-EXIT-011",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R4",
          assertion: "Code 2 vs 3: loaded but invalid → exit 2",
        }),
        testCase({
          id: "CLI-EXIT-012",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R4",
          assertion: "Code 2 vs 3: path does not exist → exit 3",
        }),
        testCase({
          id: "CLI-EXIT-013",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R8",
          assertion: "Successful `tsn run` → exit 0",
        }),
        testCase({
          id: "CLI-EXIT-014",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R7",
          assertion: "Runtime error → exit 6",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-N",
      title: "Combined Error Reporting",
      notes: CATEGORY_N_NOTES,
      cases: [
        testCase({
          id: "CLI-CER-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.4-R1",
          assertion:
            "Both missing input and missing env var → both reported before exit (SHOULD)",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-O",
      title: "Golden/Snapshot Tests",
      cases: [
        testCase({
          id: "CLI-SNAP-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R1",
          assertion: "[Golden] Help output: zero-parameter workflow",
        }),
        testCase({
          id: "CLI-SNAP-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-9.6-R1",
          assertion: "[Golden] Help output: multi-field workflow",
        }),
        testCase({
          id: "CLI-SNAP-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.4-R3",
          assertion: "[Golden] `tsn check` output: passing descriptor",
        }),
        testCase({
          id: "CLI-SNAP-004",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-2.4-R3",
          assertion: "[Golden] `tsn check` output: failing descriptor",
        }),
        testCase({
          id: "CLI-SNAP-005",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-7.1-R1",
          assertion: "[Golden] Compilation error diagnostic",
        }),
        testCase({
          id: "CLI-SNAP-006",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R5",
          assertion: "[Golden] Missing required invocation input diagnostic",
        }),
        testCase({
          id: "CLI-SNAP-007",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-3.4-R5",
          assertion: "[Golden] Unknown flag diagnostic",
        }),
      ],
    }),
    testCategory({
      id: "CLI-TC-P",
      title: "Authored Source Execution (`tsn run`)",
      cases: [
        testCase({
          id: "RUN-SRC-001",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.5.4-R1",
          assertion: "Authored `.ts` with same-file helper executes without `UnboundVariable`",
        }),
        testCase({
          id: "RUN-SRC-002",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.5.4-R1",
          assertion:
            "Authored `.ts` with cross-module helper executes without `UnboundVariable`",
        }),
        testCase({
          id: "RUN-SRC-003",
          priority: "p0",
          type: "e2e",
          specRef: "CLI-10.5.4-R1",
          assertion: "Authored `.ts` with aliased import executes without `UnboundVariable`",
        }),
      ],
    }),
  ],
  coverageMatrix: [
    coverageEntry({ rule: "CLI-1.1-R1", testIds: ["CLI-CMD-005"], status: "covered" }),
    coverageEntry({ rule: "CLI-2.1-R1", testIds: ["CLI-GEN-006"], status: "covered" }),
    coverageEntry({
      rule: "CLI-2.1-R2",
      testIds: ["CLI-CMD-001", "CLI-GEN-005"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-2.1-R3",
      testIds: ["CLI-GEN-001", "CLI-GEN-002"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-2.2-R1",
      testIds: ["CLI-CMD-002", "CLI-BLD-001"],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-2.2-R2", testIds: ["CLI-BLD-002"], status: "covered" }),
    coverageEntry({ rule: "CLI-2.2-R3", testIds: ["CLI-BLD-005"], status: "covered" }),
    coverageEntry({ rule: "CLI-2.2-R4", testIds: ["CLI-BLD-006"], status: "covered" }),
    coverageEntry({ rule: "CLI-2.4-R1", testIds: ["CLI-CHK-009"], status: "covered" }),
    coverageEntry({
      rule: "CLI-2.4-R2",
      testIds: ["CLI-CHK-004", "CLI-CHK-005"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-2.4-R3",
      testIds: [
        "CLI-CMD-004",
        "CLI-CHK-010",
        "CLI-CHK-011",
        "CLI-SNAP-003",
        "CLI-SNAP-004",
      ],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-2.4-R4", testIds: ["CLI-CHK-006"], status: "covered" }),
    coverageEntry({ rule: "CLI-2.4-R5", testIds: ["CLI-CHK-007"], status: "covered" }),
    coverageEntry({ rule: "CLI-2.4-R6", testIds: ["CLI-CHK-008"], status: "covered" }),
    coverageEntry({ rule: "CLI-3.4-R1", testIds: ["CLI-CMD-006"], status: "covered" }),
    coverageEntry({
      rule: "CLI-3.4-R2",
      testIds: ["CLI-GEN-004", "CLI-EXIT-010"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-3.4-R3",
      testIds: ["CLI-CMD-006", "CLI-GEN-003"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-3.4-R4",
      testIds: [
        "CLI-LOAD-002",
        "CLI-EXIT-003",
        "CLI-EXIT-004",
        "CLI-EXIT-005",
        "CLI-EXIT-011",
        "CLI-EXIT-012",
      ],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-3.4-R5",
      testIds: [
        "CLI-EXIT-006",
        "CLI-EXIT-007",
        "CLI-EXIT-008",
        "CLI-SNAP-006",
        "CLI-SNAP-007",
      ],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-3.4-R6",
      testIds: ["CLI-CHK-003", "CLI-EXIT-009"],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-3.4-R7", testIds: ["CLI-EXIT-014"], status: "covered" }),
    coverageEntry({
      rule: "CLI-3.4-R8",
      testIds: ["CLI-EXIT-001", "CLI-EXIT-013"],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-3.4-R9", testIds: ["CLI-EXIT-002"], status: "covered" }),
    coverageEntry({ rule: "CLI-4.3-R1", testIds: ["CLI-BLD-003"], status: "covered" }),
    coverageEntry({ rule: "CLI-4.3-R2", testIds: ["CLI-BLD-008"], status: "covered" }),
    coverageEntry({ rule: "CLI-5.1-R1", testIds: ["CLI-BLD-009"], status: "covered" }),
    coverageEntry({ rule: "CLI-5.1-R2", testIds: ["CLI-BLD-004"], status: "covered" }),
    coverageEntry({ rule: "CLI-5.3-R1", testIds: ["CLI-BLD-007"], status: "covered" }),
    coverageEntry({ rule: "CLI-7.1-R1", testIds: ["CLI-SNAP-005"], status: "covered" }),
    coverageEntry({ rule: "CLI-8.1-R1", testIds: ["CLI-IS-001"], status: "covered" }),
    coverageEntry({ rule: "CLI-8.1-R2", testIds: ["CLI-IS-002"], status: "covered" }),
    coverageEntry({ rule: "CLI-8.1-R3", testIds: ["CLI-IS-003"], status: "covered" }),
    coverageEntry({ rule: "CLI-8.2-R1", testIds: ["CLI-IS-004"], status: "covered" }),
    coverageEntry({
      rule: "CLI-8.3-R1",
      testIds: ["CLI-BOOL-001", "CLI-BOOL-003", "CLI-BOOL-005", "CLI-BOOL-007"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-8.3-R2",
      testIds: ["CLI-BOOL-002", "CLI-BOOL-004"],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-8.3-R3", testIds: ["CLI-BOOL-006"], status: "covered" }),
    coverageEntry({
      rule: "CLI-8.4-R1",
      testIds: [
        "CLI-IS-005",
        "CLI-IS-006",
        "CLI-IS-007",
        "CLI-IS-008",
        "CLI-IS-009",
        "CLI-IS-010",
        "CLI-IS-011",
      ],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-8.5-R1", testIds: ["CLI-HLP-005"], status: "covered" }),
    coverageEntry({
      rule: "CLI-9.1-R1",
      testIds: ["CLI-FLG-001", "CLI-FLG-002", "CLI-FLG-003", "CLI-FLG-004"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-9.2-R1",
      testIds: [
        "CLI-FLG-005",
        "CLI-FLG-006",
        "CLI-FLG-007",
        "CLI-FLG-009",
        "CLI-FLG-010",
        "CLI-FLG-013",
      ],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-9.2-R2", testIds: ["CLI-FLG-008"], status: "covered" }),
    coverageEntry({ rule: "CLI-9.3-R1", testIds: ["CLI-FLG-011"], status: "covered" }),
    coverageEntry({
      rule: "CLI-9.4-R1",
      testIds: [
        "CLI-FLG-012",
        "CLI-FLG-017",
        "CLI-FLG-018",
        "CLI-FLG-019",
        "CLI-FLG-020",
      ],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-9.5-R1",
      testIds: ["CLI-COL-001", "CLI-COL-002"],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-9.5-R2", testIds: ["CLI-COL-003"], status: "covered" }),
    coverageEntry({
      rule: "CLI-9.6-R1",
      testIds: [
        "CLI-CMD-003",
        "CLI-HLP-001",
        "CLI-HLP-002",
        "CLI-HLP-003",
        "CLI-HLP-004",
        "CLI-HLP-007",
        "CLI-HLP-011",
        "CLI-SNAP-001",
        "CLI-SNAP-002",
      ],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-9.6-R2", testIds: ["CLI-HLP-006"], status: "covered" }),
    coverageEntry({
      rule: "CLI-9.6-R3",
      testIds: ["CLI-HLP-008", "CLI-HLP-009"],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-9.6-R4", testIds: ["CLI-HLP-010"], status: "covered" }),
    coverageEntry({ rule: "CLI-9.6-R5", testIds: ["CLI-CMD-003a"], status: "covered" }),
    coverageEntry({
      rule: "CLI-10.1-R1",
      testIds: ["CLI-LOAD-001", "CLI-LOAD-008", "CLI-ENT-004"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-10.1-R2",
      testIds: ["CLI-ENT-001", "CLI-ENT-002", "CLI-ENT-003"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-10.1-R3",
      testIds: ["CLI-LIFE-005", "CLI-LIFE-006", "CLI-LIFE-007"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-10.2-R1",
      testIds: ["CLI-LOAD-003", "CLI-LOAD-004", "CLI-CHK-001", "CLI-CHK-002"],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-10.2-R2", testIds: ["CLI-LOAD-005"], status: "covered" }),
    coverageEntry({
      rule: "CLI-10.2-R3",
      testIds: ["CLI-LOAD-006", "CLI-LOAD-007"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-10.2-R4",
      testIds: ["CLI-LOAD-013", "CLI-LOAD-014"],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-10.3-R1",
      testIds: ["CLI-LIFE-001", "CLI-LIFE-002", "CLI-LIFE-003", "CLI-LIFE-004"],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-10.4-R1", testIds: ["CLI-CER-001"], status: "covered" }),
    coverageEntry({
      rule: "CLI-10.5.1-R1",
      testIds: ["CLI-LOAD-009", "CLI-HLP-012", "CLI-CHK-012"],
      status: "covered",
    }),
    coverageEntry({ rule: "CLI-10.5.1-R2", testIds: ["CLI-LOAD-010"], status: "covered" }),
    coverageEntry({
      rule: "CLI-10.5.4-R1",
      testIds: [
        "CLI-LOAD-011",
        "CLI-LOAD-012",
        "RUN-SRC-001",
        "RUN-SRC-002",
        "RUN-SRC-003",
      ],
      status: "covered",
    }),
    coverageEntry({
      rule: "CLI-16.2-R1",
      testIds: ["CLI-FLG-014", "CLI-FLG-015", "CLI-FLG-016"],
      status: "covered",
    }),
  ],
});
