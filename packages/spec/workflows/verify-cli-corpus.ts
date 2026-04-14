// Tisyn workflow: verify that the structured tisyn-cli corpus
// normalizes, has ready coverage, renders Markdown that structurally
// matches the frozen handwritten originals, and (when not skipped)
// passes a Claude semantic-equivalence gate.
//
// The workflow is a plain Effection generator that dispatches against
// two installed agents:
//   - `claude-code` (remote binding; factory chosen by caller)
//   - `output`      (local Agents.use binding; log sink)
//
// IO belongs to the caller (the wrapper script / tests). This file is
// pure dispatch + pure spec-package helpers.

import type { Operation } from "effection";
import { dispatch } from "@tisyn/agent";
import type { Val } from "@tisyn/ir";
import {
  buildRegistry,
  checkCoverage,
  isReady,
  normalizeSpec,
  normalizeTestPlan,
} from "../src/index.ts";
import {
  compareMarkdown,
  renderSpecMarkdown,
  renderTestPlanMarkdown,
} from "../src/markdown/index.ts";
import { tisynCliSpec, tisynCliTestPlan } from "../corpus/tisyn-cli/index.ts";
import { buildReviewPrompt, parseVerdict } from "./claude-reviewer.ts";

export type VerifyStage =
  | "normalize-spec"
  | "normalize-test-plan"
  | "isReady"
  | "compare"
  | "skipped-claude"
  | "claude";

export type VerifyResult =
  | { readonly ok: true; readonly stage: "skipped-claude" | "claude" }
  | {
      readonly ok: false;
      readonly stage: Exclude<VerifyStage, "skipped-claude">;
    };

export interface VerifyCliCorpusInput {
  readonly originalSpec: string;
  readonly originalPlan: string;
  readonly skipClaude?: boolean;
}

function* log(label: string, text: string): Operation<void> {
  yield* dispatch("output.log", { label, text } as unknown as Val);
}

export function* verifyCliCorpus(input: VerifyCliCorpusInput): Operation<VerifyResult> {
  // Step 1 — normalize both structured modules.
  const specResult = normalizeSpec(tisynCliSpec);
  if (!specResult.ok) {
    yield* log("FAIL:normalize-spec", JSON.stringify(specResult.errors, null, 2));
    return { ok: false, stage: "normalize-spec" };
  }
  const planResult = normalizeTestPlan(tisynCliTestPlan);
  if (!planResult.ok) {
    yield* log("FAIL:normalize-test-plan", JSON.stringify(planResult.errors, null, 2));
    return { ok: false, stage: "normalize-test-plan" };
  }

  // Step 2 — registry + readiness.
  const registry = buildRegistry([specResult.value], [planResult.value]);
  if (!isReady(registry, "tisyn-cli")) {
    yield* log("FAIL:isReady", JSON.stringify(checkCoverage(registry, "tisyn-cli"), null, 2));
    return { ok: false, stage: "isReady" };
  }

  // Step 3 — render Markdown from the normalized structures. Build a
  // ruleId → section map so the test-plan renderer can emit §refs in the
  // Spec column (matching the handwritten source's `§2.1, §3.4` style).
  const ruleSections = new Map<string, string>();
  for (const rule of specResult.value.rules) {
    ruleSections.set(rule.id, rule.section);
  }
  const generatedSpec = renderSpecMarkdown(specResult.value);
  const generatedPlan = renderTestPlanMarkdown(planResult.value, {
    ruleSection: (id) => ruleSections.get(id),
    validatesLabel: specResult.value.title,
  });

  // Step 4 — deterministic structural comparison against frozen originals.
  const specCompare = compareMarkdown(input.originalSpec, generatedSpec);
  const planCompare = compareMarkdown(input.originalPlan, generatedPlan);
  yield* log("compare:spec", JSON.stringify(specCompare.summary, null, 2));
  yield* log("compare:plan", JSON.stringify(planCompare.summary, null, 2));
  if (!specCompare.ok || !planCompare.ok) {
    return { ok: false, stage: "compare" };
  }

  // Step 5 — Claude semantic gate (optional).
  if (input.skipClaude === true) {
    yield* log("skip-claude", "Deterministic gates passed; Claude gate skipped.");
    return { ok: true, stage: "skipped-claude" };
  }

  const session = (yield* dispatch("claude-code.newSession", {
    config: { model: "claude-sonnet-4-6" },
  } as unknown as Val)) as Val;
  try {
    const prompt = buildReviewPrompt({
      originalSpec: input.originalSpec,
      originalPlan: input.originalPlan,
      generatedSpec,
      generatedPlan,
      specCompare,
      planCompare,
    });
    const planVal = (yield* dispatch("claude-code.plan", {
      args: { session, prompt },
    } as unknown as Val)) as { response: string };
    yield* log("claude:verdict", planVal.response);
    return parseVerdict(planVal.response)
      ? { ok: true, stage: "claude" }
      : { ok: false, stage: "claude" };
  } finally {
    yield* dispatch("claude-code.closeSession", {
      handle: session,
    } as unknown as Val);
  }
}
