// normalizeSpec / normalizeTestPlan per §6 of
// spec-system-specification.source.md. Both entry points return a
// NormalizeResult<T> rather than throwing (commit-0 amendment to §11.2, §11.5,
// §13.2), so callers discriminate on `result.ok` without a try/catch.

import { computeHash } from "./hash.ts";
import {
  validateSpecStructural,
  validateTestPlanStructural,
} from "./structural.ts";
import type {
  NormalizeResult,
  NormalizedSpecModule,
  NormalizedTestPlanModule,
  SpecModule,
  SpecSection,
  StructuralError,
  TestPlanModule,
} from "./types.ts";

// N4 — depth-first section numbering. Top-level sections are §1, §2, ...;
// subsections inherit the parent prefix and a child index.
function computeSectionNumbering(
  sections: readonly SpecSection[],
): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(nodes: readonly SpecSection[], prefix: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const number = prefix === "" ? `§${i + 1}` : `${prefix}.${i + 1}`;
      out[node.id] = number;
      walk(node.subsections, number);
    }
  }
  walk(sections, "");
  return out;
}

// N5 — rule and invariant locations, resolved against _sectionNumbering.
// Structural validation has already flagged missing section refs, so every
// key here is guaranteed to resolve.
function computeRuleLocations(
  module: SpecModule,
  sectionNumbering: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of module.rules) {
    const number = sectionNumbering[rule.section];
    if (number != null) out[rule.id] = number;
  }
  for (const inv of module.invariants) {
    const number = sectionNumbering[inv.section];
    if (number != null) out[inv.id] = number;
  }
  return out;
}

export function normalizeSpec(
  module: SpecModule,
): NormalizeResult<NormalizedSpecModule> {
  const structural: readonly StructuralError[] = validateSpecStructural(module);
  if (structural.length > 0) {
    return { ok: false, errors: structural };
  }

  const _sectionNumbering = computeSectionNumbering(module.sections);
  const _ruleLocations = computeRuleLocations(module, _sectionNumbering);

  // Hash is computed over authored fields + _sectionNumbering + _ruleLocations
  // (the computed fields that are not _hash or _normalizedAt). N6 forbids
  // dependence on _normalizedAt; computeHash strips _hash and _normalizedAt
  // before hashing, so we can safely pre-stage everything else.
  const withComputed: Omit<NormalizedSpecModule, "_hash" | "_normalizedAt"> = {
    ...module,
    _sectionNumbering,
    _ruleLocations,
  };
  const _hash = computeHash(withComputed as unknown as Record<string, unknown>);
  const _normalizedAt = new Date().toISOString();

  const value: NormalizedSpecModule = {
    ...withComputed,
    _hash,
    _normalizedAt,
  };
  return { ok: true, value };
}

export function normalizeTestPlan(
  module: TestPlanModule,
): NormalizeResult<NormalizedTestPlanModule> {
  const structural: readonly StructuralError[] = validateTestPlanStructural(
    module,
  );
  if (structural.length > 0) {
    return { ok: false, errors: structural };
  }

  // N2 — authored fields pass through unchanged. D33's evidence default was
  // already applied by the TestCase constructor (D2 in plan); normalize must
  // NOT re-default it, otherwise _hash would shift on round-trip.
  const _hash = computeHash(module as unknown as Record<string, unknown>);
  const _normalizedAt = new Date().toISOString();

  const value: NormalizedTestPlanModule = {
    ...module,
    _hash,
    _normalizedAt,
  };
  return { ok: true, value };
}

// ── Internal artifact helpers (N10, N11) ──
//
// These are module-private: tests import them via ./normalize.ts, but they
// are NOT re-exported from src/index.ts. If a future consumer needs them
// publicly, the source spec must be amended first.

export function artifactPath(specsDir: string, moduleId: string): string {
  return `${specsDir}/.tisyn-spec/${moduleId}.json`;
}

export function serializeArtifact(
  normalized: NormalizedSpecModule | NormalizedTestPlanModule,
): string {
  return JSON.stringify(normalized, null, 2);
}
