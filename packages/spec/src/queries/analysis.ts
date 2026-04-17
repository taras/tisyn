// §8.6 Analysis queries.

import { getInternalExtras } from "../registry.ts";
import type {
  CorpusRegistry,
  CoverageResult,
  CoveredRule,
  DeferredRule,
  DuplicateRule,
  ErrorCodeCollision,
  NormalizedTestPlanModule,
  ReadinessResult,
  Rule,
  RuleLocation,
  StaleReference,
  Section,
  TermConflict,
  TermLocation,
  UncoveredRule,
} from "../types.ts";
import { listRules } from "./listing.ts";

function findCompanionPlan(
  registry: CorpusRegistry,
  specId: string,
): NormalizedTestPlanModule | undefined {
  for (const plan of registry.plans.values()) {
    if (plan.validatesSpec === specId) {
      return plan;
    }
  }
  return undefined;
}

// §8.6 checkCoverage — ignores coverage entries whose `rule` id does not
// resolve in the target spec (SS-QA-017).
export function checkCoverage(registry: CorpusRegistry, specId: string): CoverageResult {
  const plan = findCompanionPlan(registry, specId);
  const ruleLocations = listRules(registry, specId);
  if (plan === undefined) {
    const uncovered: UncoveredRule[] = ruleLocations.map((r) => ({
      rule: r.rule,
      sectionId: r.sectionId,
    }));
    return {
      specId,
      companionPlanId: undefined,
      coveredRules: [],
      uncoveredRules: uncovered,
      deferredRules: [],
      stats: {
        total: ruleLocations.length,
        covered: 0,
        uncovered: uncovered.length,
        deferred: 0,
      },
    };
  }
  const ruleToLoc = new Map<string, RuleLocation>();
  for (const loc of ruleLocations) {
    ruleToLoc.set(loc.rule.id, loc);
  }

  const covered: CoveredRule[] = [];
  const deferred: DeferredRule[] = [];
  const matchedIds = new Set<string>();
  for (const entry of plan.coverageMatrix) {
    const loc = ruleToLoc.get(entry.rule);
    if (loc === undefined) {
      continue;
    } // SS-QA-017: ignore unresolved rule refs
    matchedIds.add(entry.rule);
    if (entry.status === "covered") {
      covered.push({
        rule: loc.rule,
        sectionId: loc.sectionId,
        testIds: entry.testIds,
      });
    } else if (entry.status === "deferred") {
      deferred.push({
        rule: loc.rule,
        sectionId: loc.sectionId,
        reason: "deferred",
      });
    }
    // status === "uncovered" → surfaces via the unmatched-rule path below.
  }
  const uncovered: UncoveredRule[] = [];
  for (const loc of ruleLocations) {
    if (!matchedIds.has(loc.rule.id)) {
      uncovered.push({ rule: loc.rule, sectionId: loc.sectionId });
    } else {
      const entry = plan.coverageMatrix.find((e) => e.rule === loc.rule.id);
      if (entry?.status === "uncovered") {
        uncovered.push({ rule: loc.rule, sectionId: loc.sectionId });
      }
    }
  }

  return {
    specId,
    companionPlanId: plan.id,
    coveredRules: covered,
    uncoveredRules: uncovered,
    deferredRules: deferred,
    stats: {
      total: ruleLocations.length,
      covered: covered.length,
      uncovered: uncovered.length,
      deferred: deferred.length,
    },
  };
}

// §8.6 isReady — returns the spec's readiness + specific blocking codes.
export function isReady(registry: CorpusRegistry, specId: string): ReadinessResult {
  const spec = registry.specs.get(specId);
  if (spec === undefined) {
    return { specId, ready: false, blocking: ["spec-not-found"] };
  }
  const blocking: string[] = [];
  if (spec.status !== "active") {
    blocking.push("status-not-active");
  }
  const plan = findCompanionPlan(registry, specId);
  if (plan === undefined) {
    blocking.push("no-companion-plan");
  }
  const coverage = checkCoverage(registry, specId);
  const uncoveredMust = coverage.uncoveredRules.some(
    (r) => r.rule.level === "must" || r.rule.level === "must-not",
  );
  if (uncoveredMust) {
    blocking.push("uncovered-must-rules");
  }
  if (spec.openQuestions !== undefined) {
    const hasOpen = spec.openQuestions.some((oq) => oq.status === "open");
    if (hasOpen) {
      blocking.push("open-questions");
    }
  }
  return { specId, ready: blocking.length === 0, blocking };
}

