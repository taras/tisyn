// Deterministic Markdown renderer for NormalizedTestPlanModule.
//
// Contract: pure function, same input → byte-identical output.
//
// The renderer mirrors the table layout used in the hand-authored
// `specs/tisyn-*-test-plan.md` files:
//
//   | ID | P | Type | Spec | Assertion |
//
// where:
//   - ID           — test.id, verbatim
//   - P            — "P0" for Tier.Core, "P1" for Tier.Extended
//   - Type         — extracted from a leading "[Type] " prefix on
//                    `test.description`; falls back to "E2E" when no
//                    prefix is present. This is an authoring convention
//                    that avoids extending the data model for the pilot.
//   - Spec         — §-joined section refs, resolved by looking up each
//                    `test.rules[i]` in the parent spec's rule list;
//                    since the renderer has only the test plan in hand,
//                    section refs are carried on the test plan side via
//                    a `rulesBySection` map built externally. The pilot
//                    workflow threads the spec + test plan together, so
//                    this renderer receives an optional `ruleSection`
//                    lookup function.
//   - Assertion    — the description with any leading "[Type] " prefix
//                    stripped.
//
// Category headings strip the "CLI-TC-" prefix (or any `<PREFIX>-TC-`
// prefix) so the rendered heading reads `## A. Command Surface` rather
// than `## CLI-TC-A. Command Surface` — matching the source documents.
// The ID still lives in the data model for uniqueness (D29).

import type { NormalizedTestPlanModule, TestCategory, TestCase } from "../types.ts";
import { Tier } from "../enums.ts";
import { GENERATED_BANNER } from "./render-spec.ts";

export interface RenderTestPlanOptions {
  /**
   * Lookup from ruleId → section id. When provided, `test.rules` are
   * resolved to §-prefixed section refs in the Spec column. When
   * omitted, the Spec column falls back to joining the rule IDs —
   * useful for unit tests that don't thread a spec through.
   */
  readonly ruleSection?: (ruleId: string) => string | undefined;
  /**
   * Override the value emitted after `**Validates:**`. When omitted,
   * the renderer emits `plan.testsSpec.specId`. Use this when the
   * source document references a spec by its human title rather than
   * its id (e.g. `Validates: Tisyn CLI Specification`).
   */
  readonly validatesLabel?: string;
}

export function renderTestPlanMarkdown(
  plan: NormalizedTestPlanModule,
  options: RenderTestPlanOptions = {},
): string {
  const lines: string[] = [];
  lines.push(GENERATED_BANNER);
  lines.push("");
  lines.push(`# ${plan.title}`);
  lines.push("");
  lines.push(`**Validates:** ${options.validatesLabel ?? plan.testsSpec.specId}`);
  lines.push(`**Version:** ${plan.version}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const category of plan.categories) {
    renderCategory(lines, category, options);
  }

  if (plan.coverageMatrix.length > 0) {
    lines.push("## Coverage Matrix");
    lines.push("");
    for (const entry of plan.coverageMatrix) {
      lines.push(`- ${entry.ruleId} → ${entry.testIds.join(", ")}`);
    }
    lines.push("");
  }

  if (plan.nonTests.length > 0) {
    lines.push("## Non-Tests");
    lines.push("");
    for (const nt of plan.nonTests) {
      lines.push(`- **${nt.id}** — ${nt.description}`);
      lines.push(`  **Reason:** ${nt.reason}`);
    }
    lines.push("");
  }

  if (plan.ambiguitySurface.length > 0) {
    lines.push("## Ambiguity Surface");
    lines.push("");
    for (const amb of plan.ambiguitySurface) {
      lines.push(`- **${amb.id}** (${amb.resolution}) — ${amb.description}`);
    }
    lines.push("");
  }

  const trimmed = lines.map((l) => l.replace(/\s+$/, ""));
  const collapsed: string[] = [];
  let lastBlank = false;
  for (const l of trimmed) {
    const isBlank = l.length === 0;
    if (isBlank && lastBlank) {
      continue;
    }
    collapsed.push(l);
    lastBlank = isBlank;
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === "") {
    collapsed.pop();
  }
  return `${collapsed.join("\n")}\n`;
}

function renderCategory(
  lines: string[],
  category: TestCategory,
  options: RenderTestPlanOptions,
): void {
  // Strip any "<PREFIX>-TC-" prefix so `CLI-TC-A` → `A`.
  const displayId = category.id.replace(/^[A-Z]+-TC-/, "");
  lines.push(`## ${displayId}. ${category.title}`);
  lines.push("");
  lines.push("| ID | P | Type | Spec | Assertion |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const tc of category.tests) {
    lines.push(renderTestRow(tc, options));
  }
  lines.push("");
}

function renderTestRow(tc: TestCase, options: RenderTestPlanOptions): string {
  const priority = tc.tier === Tier.Core ? "P0" : "P1";
  const { type, assertion } = splitTypePrefix(tc.description);
  const specRefs = renderSpecRefs(tc, options);
  return `| ${tc.id} | ${priority} | ${type} | ${specRefs} | ${assertion} |`;
}

function splitTypePrefix(description: string): { type: string; assertion: string } {
  const match = description.match(/^\[([^\]]+)\]\s+(.*)$/);
  if (match != null) {
    return { type: match[1]!, assertion: match[2]! };
  }
  return { type: "E2E", assertion: description };
}

function renderSpecRefs(tc: TestCase, options: RenderTestPlanOptions): string {
  if (options.ruleSection == null) {
    return tc.rules.join(", ");
  }
  const sections = new Set<string>();
  for (const ruleId of tc.rules) {
    const section = options.ruleSection(ruleId);
    if (section != null) {
      sections.add(section);
    }
  }
  if (sections.size === 0) {
    return tc.rules.join(", ");
  }
  return [...sections].map((s) => `§${s}`).join(", ");
}
