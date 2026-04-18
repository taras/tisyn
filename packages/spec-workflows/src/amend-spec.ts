// §10.2 amendSpec workflow — non-circular filtered scope.
//
// If the caller supplies `specIds`, acquire exactly that filter (plus the
// target). Otherwise fall back to full scope; the assembly reads
// dependencies/dependents/impact from that full registry.

import {
  acquireCorpusRegistry,
  assembleAmendmentContext,
  type AmendmentContext,
  type Operation,
} from "@tisyn/spec";

export function* amendSpec(input: {
  readonly targetSpec: string;
  readonly targetSection?: string | number;
  readonly specIds?: readonly string[];
}): Operation<AmendmentContext> {
  const scope =
    input.specIds !== undefined ? { specIds: [input.targetSpec, ...input.specIds] } : undefined;
  const registry = yield* acquireCorpusRegistry(scope);
  return assembleAmendmentContext(registry, {
    targetSpec: input.targetSpec,
    targetSection: input.targetSection,
  });
}
