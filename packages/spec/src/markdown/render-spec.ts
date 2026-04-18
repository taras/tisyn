// §11.1 renderSpecMarkdown — pure, deterministic projection of a spec.

import type { NormalizedSpecModule, Section, SpecModule } from "../types.ts";
import { GENERATED_BANNER } from "./banner.ts";

export interface RenderSpecOptions {
  readonly includeBanner?: boolean;
}

export function renderSpecMarkdown(
  spec: SpecModule | NormalizedSpecModule,
  options?: RenderSpecOptions,
): string {
  const includeBanner = options?.includeBanner ?? true;
  const out: string[] = [];
  if (includeBanner) {
    out.push(GENERATED_BANNER);
    out.push("");
  }
  out.push(`# ${spec.title}`);
  out.push("");
  out.push(`_Status: ${spec.status}_`);
  if (spec.implementationPackage !== undefined) {
    out.push(`_Implementation: ${spec.implementationPackage}_`);
  }
  out.push("");

  if (spec.relationships.length > 0) {
    out.push("## Relationships");
    out.push("");
    const sorted = [...spec.relationships].sort(compareRelationship);
    for (const rel of sorted) {
      const qualifier = rel.qualifier !== undefined ? ` — ${rel.qualifier}` : "";
      out.push(`- ${rel.type}: ${rel.target}${qualifier}`);
    }
    out.push("");
  }

  if (spec.openQuestions !== undefined && spec.openQuestions.length > 0) {
    out.push("## Open Questions");
    out.push("");
    for (const oq of spec.openQuestions) {
      const blocks = oq.blocksTarget !== undefined ? ` (blocks ${oq.blocksTarget})` : "";
      const resolved = oq.resolvedIn !== undefined ? ` (resolved in ${oq.resolvedIn})` : "";
      out.push(`- [${oq.id}] [${oq.status}]${blocks}${resolved} ${oq.text}`);
    }
    out.push("");
  }

  for (const section of spec.sections) {
    renderSection(out, section, 2);
  }

  return out.join("\n").replace(/\n+$/, "\n");
}

function renderSection(out: string[], section: Section, depth: number): void {
  const heading = "#".repeat(Math.min(depth, 6));
  const prefix = typeof section.id === "number" ? `§${section.id} ` : "";
  out.push(`${heading} ${prefix}${section.title}`);
  out.push("");
  if (section.prose.length > 0) {
    out.push(section.prose);
    out.push("");
  }

  if (section.rules !== undefined && section.rules.length > 0) {
    for (const rule of section.rules) {
      out.push(`- [${rule.id}] [${rule.level}] ${rule.text}`);
    }
    out.push("");
  }

  if (section.termDefinitions !== undefined && section.termDefinitions.length > 0) {
    for (const t of section.termDefinitions) {
      out.push(`**${t.term}** — ${t.definition}`);
    }
    out.push("");
  }

  if (section.errorCodes !== undefined && section.errorCodes.length > 0) {
    for (const e of section.errorCodes) {
      const req = e.requiredContent !== undefined ? ` (requires: ${e.requiredContent})` : "";
      out.push(`- [${e.code}] ${e.trigger}${req}`);
    }
    out.push("");
  }

  if (section.conceptExports !== undefined && section.conceptExports.length > 0) {
    for (const c of section.conceptExports) {
      out.push(`**${c.name}** — ${c.description}`);
    }
    out.push("");
  }

  if (section.invariants !== undefined && section.invariants.length > 0) {
    for (const inv of section.invariants) {
      out.push(`- [${inv.id}] ${inv.text}`);
    }
    out.push("");
  }

  if (section.subsections !== undefined) {
    for (const sub of section.subsections) {
      renderSection(out, sub, depth + 1);
    }
  }
}

function compareRelationship(
  a: SpecModule["relationships"][number],
  b: SpecModule["relationships"][number],
): number {
  if (a.type !== b.type) {
    return a.type < b.type ? -1 : 1;
  }
  if (a.target !== b.target) {
    return a.target < b.target ? -1 : 1;
  }
  const aq = a.qualifier ?? "";
  const bq = b.qualifier ?? "";
  if (aq !== bq) {
    return aq < bq ? -1 : 1;
  }
  return 0;
}
