# @tisyn/spec

## 0.2.0

### Minor Changes

- 715bf50: Add `@tisyn/spec` for authoring, normalizing, indexing, and validating the Tisyn specification corpus. Spec authors can now express specs and test plans through PascalCase constructors, normalize them into hashed canonical artifacts, build a registry with rule/error-code/concept/term indices, and run V1..V9 structural validation plus coverage and readiness queries — all with zero runtime dependencies on other `@tisyn/*` packages.
- dd4f627: Pilot a structured-spec pair for `tisyn-cli`. `@tisyn/spec` now ships a Markdown renderer and structural comparison helper via the new `@tisyn/spec/markdown` subpath export (`renderSpecMarkdown`, `renderTestPlanMarkdown`, `compareMarkdown`), plus an authored `corpus/tisyn-cli` pair (`Spec(...)` + `TestPlan(...)`) that normalizes cleanly and reaches ready coverage. Frozen copies of the handwritten `specs/tisyn-cli-*.md` live under `corpus/tisyn-cli/__fixtures__/` as permanent migration proof, and a Tisyn workflow (`workflows/verify-cli-corpus.ts`) drives the end-to-end verification pipeline — deterministic normalization, readiness, and Markdown comparison followed by an optional Claude semantic gate — with a plain Node wrapper script at `scripts/verify-cli.ts` (`pnpm --filter @tisyn/spec run verify:cli[:no-claude]`).
