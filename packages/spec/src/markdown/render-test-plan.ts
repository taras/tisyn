// §11.1 renderTestPlanMarkdown — pure, deterministic projection of a test plan.

import type { NormalizedTestPlanModule, TestPlanModule, TestPlanSection } from "../types.ts";
import { GENERATED_BANNER } from "./banner.ts";

export interface RenderTestPlanOptions {
  readonly includeBanner?: boolean;
}

export function renderTestPlanMarkdown(
  plan: TestPlanModule | NormalizedTestPlanModule,
  options?: RenderTestPlanOptions,
): string {
  const includeBanner = options?.includeBanner ?? true;
  const out: string[] = [];
  if (includeBanner) {
    out.push(GENERATED_BANNER);
    out.push("");
  }
  out.push(`# ${plan.title}`);
  out.push("");
  out.push(`_Validates: ${plan.validatesSpec}_`);
  const catSectionLabel =
    typeof plan.categoriesSectionId === "number"
      ? `§${plan.categoriesSectionId}`
      : plan.categoriesSectionId;
  out.push(`_Categories section: ${catSectionLabel}_`);
  if (plan.styleReference !== undefined) {
    out.push(`_Style: ${plan.styleReference}_`);
  }
  out.push("");

  for (const section of plan.sections) {
    renderPlanSection(out, plan, section, 2);
  }

  out.push("## Coverage Matrix");
  out.push("");
  out.push("| Rule | Status | Tests | Reason |");
  out.push("| --- | --- | --- | --- |");
  for (const entry of plan.coverageMatrix) {
    const tests = entry.testIds.join(", ");
    out.push(`| ${entry.rule} | ${entry.status} | ${tests} |  |`);
  }
  out.push("");

  return out.join("\n").replace(/\n+$/, "\n");
}

function renderPlanSection(
  out: string[],
  plan: TestPlanModule | NormalizedTestPlanModule,
  section: TestPlanSection,
  depth: number,
): void {
  if (section.precedingDivider === true) {
    out.push("---");
    out.push("");
  }
  const heading = "#".repeat(Math.min(depth, 6));
  const prefix = typeof section.id === "number" ? `§${section.id} ` : "";
  out.push(`${heading} ${prefix}${section.title}`);
  out.push("");
  if (section.prose.length > 0) {
    out.push(section.prose);
    out.push("");
  }

  if (plan.categoriesSectionId === section.id) {
    for (const cat of plan.categories) {
      out.push(`### ${cat.id}: ${cat.title}`);
      out.push("");
      if (cat.notes !== undefined && cat.notes.length > 0) {
        out.push(cat.notes);
        out.push("");
      }
      for (const tc of cat.cases) {
        out.push(`- [${tc.id}] [${tc.priority}] [${tc.type}] (${tc.specRef}) ${tc.assertion}`);
      }
      out.push("");
    }
  }

  if (section.subsections !== undefined) {
    for (const sub of section.subsections) {
      renderPlanSection(out, plan, sub, depth + 1);
    }
  }
}
