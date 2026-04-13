// Public surface of @tisyn/spec/markdown — the Markdown renderer and
// comparison helpers used by the pilot structured-spec migration pipeline.
// See `packages/spec/src/markdown/render-spec.ts` etc. for behavior notes.

export { GENERATED_BANNER, renderSpecMarkdown } from "./render-spec.ts";
export { renderTestPlanMarkdown } from "./render-test-plan.ts";
export { compareMarkdown, stripBanner } from "./compare.ts";
export type { ComparisonDifference, ComparisonReport } from "./compare.ts";
