// §10.2 reviewSpec workflow — full-scope acquire + review assembly.

import {
  acquireCorpusRegistry,
  assembleReviewContext,
  type Operation,
  type ReviewContext,
} from "@tisyn/spec";

export function* reviewSpec(input: { readonly targetSpec: string }): Operation<ReviewContext> {
  const registry = yield* acquireCorpusRegistry();
  return assembleReviewContext(registry, { targetSpec: input.targetSpec });
}
