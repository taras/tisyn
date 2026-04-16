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

## Symmetric structural gate

Both the spec and the test plan travel through the same
`compareMarkdown` gate in `verify-corpus`. `compareMarkdown` is a
coarse structural diff: it observes the document title, H2 headings,
test IDs, coverage refs, and relationship lines. It does not observe
H3+ heading text, prose wording, table-cell content, or horizontal-rule
dividers — those remain the Claude semantic gate's responsibility.

`TestPlanModule` carries a hierarchical `sections` tree
(`TestPlanSection`) so the authored plan can express the frozen
fixture's full outer-section layout: numbered sections with a period
prefix at H2 (`## 1. Purpose`) and without one at H3+
(`### 4.1 Priority Model`), unnumbered trailing sections
(`## Highest-Risk Drift Areas`, `## Final Conformance Notes`),
horizontal-rule dividers before group boundaries, and optional
category-level notes. The renderer walks that tree depth-aware and
emits the matrix categories at `depth + 1` under their host section.
