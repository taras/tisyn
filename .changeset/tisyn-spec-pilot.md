---
"@tisyn/spec": minor
---

Pilot a structured-spec pair for `tisyn-cli`. `@tisyn/spec` now ships a Markdown renderer and structural comparison helper via the new `@tisyn/spec/markdown` subpath export (`renderSpecMarkdown`, `renderTestPlanMarkdown`, `compareMarkdown`), plus an authored `corpus/tisyn-cli` pair (`Spec(...)` + `TestPlan(...)`) that normalizes cleanly and reaches ready coverage. Frozen copies of the handwritten `specs/tisyn-cli-*.md` live under `corpus/tisyn-cli/__fixtures__/` as permanent migration proof, and a Tisyn workflow (`workflows/verify-cli-corpus.ts`) drives the end-to-end verification pipeline — deterministic normalization, readiness, and Markdown comparison followed by an optional Claude semantic gate — with a plain Node wrapper script at `scripts/verify-cli.ts` (`pnpm --filter @tisyn/spec run verify:cli[:no-claude]`).
