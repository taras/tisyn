// Pilot-local corpus binding. Owns the full structured-spec pipeline
// for every target the pipeline knows about — normalize, build
// registry, check readiness, render, compare against the frozen
// Markdown fixture, and build the Claude review prompt. Target-
// specific data (structured spec + test-plan modules +
// relationship-title map) lives in the `TARGETS` registry below;
// adding a second target later is one row, nothing more.
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

import { inprocessTransport } from "@tisyn/transport";
import type { LocalAgentBinding } from "@tisyn/transport";
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
import { corpusDeclaration } from "./agents.ts";
import { buildReviewPrompt, parseVerdict } from "./claude-reviewer.ts";

interface TargetEntry {
  readonly spec: typeof tisynCliSpec;
  readonly plan: typeof tisynCliTestPlan;
  readonly relationshipTitles: ReadonlyMap<string, string>;
}

const TARGETS = new Map<string, TargetEntry>([
  [
    "tisyn-cli",
    {
      spec: tisynCliSpec,
      plan: tisynCliTestPlan,
      relationshipTitles: new Map<string, string>([
        ["tisyn-compiler", "Tisyn Compiler Specification"],
        ["tisyn-config", "Tisyn Configuration Specification"],
      ]),
    },
  ],
]);

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

export function createBinding(): LocalAgentBinding {
  return {
    transport: inprocessTransport(corpusDeclaration, {
      *compile(payload) {
        const { input } = payload as unknown as { input: CompileInput };
        const { target, originalSpec, originalPlan } = input;

        const entry = TARGETS.get(target);
        if (entry == null) {
          throw new Error(
            `corpus-agent: unknown target "${target}". ` +
              `Known targets: ${[...TARGETS.keys()].join(", ")}`,
          );
        }

        const specResult = normalizeSpec(entry.spec);
        if (!specResult.ok) {
          throw new Error(
            `corpus.compile: normalizeSpec failed: ${JSON.stringify(specResult.errors)}`,
          );
        }
        const planResult = normalizeTestPlan(entry.plan);
        if (!planResult.ok) {
          throw new Error(
            `corpus.compile: normalizeTestPlan failed: ${JSON.stringify(planResult.errors)}`,
          );
        }

        const registry = buildRegistry([specResult.value], [planResult.value]);
        const specId = specResult.value.id;
        if (!isReady(registry, specId)) {
          const coverage = checkCoverage(registry, specId);
          throw new Error(`corpus.compile: ${specId} not ready: ${JSON.stringify(coverage)}`);
        }

        const ruleSections = new Map<string, string>();
        for (const rule of specResult.value.rules) {
          ruleSections.set(rule.id, rule.section);
        }

        const generatedSpec = renderSpecMarkdown(specResult.value, {
          relationshipTitle: (id) => entry.relationshipTitles.get(id),
        });
        const generatedPlan = renderTestPlanMarkdown(planResult.value, {
          ruleSection: (id) => ruleSections.get(id),
          validatesLabel: specResult.value.title,
        });

        // Spec and test plan travel through the same compareMarkdown gate.
        // The gate observes a coarse structural surface (H2 headings, test
        // IDs, coverage refs, relationship lines); Claude remains the
        // secondary semantic gate for prose wording and table content.
        const specReport = compareMarkdown(originalSpec, generatedSpec);
        const planReport = compareMarkdown(originalPlan, generatedPlan);
        const specCompareSummary = JSON.stringify(specReport.summary, null, 2);
        const planCompareSummary = JSON.stringify(planReport.summary, null, 2);
        const prompt = buildReviewPrompt({
          originalSpec,
          originalPlan,
          generatedSpec,
          generatedPlan,
          specCompareSummary,
          planCompareSummary,
        });

        const result: CompileOutput = {
          ok: specReport.ok && planReport.ok,
          specCompareSummary,
          planCompareSummary,
          generatedSpec,
          generatedPlan,
          prompt,
        };
        return result as unknown as Val;
      },
      *checkVerdict(payload) {
        const { input } = payload as unknown as { input: CheckVerdictInput };
        const result: CheckVerdictOutput = { pass: parseVerdict(input.response) };
        return result as unknown as Val;
      },
    }),
  };
}
