# Frozen migration fixtures — DO NOT EDIT

These files are byte-for-byte snapshots of `specs/tisyn-cli-*.md` taken at
the moment the structured corpus was authored. They are the permanent
proof that the structured corpus round-trips to the pre-migration
handwritten Markdown. Do not regenerate, rename, or edit them.

- `original-spec.md`       — snapshot of `specs/tisyn-cli-specification.md`
- `original-test-plan.md`  — snapshot of `specs/tisyn-cli-test-plan.md`

`verify-corpus` compares generator output against these fixtures on
every run. If you need to update the corpus, author new `Spec(...)` /
`TestPlan(...)` values; never touch these files.

## Test-plan asymmetry — deterministic gate is spec-only

The deterministic `compareMarkdown` gate in `verify-corpus` runs
**only on the spec side**. The test plan is verified exclusively by the
Claude semantic gate. This is a data-model limitation, not a
testing-discipline gap:

`original-test-plan.md` carries roughly nine top-level prose sections
(Purpose, Scope, Testing Methodology, Coverage Goals, Test Environment,
Test Data, Risks, Success Criteria, Implementation Readiness) that
`TestPlanModule` cannot express. The structured model only supports
categories, rules, and test cases — it has no concept of freeform outer
prose. Any rendered test plan would therefore mismatch the frozen
original on these nine sections, producing a compare verdict that is
structurally unavoidable rather than informative.

The `compare:plan` log line in `verify-corpus` emits a `SKIPPED`
notice explaining this, and the Claude review prompt carries both
sides plus the literal text "SKIPPED — TestPlanModule cannot express
the handwritten outer prose sections." so the semantic gate can judge
equivalence without being misled.

**Do not tighten the deterministic gate to cover the test plan** until
`TestPlanModule` gains first-class support for outer prose sections.
Doing so would require the gate to either lie (mutate the original
before comparing) or always fail — neither is useful, and both would
mask real regressions the Claude gate is designed to catch.
