// Pilot-local corpus binding. Owns the full tisyn-cli structured-spec
// pipeline — normalize, build registry, check readiness, render,
// compare against the frozen Markdown fixture, and build the Claude
// review prompt. The workflow body calls `Corpus().compile(...)` and
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

const RELATIONSHIP_TITLES = new Map<string, string>([
  ["tisyn-compiler", "Tisyn Compiler Specification"],
  ["tisyn-config", "Tisyn Configuration Specification"],
]);

export interface CompileInput {
  readonly originalSpec: string;
  readonly originalPlan: string;
}

export interface CompileOutput {
  readonly ok: boolean;
  readonly summary: string;
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
        const { originalSpec, originalPlan } = input;

        const specResult = normalizeSpec(tisynCliSpec);
        if (!specResult.ok) {
          throw new Error(
            `corpus.compile: normalizeSpec failed: ${JSON.stringify(specResult.errors)}`,
          );
        }
        const planResult = normalizeTestPlan(tisynCliTestPlan);
        if (!planResult.ok) {
          throw new Error(
            `corpus.compile: normalizeTestPlan failed: ${JSON.stringify(planResult.errors)}`,
          );
        }

        const registry = buildRegistry([specResult.value], [planResult.value]);
        if (!isReady(registry, "tisyn-cli")) {
          const coverage = checkCoverage(registry, "tisyn-cli");
          throw new Error(`corpus.compile: tisyn-cli not ready: ${JSON.stringify(coverage)}`);
        }

        const ruleSections = new Map<string, string>();
        for (const rule of specResult.value.rules) {
          ruleSections.set(rule.id, rule.section);
        }

        const generatedSpec = renderSpecMarkdown(specResult.value, {
          relationshipTitle: (id) => RELATIONSHIP_TITLES.get(id),
        });
        const generatedPlan = renderTestPlanMarkdown(planResult.value, {
          ruleSection: (id) => ruleSections.get(id),
          validatesLabel: specResult.value.title,
        });

        const report = compareMarkdown(originalSpec, generatedSpec);
        const summary = JSON.stringify(report.summary, null, 2);
        const prompt = buildReviewPrompt({
          originalSpec,
          originalPlan,
          generatedSpec,
          generatedPlan,
          specCompareSummary: summary,
        });

        const result: CompileOutput = {
          ok: report.ok,
          summary,
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