// §8.6 findTermConflicts — terms defined in two or more in-scope specs with
// different definition text.
export function findTermConflicts(registry: CorpusRegistry): readonly TermConflict[] {
  const extras = getInternalExtras(registry);
  const allTerms: readonly TermLocation[] =
    extras !== undefined ? extras.allTermLocations : [...registry.termIndex.values()];
  const byTerm = new Map<string, TermLocation[]>();
  for (const loc of allTerms) {
    const bucket = byTerm.get(loc.definition.term) ?? [];
    bucket.push(loc);
    byTerm.set(loc.definition.term, bucket);
  }
  const out: TermConflict[] = [];
  for (const [term, locations] of byTerm) {
    if (locations.length < 2) {
      continue;
    }
    const definitions = new Set(locations.map((l) => l.definition.definition));
    if (definitions.size < 2) {
      continue;
    }
    out.push({ term, definitions: locations });
  }
  return out;
}

function collectSectionIds(sections: readonly Section[], out: Set<string>): void {
  for (const section of sections) {
    out.add(String(section.id));
    if (section.subsections !== undefined) {
      collectSectionIds(section.subsections, out);
    }
  }
}

// §8.6 findStaleReferences — missing-spec, missing-section, superseded-spec.
const SECTION_REF = /§(\d+(?:\.\d+)?)/g;

export function findStaleReferences(registry: CorpusRegistry): readonly StaleReference[] {
  const out: StaleReference[] = [];

  // Unresolved relationship targets + superseded targets.
  for (const spec of registry.specs.values()) {
    for (const rel of spec.relationships) {
      const target = registry.specs.get(rel.target);
      if (target === undefined) {
        out.push({
          sourceSpecId: spec.id,
          referencedSpecId: rel.target,
          problem: "missing-spec",
        });
      } else if (target.status === "superseded") {
        out.push({
          sourceSpecId: spec.id,
          referencedSpecId: rel.target,
          problem: "superseded-spec",
        });
      }
    }
  }

  // Prose §-references to missing sections within the same spec.
  for (const spec of registry.specs.values()) {
    const sectionIds = new Set<string>();
    collectSectionIds(spec.sections, sectionIds);
    const proseBlobs: string[] = [];
    function walk(sections: readonly Section[]): void {
      for (const s of sections) {
        proseBlobs.push(s.prose);
        if (s.subsections !== undefined) {
          walk(s.subsections);
        }
      }
    }
    walk(spec.sections);
    const blob = proseBlobs.join("\n");
    SECTION_REF.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SECTION_REF.exec(blob)) !== null) {
      const referenced = match[1]!;
      if (!sectionIds.has(referenced)) {
        out.push({
          sourceSpecId: spec.id,
          referencedSpecId: spec.id,
          referencedSection: referenced,
          problem: "missing-section",
        });
      }
    }
  }

  return out;
}

// §8.6 findErrorCodeCollisions — same code in two or more in-scope specs.
export function findErrorCodeCollisions(registry: CorpusRegistry): readonly ErrorCodeCollision[] {
  const extras = getInternalExtras(registry);
  const all =
    extras !== undefined ? extras.allErrorCodeLocations : [...registry.errorCodeIndex.values()];
  const byCode = new Map<string, (typeof all)[number][]>();
  for (const loc of all) {
    const bucket = byCode.get(loc.errorCode.code) ?? [];
    bucket.push(loc);
    byCode.set(loc.errorCode.code, bucket);
  }
  const out: ErrorCodeCollision[] = [];
  for (const [code, locations] of byCode) {
    const distinctSpecs = new Set(locations.map((l) => l.specId));
    if (distinctSpecs.size < 2) {
      continue;
    }
    out.push({ code, locations });
  }
  return out;
}

// §8.6 findDuplicateRules — rule ids appearing in two or more in-scope specs.
export function findDuplicateRules(registry: CorpusRegistry): readonly DuplicateRule[] {
  const extras = getInternalExtras(registry);
  const all = extras !== undefined ? extras.allRuleLocations : [...registry.ruleIndex.values()];
  const byId = new Map<string, (typeof all)[number][]>();
  for (const loc of all) {
    const bucket = byId.get(loc.rule.id) ?? [];
    bucket.push(loc);
    byId.set(loc.rule.id, bucket);
  }
  const out: DuplicateRule[] = [];
  for (const [ruleId, locations] of byId) {
    const distinctSpecs = new Set(locations.map((l) => l.specId));
    if (distinctSpecs.size < 2) {
      continue;
    }
    out.push({ ruleId, locations });
  }
  return out;
}

// Re-exported level type so projection can construct typed helpers.
export type Level = Rule["level"];
