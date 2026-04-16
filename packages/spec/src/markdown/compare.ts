// Deterministic structural comparison between an "original" Markdown
// document and a "generated" one. This is NOT a semantic equivalence
// check — that's Claude's job in the verify pipeline. compareMarkdown
// catches missing/extra sections, test IDs, coverage refs, and
// relationship lines; it does NOT compare prose wording.

import { GENERATED_BANNER } from "./render-spec.ts";

export interface ComparisonReport {
  readonly ok: boolean;
  readonly differences: readonly ComparisonDifference[];
  readonly summary: {
    readonly missingSections: readonly string[];
    readonly extraSections: readonly string[];
    readonly missingTestIds: readonly string[];
    readonly extraTestIds: readonly string[];
    readonly missingRelationships: readonly string[];
    readonly extraRelationships: readonly string[];
    readonly missingCoverageRefs: readonly string[];
    readonly extraCoverageRefs: readonly string[];
  };
}

export interface ComparisonDifference {
  readonly kind: "title" | "section" | "test-id" | "coverage-ref" | "relationship";
  readonly original: string;
  readonly generated: string;
  readonly detail: string;
}

export function stripBanner(markdown: string): string {
  // Remove a leading generator banner (exact or same prefix) followed
  // by an optional blank line. Anything else passes through unchanged.
  const lines = markdown.split("\n");
  if (lines.length === 0) {
    return markdown;
  }
  const first = lines[0] ?? "";
  if (first === GENERATED_BANNER || /^<!-- Generated from .* -->$/.test(first)) {
    lines.shift();
    if (lines.length > 0 && lines[0] === "") {
      lines.shift();
    }
    return lines.join("\n");
  }
  return markdown;
}

export function compareMarkdown(original: string, generated: string): ComparisonReport {
  const origText = stripBanner(original);
  const genText = stripBanner(generated);

  const differences: ComparisonDifference[] = [];

  const origTitle = extractTitle(origText);
  const genTitle = extractTitle(genText);
  if (origTitle !== genTitle) {
    differences.push({
      kind: "title",
      original: origTitle,
      generated: genTitle,
      detail: `Document titles differ`,
    });
  }

  const origSections = extractSectionHeadings(origText);
  const genSections = extractSectionHeadings(genText);
  const missingSections = diff(origSections, genSections);
  const extraSections = diff(genSections, origSections);
  for (const s of missingSections) {
    differences.push({
      kind: "section",
      original: s,
      generated: "",
      detail: `Section "${s}" is present in original but missing from generated`,
    });
  }
  for (const s of extraSections) {
    differences.push({
      kind: "section",
      original: "",
      generated: s,
      detail: `Section "${s}" is present in generated but not in original`,
    });
  }

  const origTestIds = extractTestIds(origText);
  const genTestIds = extractTestIds(genText);
  const missingTestIds = diff(origTestIds, genTestIds);
  const extraTestIds = diff(genTestIds, origTestIds);
  for (const id of missingTestIds) {
    differences.push({
      kind: "test-id",
      original: id,
      generated: "",
      detail: `Test ID "${id}" is present in original but missing from generated`,
    });
  }
  for (const id of extraTestIds) {
    differences.push({
      kind: "test-id",
      original: "",
      generated: id,
      detail: `Test ID "${id}" is present in generated but not in original`,
    });
  }

  const origRefs = extractCoverageRefs(origText);
  const genRefs = extractCoverageRefs(genText);
  const missingCoverageRefs = diff(origRefs, genRefs);
  const extraCoverageRefs = diff(genRefs, origRefs);
  for (const ref of missingCoverageRefs) {
    differences.push({
      kind: "coverage-ref",
      original: ref,
      generated: "",
      detail: `Coverage ref "${ref}" is present in original but missing from generated`,
    });
  }
  for (const ref of extraCoverageRefs) {
    differences.push({
      kind: "coverage-ref",
      original: "",
      generated: ref,
      detail: `Coverage ref "${ref}" is present in generated but not in original`,
    });
  }

  const origRels = extractRelationshipLines(origText);
  const genRels = extractRelationshipLines(genText);
  const missingRelationships = diff(origRels, genRels);
  const extraRelationships = diff(genRels, origRels);
  for (const rel of missingRelationships) {
    differences.push({
      kind: "relationship",
      original: rel,
      generated: "",
      detail: `Relationship line "${rel}" missing from generated`,
    });
  }
  for (const rel of extraRelationships) {
    differences.push({
      kind: "relationship",
      original: "",
      generated: rel,
      detail: `Relationship line "${rel}" not in original`,
    });
  }

  return {
    ok: differences.length === 0,
    differences,
    summary: {
      missingSections,
      extraSections,
      missingTestIds,
      extraTestIds,
      missingRelationships,
      extraRelationships,
      missingCoverageRefs,
      extraCoverageRefs,
    },
  };
}

function extractTitle(markdown: string): string {
  for (const line of markdown.split("\n")) {
    const match = line.match(/^#\s+(.*)$/);
    if (match != null) {
      return normalize(match[1]!);
    }
  }
  return "";
}

function extractSectionHeadings(markdown: string): string[] {
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^##\s+(.*)$/);
    if (match != null) {
      out.push(normalize(match[1]!));
    }
  }
  return out;
}

function extractTestIds(markdown: string): string[] {
  const ids = new Set<string>();
  const re = /\b[A-Z]+(?:-[A-Z]+)+-\d{3}[a-z]?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) != null) {
    ids.add(m[0]);
  }
  return [...ids].sort();
}

function extractCoverageRefs(markdown: string): string[] {
  const refs = new Set<string>();
  const re = /§\d+(?:\.\d+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) != null) {
    refs.add(m[0]);
  }
  return [...refs].sort();
}

function extractRelationshipLines(markdown: string): string[] {
  const out = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = line.match(
      /^\*\*(Depends on|Complements|Implements|Amends|Validates):\*\*\s*(.*)$/,
    );
    if (match != null) {
      out.add(`${match[1]}:${normalize(match[2]!)}`);
    }
  }
  return [...out].sort();
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function diff(a: readonly string[], b: readonly string[]): string[] {
  const bSet = new Set(b);
  return a.filter((x) => !bSet.has(x));
}
