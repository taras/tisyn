// §8.7 Projection queries.

import type {
  ConstraintDocument,
  CorpusRegistry,
  DiscoveryPack,
  DiscoveryPackOQ,
  DiscoveryPackSpec,
  DiscoveryPackTerm,
  OpenQuestionLocation,
  RuleLocation,
  TaskContext,
  TaskContextQuery,
  TermLocation,
} from "../types.ts";
import {
  checkCoverage,
  findDuplicateRules,
  findErrorCodeCollisions,
  findStaleReferences,
  findTermConflicts,
  isReady,
} from "./analysis.ts";
import {
  listDependencies,
  listDependents,
  listOpenQuestions,
  listRules,
  listTerms,
} from "./listing.ts";
import { findSpec } from "./lookup.ts";
import { hasCycles } from "./relationship.ts";

function estimateTokens(payload: unknown): number {
  const text = JSON.stringify(payload) ?? "";
  return Math.ceil(text.length / 4);
}

export function generateDiscoveryPack(
  registry: CorpusRegistry,
  opts?: { readonly now?: () => string },
): DiscoveryPack {
  const now = opts?.now ?? (() => new Date().toISOString());
  const specs: DiscoveryPackSpec[] = [];
  for (const specId of registry.dependencyOrder) {
    const spec = registry.specs.get(specId);
    if (spec === undefined) continue;
    const cov = checkCoverage(registry, spec.id);
    const ready = isReady(registry, spec.id).ready;
    const base = {
      id: spec.id,
      title: spec.title,
      status: spec.status,
      relationships: spec.relationships,
      ruleCount: cov.stats.total,
      coverage: {
        total: cov.stats.total,
        covered: cov.stats.covered,
        uncovered: cov.stats.uncovered,
      },
      ready,
    };
    const entry: DiscoveryPackSpec =
      spec.implementationPackage !== undefined
        ? { ...base, implementationPackage: spec.implementationPackage }
        : base;
    specs.push(entry);
  }

  const terms: DiscoveryPackTerm[] = [...registry.termIndex.values()].map((loc) => ({
    term: loc.definition.term,
    specId: loc.specId,
    definition: loc.definition.definition,
  }));

  const openQuestions: DiscoveryPackOQ[] = [];
  for (const loc of listOpenQuestions(registry)) {
    const base = {
      id: loc.openQuestion.id,
      specId: loc.specId,
      status: loc.openQuestion.status,
    };
    openQuestions.push(
      loc.openQuestion.blocksTarget !== undefined
        ? { ...base, blocksTarget: loc.openQuestion.blocksTarget }
        : base,
    );
  }

  return {
    generatedAt: now(),
    specCount: registry.specs.size,
    scopeKind: registry.scope.kind,
    specs,
    terms,
    openQuestions,
    consistency: {
      staleReferences: findStaleReferences(registry).length,
      termConflicts: findTermConflicts(registry).length,
      errorCodeCollisions: findErrorCodeCollisions(registry).length,
      duplicateRules: findDuplicateRules(registry).length,
      cycles: hasCycles(registry),
    },
  };
}

export function generateConstraintDocument(
  registry: CorpusRegistry,
  targetSpecId: string,
): ConstraintDocument {
  const target = findSpec(registry, targetSpecId);
  const targetTitle = target?.title ?? "";
  const rules = listRules(registry, targetSpecId);
  const coverage = checkCoverage(registry, targetSpecId);
  // Collect defined terms + exported concepts from the target spec sections.
  const definedTerms: { term: string; definition: string }[] = [];
  const exportedConcepts: { name: string; description: string }[] = [];
  if (target !== undefined) {
    type SectionLike = (typeof target)["sections"][number];
    const walk = (sections: readonly SectionLike[]): void => {
      for (const s of sections) {
        if (s.termDefinitions !== undefined) {
          for (const t of s.termDefinitions) definedTerms.push(t);
        }
        if (s.conceptExports !== undefined) {
          for (const c of s.conceptExports) exportedConcepts.push(c);
        }
        if (s.subsections !== undefined) walk(s.subsections);
      }
    };
    walk(target.sections);
  }
  const openQuestions = target?.openQuestions ?? [];
  return {
    targetSpecId,
    targetTitle,
    scopeKind: registry.scope.kind,
    upstreamDependencies: listDependencies(registry, targetSpecId),
    downstreamDependents: listDependents(registry, targetSpecId),
    exportedConcepts,
    definedTerms,
    openQuestions,
    ruleCount: rules.length,
    coverageStatus: coverage,
  };
}

export function generateTaskContext(
  registry: CorpusRegistry,
  query: TaskContextQuery,
): TaskContext {
  // SS-QP-007: require at least one of specIds / rulePattern / termPattern.
  if (
    (query.specIds === undefined || query.specIds.length === 0) &&
    (query.rulePattern === undefined || query.rulePattern.length === 0) &&
    (query.termPattern === undefined || query.termPattern.length === 0)
  ) {
    throw new Error(
      "generateTaskContext: at least one of specIds, rulePattern, or termPattern is required",
    );
  }

  const rulePat = query.rulePattern?.toLowerCase();
  const termPat = query.termPattern?.toLowerCase();
  const namedSpecs = new Set(query.specIds ?? []);

  const matchingRules: RuleLocation[] = [];
  for (const loc of registry.ruleIndex.values()) {
    if (rulePat !== undefined && loc.rule.text.toLowerCase().includes(rulePat)) {
      matchingRules.push(loc);
    }
  }

  const matchingTerms: TermLocation[] = [];
  for (const loc of registry.termIndex.values()) {
    if (termPat !== undefined && loc.definition.term.toLowerCase().includes(termPat)) {
      matchingTerms.push(loc);
    }
  }

  // Relevant specs: named + those contributing to matchingRules/Terms + when
  // includeRelated, specs reached via relationship edges from named specs.
  const relevantIds = new Set<string>(namedSpecs);
  for (const r of matchingRules) relevantIds.add(r.specId);
  for (const t of matchingTerms) relevantIds.add(t.specId);
  if (query.includeRelated === true) {
    for (const id of [...namedSpecs]) {
      for (const edge of registry.edges) {
        if (edge.source === id && registry.specs.has(edge.target)) relevantIds.add(edge.target);
        if (edge.target === id && registry.specs.has(edge.source)) relevantIds.add(edge.source);
      }
    }
  }

  const pack = generateDiscoveryPack(registry);
  const relevantSpecs = pack.specs.filter((s) => relevantIds.has(s.id));

  const relatedOpenQuestions: OpenQuestionLocation[] = [];
  for (const loc of listOpenQuestions(registry)) {
    if (relevantIds.has(loc.specId)) relatedOpenQuestions.push(loc);
  }

  const bundle = {
    relevantSpecs,
    matchingRules,
    matchingTerms,
    relatedOpenQuestions,
  };
  return {
    scopeKind: registry.scope.kind,
    ...bundle,
    tokenEstimate: estimateTokens(bundle),
  };
}

// Unused import warning avoidance for listTerms in the barrel. Re-exported
// so consumers importing from this file alone still have it.
export { listTerms };
