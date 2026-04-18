// §9.2 AuthoringContext assembly. Pure composition over query primitives;
// no I/O (CA1) and no mutation (CA2).

import type { AuthoringContext, CorpusRegistry } from "../types.ts";
import { findSpec } from "../queries/lookup.ts";
import { listOpenQuestions, listRules, listTerms } from "../queries/listing.ts";
import { generateConstraintDocument, generateDiscoveryPack } from "../queries/projection.ts";

function estimateTokens(payload: unknown): number {
  const text = JSON.stringify(payload) ?? "";
  return Math.ceil(text.length / 4);
}

export function assembleAuthoringContext(
  registry: CorpusRegistry,
  opts: { readonly targetSpec?: string; readonly topic?: string },
): AuthoringContext {
  const pack = generateDiscoveryPack(registry);
  const target = opts.targetSpec !== undefined ? findSpec(registry, opts.targetSpec) : undefined;
  const rules = opts.targetSpec !== undefined ? listRules(registry, opts.targetSpec) : [];
  const terms = listTerms(registry);
  const openQuestions = listOpenQuestions(registry, { status: "open" });
  const constraints =
    target !== undefined ? generateConstraintDocument(registry, target.id) : undefined;

  const bundle = {
    task: "authoring" as const,
    scopeKind: registry.scope.kind,
    relevantSpecs: pack.specs,
    rules,
    terms,
    openQuestions,
  };
  return {
    ...bundle,
    ...(opts.targetSpec !== undefined ? { targetSpec: opts.targetSpec } : {}),
    ...(opts.topic !== undefined ? { topic: opts.topic } : {}),
    ...(constraints !== undefined ? { constraints } : {}),
    tokenEstimate: estimateTokens({ ...bundle, constraints }),
  };
}
