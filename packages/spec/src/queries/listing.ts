// §8.4 Listing queries. All pure; all return empty arrays on miss.

import type {
  CorpusRegistry,
  DependencyEntry,
  DependentEntry,
  ErrorCodeLocation,
  OpenQuestion,
  OpenQuestionLocation,
  Rule,
  RuleLocation,
  Section,
  TermLocation,
} from "../types.ts";
import { getInternalExtras } from "../registry.ts";

function walkRulesInOrder(
  specId: string,
  sections: readonly Section[],
  out: RuleLocation[],
): void {
  for (const section of sections) {
    if (section.rules !== undefined) {
      for (const rule of section.rules) {
        out.push({ specId, sectionId: section.id, rule });
      }
    }
    if (section.subsections !== undefined) {
      walkRulesInOrder(specId, section.subsections, out);
    }
  }
}

// §8.4 listRules — returns all rules in the named spec, in section order.
// Empty array if the spec is not found or has no rules.
export function listRules(
  registry: CorpusRegistry,
  specId: string,
): readonly RuleLocation[] {
  const spec = registry.specs.get(specId);
  if (spec === undefined) return [];
  const out: RuleLocation[] = [];
  walkRulesInOrder(specId, spec.sections, out);
  return out;
}

// §8.4 listRulesByLevel — walks every in-scope spec in dependencyOrder.
export function listRulesByLevel(
  registry: CorpusRegistry,
  level: Rule["level"],
): readonly RuleLocation[] {
  const out: RuleLocation[] = [];
  for (const specId of registry.dependencyOrder) {
    for (const loc of listRules(registry, specId)) {
      if (loc.rule.level === level) out.push(loc);
    }
  }
  return out;
}

// §8.4 listDependencies — declared regardless of scope (SS-QS-004).
export function listDependencies(
  registry: CorpusRegistry,
  specId: string,
): readonly DependencyEntry[] {
  const spec = registry.specs.get(specId);
  if (spec === undefined) return [];
  const out: DependencyEntry[] = [];
  for (const rel of spec.relationships) {
    if (rel.type === "depends-on" || rel.type === "amends" || rel.type === "complements") {
      out.push({ specId: rel.target, relationship: rel });
    }
  }
  return out;
}

// §8.4 listDependents — in-scope only; scope-relative.
export function listDependents(
  registry: CorpusRegistry,
  targetSpecId: string,
): readonly DependentEntry[] {
  const out: DependentEntry[] = [];
  for (const spec of registry.specs.values()) {
    for (const rel of spec.relationships) {
      if (rel.target === targetSpecId) {
        out.push({ specId: spec.id, relationship: rel });
      }
    }
  }
  return out;
}

// §8.4 listOpenQuestions — optional filter on status / blocksTarget.
export function listOpenQuestions(
  registry: CorpusRegistry,
  filter?: { readonly status?: OpenQuestion["status"]; readonly blocksTarget?: string },
): readonly OpenQuestionLocation[] {
  const out: OpenQuestionLocation[] = [];
  for (const specId of registry.dependencyOrder) {
    const spec = registry.specs.get(specId);
    if (spec === undefined || spec.openQuestions === undefined) continue;
    for (const oq of spec.openQuestions) {
      if (filter?.status !== undefined && oq.status !== filter.status) continue;
      if (filter?.blocksTarget !== undefined && oq.blocksTarget !== filter.blocksTarget) continue;
      out.push({ specId: spec.id, openQuestion: oq });
    }
  }
  return out;
}

export function listTerms(registry: CorpusRegistry): readonly TermLocation[] {
  const extras = getInternalExtras(registry);
  if (extras !== undefined) return extras.allTermLocations;
  return [...registry.termIndex.values()];
}

export function listErrorCodes(registry: CorpusRegistry): readonly ErrorCodeLocation[] {
  const extras = getInternalExtras(registry);
  if (extras !== undefined) return extras.allErrorCodeLocations;
  return [...registry.errorCodeIndex.values()];
}
