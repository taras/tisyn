# @tisyn/spec

## 0.3.0

### Minor Changes

- 4ef0daf: BREAKING: authoring helpers are PascalCase again — `Spec`, `Section`, `Rule`,
  `Relationship`, `OpenQuestion`, `ErrorCode`, `Concept`, `Invariant`, `Term`,
  `TestPlan`, `TestPlanSection`, `TestCategory`, `TestCase`, `CoverageEntry`.
  Replaces the lowercase helpers (`spec`, `section`, …) shipped earlier in the
  v2 realignment. Consumers must update call sites with a case-only rename;
  there is no lowercase alias bridge.

### Patch Changes

- dc5f880: Narrow the alignment claim: `@tisyn/spec` is aligned with the v2 source spec with one scoped deviation in §7.7. The auxiliary acquisition operations `acquireFixture` and `acquireEmittedMarkdown` are no longer exposed as default-bound module-level exports — their default readers resolved to monorepo-only paths (`<packageRoot>/corpus/<id>/__fixtures__/*.md` and `<repoRoot>/specs/*.md`) that neither ship with the published tarball nor exist in a consumer install, so the defaults were guaranteed to `ENOENT` off-monorepo. The operations' §7.7 shapes are preserved on the `AcquireAPI` returned by `createAcquire({ manifest, readFixture, readEmitted })`; callers supply their own readers. The deviation is documented in the package README.

## 0.2.0

### Minor Changes

- 715bf50: Add `@tisyn/spec` for authoring, normalizing, indexing, and validating the Tisyn specification corpus. Spec authors can now express specs and test plans through PascalCase constructors, normalize them into hashed canonical artifacts, build a registry with rule/error-code/concept/term indices, and run V1..V9 structural validation plus coverage and readiness queries — all with zero runtime dependencies on other `@tisyn/*` packages.
- dd4f627: Pilot a structured-spec pair for `tisyn-cli`. `@tisyn/spec` now ships a Markdown renderer and structural comparison helper via the new `@tisyn/spec/markdown` subpath export (`renderSpecMarkdown`, `renderTestPlanMarkdown`, `compareMarkdown`), plus an authored `corpus/tisyn-cli` pair (`Spec(...)` + `TestPlan(...)`) that normalizes cleanly and reaches ready coverage. Frozen copies of the handwritten `specs/tisyn-cli-*.md` live under `corpus/tisyn-cli/__fixtures__/` as permanent migration proof, and a Tisyn workflow (`workflows/verify-cli-corpus.ts`) drives the end-to-end verification pipeline — deterministic normalization, readiness, and Markdown comparison followed by an optional Claude semantic gate — with a plain Node wrapper script at `scripts/verify-cli.ts` (`pnpm --filter @tisyn/spec run verify:cli[:no-claude]`).
