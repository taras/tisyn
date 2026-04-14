// Deterministic Markdown renderer for NormalizedTestPlanModule.
//
// Contract: pure function, same input → byte-identical output.
//
// The renderer performs a depth-aware walk over `plan.sections` so a
// hand-authored test plan with nested prose subsections, numbered and
// unnumbered headings, and horizontal-rule dividers between groups can
// round-trip through `renderTestPlanMarkdown(normalizeTestPlan(plan))`
// back to the frozen fixture's H2 surface — the surface observed by
// `compareMarkdown` in the verify-corpus gate.
//
// Heading format rules (pinned to the handwritten-fixture style):
//
//   - Marker is `"#".repeat(depth)`: `##` at depth 2, `###` at depth 3.
//   - `number` + depth 2 → `"## N. Title"` (period + space after number).
//   - `number` + depth 3+ → `"### N.M Title"` (space only, no period).
//   - `number` omitted    → `"## Title"` (plain title, no prefix).
//
// Horizontal-rule dividers: when `section.precedingDivider === true` and
// the section is not the first emitted section at depth 2, the renderer
// emits `---` + blank line immediately before the heading. The metadata
// block already terminates with `---`, so a divider-before-first-section
// would collapse into a double rule.
//
// Test matrix slot: the section whose `id === plan.categoriesSectionId`
// is the wrapper that holds the category blocks. `renderSection` detects
// this slot and renders categories at `depth + 1` via `renderCategory`
// before recursing into any `subsections`. The CLI plan's §6 has no
// subsections, but we commit to "categories first, then subsections" as
// the stable ordering rule for future targets.
//
// Category table layout mirrors the hand-authored test plans:
//
//   | ID | P | Type | Spec | Assertion |
//
// where:
//   - ID           — test.id, verbatim
//   - P            — "P0" for Tier.Core, "P1" for Tier.Extended
//   - Type         — extracted from a leading "[Type] " prefix on
//                    `test.description`; falls back to "E2E" when no
//                    prefix is present.
//   - Spec         — §-joined section refs resolved via `ruleSection`;
//                    falls back to joining raw rule IDs when no lookup
//                    is supplied (useful for unit tests).
//   - Assertion    — the description with any leading "[Type] " prefix
//                    stripped.
//
// Category headings strip any `<PREFIX>-TC-` prefix so `CLI-TC-A`
// renders as `A. Command Surface`. The ID still lives in the data model
// for uniqueness (D29).

import type {
  NormalizedTestPlanModule,
  TestCategory,
  TestCase,
  TestPlanSection,
} from "../types.ts";
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
  if (plan.styleReference != null) {
    lines.push(`**Style reference:** ${plan.styleReference}`);
  }
  lines.push(`**Version:** ${plan.version}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (let i = 0; i < plan.sections.length; i++) {
    renderSection(lines, plan.sections[i]!, 2, plan, options, i === 0);
  }

  // coverageMatrix is intentionally NOT rendered as a separate H2 appendix.
  // It is data used by checkCoverage/isReady only; authored plans express
  // per-rule → per-test mappings via each test row's `rules` column, which
  // the renderer resolves to §-refs in the Spec column above. A future target
  // that wants a bullet-list appendix can author it as an explicit
  // `TestPlanSection` with the desired title.

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

function renderSection(
  lines: string[],
  section: TestPlanSection,
  depth: number,
  plan: NormalizedTestPlanModule,
  options: RenderTestPlanOptions,
  isFirstAtTop: boolean,
): void {
  // Divider-before-first-section collapses with the metadata block's `---`,
  // so we skip it even if the author requested it on the first top-level
  // section. Nested sections never suppress the divider.
  if (section.precedingDivider === true && !(depth === 2 && isFirstAtTop)) {
    lines.push("---");
    lines.push("");
  }

  const marker = "#".repeat(depth);
  let body: string;
  if (section.number != null) {
    body =
      depth === 2 ? `${section.number}. ${section.title}` : `${section.number} ${section.title}`;
  } else {
    body = section.title;
  }
  lines.push(`${marker} ${body}`);
  lines.push("");

  if (section.prose.length > 0) {
    for (const line of section.prose.split("\n")) {
      lines.push(line);
    }
    lines.push("");
  }

  if (section.id === plan.categoriesSectionId) {
    for (const category of plan.categories) {
      renderCategory(lines, category, depth + 1, options);
    }
  }

  for (const child of section.subsections) {
    renderSection(lines, child, depth + 1, plan, options, false);
  }
}

function renderCategory(
  lines: string[],
  category: TestCategory,
  depth: number,
  options: RenderTestPlanOptions,
): void {
  // Strip any "<PREFIX>-TC-" prefix so `CLI-TC-A` → `A`.
  const displayId = category.id.replace(/^[A-Z]+-TC-/, "");
  const marker = "#".repeat(depth);
  lines.push(`${marker} ${displayId}. ${category.title}`);
  lines.push("");
  lines.push("| ID | P | Type | Spec | Assertion |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const tc of category.tests) {
    lines.push(renderTestRow(tc, options));
  }
  lines.push("");
  if (category.notes != null && category.notes.length > 0) {
    for (const line of category.notes.split("\n")) {
      lines.push(line);
    }
    lines.push("");
  }
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
