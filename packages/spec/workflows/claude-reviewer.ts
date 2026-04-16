// Pure helpers for the Claude semantic-equivalence gate used by
// verify-corpus. Kept free of Effection/dispatch so they can be
// unit-tested with plain function calls. Intentionally free of
// `@tisyn/spec` imports so the workflow body (which consumes these
// helpers) stays within the `tsn run` compile-on-the-fly budget —
// callers pass pre-serialized summary strings, not ComparisonReport
// instances.

export interface ReviewPromptInput {
  readonly originalSpec: string;
  readonly originalPlan: string;
  readonly generatedSpec: string;
  readonly generatedPlan: string;
  readonly specCompareSummary: string;
  readonly planCompareSummary: string;
}

const PREAMBLE = `You are a spec reviewer. Confirm that the generated Markdown preserves the full normative meaning of the original for both files. A MUST/SHOULD/MAY rule in the original must appear as an equivalent rule in the generated output, and no new normative claims may be introduced. Ignore purely cosmetic differences (whitespace, heading punctuation, rule ID presence). Return on the first line \`VERDICT: PASS\` or \`VERDICT: FAIL\`, then up to 20 lines of justification.`;

export function buildReviewPrompt(input: ReviewPromptInput): string {
  return [
    PREAMBLE,
    "",
    "=== ORIGINAL SPEC ===",
    input.originalSpec,
    "=== GENERATED SPEC ===",
    input.generatedSpec,
    "=== ORIGINAL TEST PLAN ===",
    input.originalPlan,
    "=== GENERATED TEST PLAN ===",
    input.generatedPlan,
    "=== STRUCTURAL COMPARISON SUMMARY (spec) ===",
    input.specCompareSummary,
    "=== STRUCTURAL COMPARISON SUMMARY (test plan) ===",
    input.planCompareSummary,
  ].join("\n");
}

export function parseVerdict(response: string): boolean {
  const lines = response.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    return line === "VERDICT: PASS";
  }
  return false;
}
