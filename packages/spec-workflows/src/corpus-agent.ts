// Pilot-local corpus binding. Owns the full structured-spec pipeline
// for every target the pipeline knows about — acquire the corpus
// registry for the requested target, check readiness, render, compare
// against the frozen Markdown fixture, and build the Claude review
// prompt. Target-specific data is no longer a hand-map in this file:
// `acquireCorpusRegistry({ specIds: [target] })` drives the module
// lookup through the `@tisyn/spec` manifest, so adding a second target
// later means adding a manifest entry — nothing in this file.
//
// The workflow body calls `Corpus().compile({ target, ... })` and
// `Corpus().checkVerdict(...)` through ambient contracts, and the
// compiler wraps each single argument as `{ input: <value> }` using
// the ambient param name — so the handlers destructure `{ input }`.
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
import type { CorpusRegistry, NormalizedTestPlanModule } from "@tisyn/spec";
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
  const { input } = payload as unknown as { input: CompileInput };
  const { target, originalSpec, originalPlan } = input;

  // Acquire the full registry for this target. Acquisition is
  // all-or-nothing: any F1/F2/F3 failure throws `AcquisitionError`
  // and the workflow surfaces that to the operator via the nonzero
  // exit code of `tsn run`. `acquireCorpusRegistry` is typed with
  // @tisyn/spec's local `Operation<T>` alias; wrap through `call` so
  // the handler body uses effection's `Operation<T>` consistently.
  const registry = yield* call(
    () =>
      acquireCorpusRegistry({ specIds: [target] }) as unknown as Operation<
        CorpusRegistry
      >,
  );

  const spec = registry.specs.get(target);
  if (spec === undefined) {
    throw new Error(
      `corpus.compile: target "${target}" not present in acquired registry.`,
    );
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
    throw new Error(
      `corpus.compile: no companion test plan found for spec "${target}".`,
    );
  }

  // Render live from the structured modules. v2 `renderSpecMarkdown`
  // and `renderTestPlanMarkdown` take only the module — the
  // relationship titles and rule sections are typed into the module
  // surface, so the v1 side-tables are no longer needed.
  const generatedSpec = renderSpecMarkdown(spec);
  const generatedPlan = renderTestPlanMarkdown(plan);

  // Sanity-check that the emitted markdown under `specs/` is readable
  // for this target. Acquisition failure here is a configuration
  // error worth surfacing early (the emitted markdown is what the
  // deployed artifact tracks); we do not use it for the structural
  // compare — that is fixture vs live-rendered.
  yield* call(
    () => acquireEmittedMarkdown(target, "spec") as unknown as Operation<string>,
  );
  yield* call(
    () => acquireEmittedMarkdown(target, "plan") as unknown as Operation<string>,
  );

  // Spec and test plan travel through the same compareMarkdown gate.
  // The gate observes a coarse structural surface (H2 headings, test
  // IDs, coverage refs, relationship lines); Claude remains the
  // secondary semantic gate for prose wording and table content.
  const specReport = compareMarkdown(generatedSpec, originalSpec);
  const planReport = compareMarkdown(generatedPlan, originalPlan);
  const specCompareSummary = JSON.stringify(
    { match: specReport.match, differences: specReport.differences },
    null,
    2,
  );
  const planCompareSummary = JSON.stringify(
    { match: planReport.match, differences: planReport.differences },
    null,
    2,
  );
  const prompt = buildReviewPrompt({
    originalSpec,
    originalPlan,
    generatedSpec,
    generatedPlan,
    specCompareSummary,
    planCompareSummary,
  });

  const result: CompileOutput = {
    ok: specReport.match && planReport.match,
    specCompareSummary,
    planCompareSummary,
    generatedSpec,
    generatedPlan,
    prompt,
  };
  return result as unknown as Val;
}

function* checkVerdict(payload: Val): Operation<Val> {
  const { input } = payload as unknown as { input: CheckVerdictInput };
  const result: CheckVerdictOutput = { pass: parseVerdict(input.response) };
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
