// Deterministic Markdown renderer for NormalizedSpecModule.
//
// Contract: pure function, same input → byte-identical output. No
// wall-clock reads, no environment lookups, no randomness. The banner
// on line 1 is a fixed string so downstream comparison can strip it
// uniformly.
//
// Design notes:
// - Rule IDs are authoring-only and are NOT emitted. The source
//   documents don't carry rule IDs, so rendering them would break
//   round-trip comparison with the pre-migration handwritten files.
// - Headings are `## {section.id}. {section.title}` for top-level
//   sections, `### {section.id}. {section.title}` for subsections,
//   and so on (depth + 2).
// - Per-section ordering: prose, then rules, errorCodes, concepts,
//   invariants, terms whose `.section` matches this section's id.
//   Subsections render after the section's own bullets.

import type {
  ConceptExport,
  ErrorCodeDeclaration,
  InvariantDeclaration,
  NormalizedSpecModule,
  RuleDeclaration,
  SpecSection,
  TermDefinition,
} from "../types.ts";

export const GENERATED_BANNER =
  "<!-- Generated from packages/spec/corpus — do not edit by hand. -->";

export function renderSpecMarkdown(spec: NormalizedSpecModule): string {
  const lines: string[] = [];
  lines.push(GENERATED_BANNER);
  lines.push("");
  lines.push(`# ${spec.title}`);
  lines.push("");

  const relLines = renderRelationshipLines(spec);
  if (relLines.length > 0) {
    for (const line of relLines) {
      lines.push(line);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  for (const section of spec.sections) {
    renderSection(lines, section, 0, spec);
  }

  // Normalize: trim trailing whitespace on each line, collapse runs of
  // empty lines to at most one, ensure a single trailing newline.
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

function renderRelationshipLines(spec: NormalizedSpecModule): string[] {
  const out: string[] = [];
  if (spec.dependsOn.length > 0) {
    out.push(`**Depends on:** ${spec.dependsOn.map((r) => r.specId).join(", ")}`);
  }
  if (spec.complements.length > 0) {
    out.push(`**Complements:** ${spec.complements.map((r) => r.specId).join(", ")}`);
  }
  if (spec.implements.length > 0) {
    out.push(`**Implements:** ${spec.implements.map((r) => r.specId).join(", ")}`);
  }
  if (spec.amends.length > 0) {
    out.push(`**Amends:** ${spec.amends.map((r) => r.specId).join(", ")}`);
  }
  return out;
}

function renderSection(
  lines: string[],
  section: SpecSection,
  depth: number,
  spec: NormalizedSpecModule,
): void {
  const headingLevel = Math.min(6, depth + 2);
  const hashes = "#".repeat(headingLevel);
  lines.push(`${hashes} ${section.id}. ${section.title}`);
  lines.push("");
  if (section.prose.length > 0) {
    lines.push(section.prose);
    lines.push("");
  }

  const rules = spec.rules.filter((r) => r.section === section.id);
  for (const rule of rules) {
    renderRuleBullet(lines, rule);
  }
  if (rules.length > 0) {
    lines.push("");
  }

  const ecs = spec.errorCodes.filter((e) => e.section === section.id);
  for (const ec of ecs) {
    renderErrorCodeBullet(lines, ec);
  }
  if (ecs.length > 0) {
    lines.push("");
  }

  const concepts = spec.concepts.filter((c) => c.section === section.id);
  for (const c of concepts) {
    renderConceptBullet(lines, c);
  }
  if (concepts.length > 0) {
    lines.push("");
  }

  const invariants = spec.invariants.filter((i) => i.section === section.id);
  for (const inv of invariants) {
    renderInvariantBullet(lines, inv);
  }
  if (invariants.length > 0) {
    lines.push("");
  }

  const terms = spec.terms.filter((t) => t.section === section.id);
  for (const t of terms) {
    renderTermBullet(lines, t);
  }
  if (terms.length > 0) {
    lines.push("");
  }

  for (const sub of section.subsections) {
    renderSection(lines, sub, depth + 1, spec);
  }
}

function renderRuleBullet(lines: string[], rule: RuleDeclaration): void {
  lines.push(`- **${rule.strength}** — ${rule.statement}`);
  if (rule.prose != null && rule.prose.length > 0) {
    lines.push(`  ${rule.prose}`);
  }
}

function renderErrorCodeBullet(lines: string[], ec: ErrorCodeDeclaration): void {
  lines.push(`- **${ec.code}** — ${ec.trigger}`);
  if (ec.requiredContent != null && ec.requiredContent.length > 0) {
    for (const req of ec.requiredContent) {
      lines.push(`  - ${req}`);
    }
  }
}

function renderConceptBullet(lines: string[], concept: ConceptExport): void {
  lines.push(`- **${concept.name}** — ${concept.description}`);
}

function renderInvariantBullet(lines: string[], inv: InvariantDeclaration): void {
  lines.push(`- **${inv.id}** — ${inv.statement}`);
}

function renderTermBullet(lines: string[], term: TermDefinition): void {
  lines.push(`- **${term.term}** — ${term.definition}`);
}
