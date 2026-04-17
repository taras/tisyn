// §9.4 ReviewContext assembly.

import type { CorpusRegistry, ReviewContext, TermLocation } from "../types.ts";
import {
  checkCoverage,
  findErrorCodeCollisions,
  findStaleReferences,
  findTermConflicts,
  isReady,
} from "../queries/analysis.ts";
import { listDependencies, listDependents } from "../queries/listing.ts";

export function assembleReviewContext(
  registry: CorpusRegistry,
  opts: { readonly targetSpec: string },
): ReviewContext {
  const spec = registry.specs.get(opts.targetSpec);
  const terms: TermLocation[] = [];
  if (spec !== undefined) {
    const walk = (sections: readonly (typeof spec.sections)[number][]): void => {
      for (const s of sections) {
        if (s.termDefinitions !== undefined) {
          for (const definition of s.termDefinitions) {
            terms.push({ specId: spec.id, sectionId: s.id, definition });
          }
        }
        if (s.subsections !== undefined) walk(s.subsections);
      }
    };
    walk(spec.sections);
  }
  return {
    task: "review",
    scopeKind: registry.scope.kind,
    targetSpec: opts.targetSpec,
    dependencies: listDependencies(registry, opts.targetSpec),
    dependents: listDependents(registry, opts.targetSpec),
    terms,
    corpusTermConflicts: findTermConflicts(registry),
    staleReferences: findStaleReferences(registry),
    coverage: checkCoverage(registry, opts.targetSpec),
    readiness: isReady(registry, opts.targetSpec),
    errorCodeConflicts: findErrorCodeCollisions(registry),
  };
}
