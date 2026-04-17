// §9.3 AmendmentContext assembly. Pure over the passed registry.

import type { AmendmentContext, CorpusRegistry } from "../types.ts";
import { checkCoverage } from "../queries/analysis.ts";
import { listDependencies, listDependents, listOpenQuestions } from "../queries/listing.ts";
import { generateConstraintDocument } from "../queries/projection.ts";
import { impactOf } from "../queries/relationship.ts";

export function assembleAmendmentContext(
  registry: CorpusRegistry,
  opts: { readonly targetSpec: string; readonly targetSection?: string | number },
): AmendmentContext {
  const constraints = generateConstraintDocument(registry, opts.targetSpec);
  const impact = impactOf(registry, opts.targetSpec, opts.targetSection);
  const dependencies = listDependencies(registry, opts.targetSpec);
  const dependents = listDependents(registry, opts.targetSpec);
  const currentCoverage = checkCoverage(registry, opts.targetSpec);
  const blockingQuestions = listOpenQuestions(registry, {
    status: "open",
    blocksTarget: opts.targetSpec,
  });

  const base = {
    task: "amendment" as const,
    scopeKind: registry.scope.kind,
    targetSpec: opts.targetSpec,
    constraints,
    impact,
    dependencies,
    dependents,
    currentCoverage,
    blockingQuestions,
  };
  return opts.targetSection !== undefined
    ? { ...base, targetSection: opts.targetSection }
    : base;
}
