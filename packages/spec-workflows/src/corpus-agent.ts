// Pilot-local corpus binding. Owns the full structured-spec pipeline
// for every target the pipeline knows about — acquire the corpus
// registry for the requested target, render, compare live-rendered
// markdown against BOTH the frozen round-trip fixture AND the emitted
// `specs/*.md` tree, and build the Claude review prompt. Target-specific data is no longer a hand-map in this file:
// `acquireCorpusRegistry({ specIds: [target] })` drives the module
// lookup through the `@tisyn/spec` manifest, so adding a second target
// later means adding a manifest entry — nothing in this file.
//
// The workflow body calls `Corpus().compile({ target, ... })` and
// `Corpus().checkVerdict(...)` through ambient contracts. The compiler
// passes the single argument through as the effect payload directly,
// so the handlers receive the input shape directly.
//
// This module is loaded via `tsx/esm/api` at runtime by the CLI's
// agent resolver; it never passes through the `tsn run`
// compile-on-the-fly path, so it is free to import the full
// `@tisyn/spec` source surface (re-export barrels, enums, corpus
// files) that the compiler rejects.

import type { Operation } from "effection";
import { call } from "effection";
import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
import type { Val } from "@tisyn/ir";
import {
  acquireCorpusRegistry,
  compareMarkdown,
  renderSpecMarkdown,
  renderTestPlanMarkdown,
} from "@tisyn/spec";
import type {
  CompareResult,
  CorpusRegistry,
  NormalizedSpecModule,
  NormalizedTestPlanModule,
} from "@tisyn/spec";
import { acquireEmittedMarkdown } from "./acquire.ts";
import { corpusDeclaration } from "./agents.ts";
import { buildReviewPrompt, parseVerdict } from "./claude-reviewer.ts";

export interface CompileInput {
  readonly target: string;
  readonly originalSpec: string;
  readonly originalPlan: string;
}

export interface CompileOutput {
  readonly ok: boolean;
  readonly specCompareSummary: string;
  readonly planCompareSummary: string;
  readonly emittedSpecCompareSummary: string;
  readonly emittedPlanCompareSummary: string;
  readonly generatedSpec: string;
  readonly generatedPlan: string;
  readonly prompt: string;
}

export interface CheckVerdictInput {
  readonly response: string;
}

export interface CheckVerdictOutput {
  readonly pass: boolean;
}

export function* compile(payload: Val): Operation<Val> {
  const { target, originalSpec, originalPlan } = payload as unknown as CompileInput;

  // Acquire the full registry for this target. Acquisition is
  // all-or-nothing: any F1/F2/F3 failure throws `AcquisitionError`
  // and the workflow surfaces that to the operator via the nonzero
  // exit code of `tsn run`. `acquireCorpusRegistry` is typed with
  // @tisyn/spec's local `Operation<T>` alias; wrap through `call` so
  // the handler body uses effection's `Operation<T>` consistently.
  const registry = yield* call(
    () => acquireCorpusRegistry({ specIds: [target] }) as unknown as Operation<CorpusRegistry>,
  );

  const spec = registry.specs.get(target);
  if (spec === undefined) {
    throw new Error(`corpus.compile: target "${target}" not present in acquired registry.`);
  }

  // Readiness (§8.6) is a separate analysis surface (`isReady` on
  // @tisyn/spec) and is deliberately NOT a prerequisite for verify-corpus:
  // the round-trip workflow must acquire, render, and compare regardless of
  // whether a spec has open questions, uncovered MUST rules, or a pending
  // status. Those are publishing/authoring concerns, not compare-gate
  // concerns.

  // Find the companion test plan that validates this spec.
  let plan: NormalizedTestPlanModule | undefined;
  for (const candidate of registry.plans.values()) {
    if (candidate.validatesSpec === target) {
      plan = candidate;
      break;
    }
  }
  if (plan === undefined) {
    throw new Error(`corpus.compile: no companion test plan found for spec "${target}".`);
  }

  // Acquire emitted markdown under `specs/` as a real compare target,
  // not a readability probe. A stale committed file there must make
  // verify-corpus fail, so the strings participate in the verdict
  // through `evaluateCompile` below.
  const emittedSpec = yield* call(
    () => acquireEmittedMarkdown(target, "spec") as unknown as Operation<string>,
  );
  const emittedPlan = yield* call(
    () => acquireEmittedMarkdown(target, "plan") as unknown as Operation<string>,
  );

  const result = evaluateCompile(spec, plan, originalSpec, originalPlan, emittedSpec, emittedPlan);
  return result as unknown as Val;
}

// Pure evaluator. Renders live markdown from the normalized modules and
// runs four structural compares through the same `compareMarkdown` gate:
//   generated-vs-fixture  (round-trip authored->rendered stability)
//   generated-vs-emitted  (the `specs/*.md` tree must track live render)
// `ok` is the AND of all four `.match` flags. Exposed for tests that
// drive drift detection without touching filesystem state.
export function evaluateCompile(
  spec: NormalizedSpecModule,
  plan: NormalizedTestPlanModule,
  originalSpec: string,
  originalPlan: string,
  emittedSpec: string,
  emittedPlan: string,
): CompileOutput {
  const generatedSpec = renderSpecMarkdown(spec);
  const generatedPlan = renderTestPlanMarkdown(plan);

  const specReport = compareMarkdown(generatedSpec, originalSpec);
  const planReport = compareMarkdown(generatedPlan, originalPlan);
  const emittedSpecReport = compareMarkdown(generatedSpec, emittedSpec);
  const emittedPlanReport = compareMarkdown(generatedPlan, emittedPlan);

  const summarize = (r: CompareResult) =>
    JSON.stringify({ match: r.match, differences: r.differences }, null, 2);

  const specCompareSummary = summarize(specReport);
  const planCompareSummary = summarize(planReport);
  const emittedSpecCompareSummary = summarize(emittedSpecReport);
  const emittedPlanCompareSummary = summarize(emittedPlanReport);

  const prompt = buildReviewPrompt({
    originalSpec,
    originalPlan,
    generatedSpec,
    generatedPlan,
    specCompareSummary,
    planCompareSummary,
  });

  return {
    ok: specReport.match && planReport.match && emittedSpecReport.match && emittedPlanReport.match,
    specCompareSummary,
    planCompareSummary,
    emittedSpecCompareSummary,
    emittedPlanCompareSummary,
    generatedSpec,
    generatedPlan,
    prompt,
  };
}

function* checkVerdict(payload: Val): Operation<Val> {
  const { response } = payload as unknown as CheckVerdictInput;
  const result: CheckVerdictOutput = { pass: parseVerdict(response) };
  return result as unknown as Val;
}

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(corpusDeclaration, {
      compile,
      checkVerdict,
    }),
  };
}
