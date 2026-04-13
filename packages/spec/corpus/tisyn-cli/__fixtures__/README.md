# Frozen migration fixtures — DO NOT EDIT

These files are byte-for-byte snapshots of `specs/tisyn-cli-*.md` taken at
the moment the structured corpus was authored. They are the permanent
proof that the structured corpus round-trips to the pre-migration
handwritten Markdown. Do not regenerate, rename, or edit them.

- `original-spec.md`       — snapshot of `specs/tisyn-cli-specification.md`
- `original-test-plan.md`  — snapshot of `specs/tisyn-cli-test-plan.md`

`verify-cli-corpus` compares generator output against these fixtures on
every run. If you need to update the corpus, author new `Spec(...)` /
`TestPlan(...)` values; never touch these files.
