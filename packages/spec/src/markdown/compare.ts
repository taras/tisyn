// §11.2 compareMarkdown — coarse structural gate.
//
// Extracts four categories of tokens from each document and diffs them as
// multisets: section headings, relationship lines, test ids, and §-coverage
// references. Prose wording, H3 structure, divider placement, and table
// formatting are deliberately out of scope (see §11.2 NOTE).

import type { CompareResult, MarkdownDifference } from "../types.ts";
import { stripBanner } from "./banner.ts";

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const RELATIONSHIP_RE = /^-\s+([a-z-]+):\s+([a-zA-Z0-9_-]+)(?:\s+—\s+(.+))?$/;
const TEST_ID_RE = /\b([A-Z][A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/g;
const SECTION_REF_RE = /§(\d+(?:\.\d+)*)/g;

interface Tokens {
  readonly headings: readonly string[];
  readonly relationships: readonly string[];
  readonly testIds: readonly string[];
  readonly coverageRefs: readonly string[];
}

function extract(text: string): Tokens {
  const cleaned = stripBanner(text);
  const lines = cleaned.split("\n");
  const headings: string[] = [];
  const relationships: string[] = [];
  const testIds = new Set<string>();
  const coverageRefs = new Set<string>();

  for (const line of lines) {
    const h = HEADING_RE.exec(line);
    if (h !== null) {
      headings.push(`${h[1]} ${h[2]}`);
      continue;
    }
    const r = RELATIONSHIP_RE.exec(line);
    if (r !== null) {
      const qualifier = r[3] !== undefined ? ` — ${r[3]}` : "";
      relationships.push(`${r[1]}: ${r[2]}${qualifier}`);
    }
    for (const m of line.matchAll(TEST_ID_RE)) testIds.add(m[1]);
    for (const m of line.matchAll(SECTION_REF_RE)) coverageRefs.add(`§${m[1]}`);
  }

  return {
    headings: [...headings].sort(),
    relationships: [...relationships].sort(),
    testIds: [...testIds].sort(),
    coverageRefs: [...coverageRefs].sort(),
  };
}

function diff(
  kind: MarkdownDifference["kind"],
  generated: readonly string[],
  reference: readonly string[],
): MarkdownDifference[] {
  const out: MarkdownDifference[] = [];
  const g = new Map<string, number>();
  const r = new Map<string, number>();
  for (const v of generated) g.set(v, (g.get(v) ?? 0) + 1);
  for (const v of reference) r.set(v, (r.get(v) ?? 0) + 1);
  const keys = new Set<string>([...g.keys(), ...r.keys()]);
  for (const key of [...keys].sort()) {
    const gc = g.get(key) ?? 0;
    const rc = r.get(key) ?? 0;
    if (gc === rc) continue;
    out.push({
      kind,
      expected: rc > 0 ? key : "",
      actual: gc > 0 ? key : "",
    });
  }
  return out;
}

export function compareMarkdown(generated: string, reference: string): CompareResult {
  const g = extract(generated);
  const r = extract(reference);
  const differences: MarkdownDifference[] = [
    ...diff("section-heading", g.headings, r.headings),
    ...diff("relationship-line", g.relationships, r.relationships),
    ...diff("test-id", g.testIds, r.testIds),
    ...diff("coverage-ref", g.coverageRefs, r.coverageRefs),
  ];
  return { match: differences.length === 0, differences };
}
