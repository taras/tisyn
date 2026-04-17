// §9.6 ConsistencyContext assembly.

import type {
  ConsistencyContext,
  ConsistencySummaryCoverage,
  ConsistencySummaryReadiness,
  CorpusRegistry,
} from "../types.ts";
import {
  checkCoverage,
  findDuplicateRules,
  findErrorCodeCollisions,
  findStaleReferences,
  findTermConflicts,
  isReady,
} from "../queries/analysis.ts";
import { hasCycles } from "../queries/relationship.ts";

export function assembleConsistencyContext(registry: CorpusRegistry): ConsistencyContext {
  const coverageSummary: ConsistencySummaryCoverage[] = [];
  const readinessSummary: ConsistencySummaryReadiness[] = [];
  for (const specId of registry.dependencyOrder) {
    const cov = checkCoverage(registry, specId);
    coverageSummary.push({
      specId,
      total: cov.stats.total,
      covered: cov.stats.covered,
      uncovered: cov.stats.uncovered,
      deferred: cov.stats.deferred,
    });
    const r = isReady(registry, specId);
    readinessSummary.push({ specId, ready: r.ready, blocking: r.blocking });
  }

  const scope =
    registry.scope.kind === "full" ? "full" : `filtered:${[...registry.scope.specIds].join(",")}`;

  return {
    task: "consistency",
    scopeKind: registry.scope.kind,
    scope,
    staleReferences: findStaleReferences(registry),
    termConflicts: findTermConflicts(registry),
    errorCodeCollisions: findErrorCodeCollisions(registry),
    duplicateRules: findDuplicateRules(registry),
    cycles: hasCycles(registry),
    coverageSummary,
    readinessSummary,
  };
}
