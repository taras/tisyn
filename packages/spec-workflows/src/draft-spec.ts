// §10.2 draftSpec workflow — acquire → assemble.
//
// `tsn run packages/spec-workflows/src/draft-spec.ts --targetSpec <id>`

import {
  acquireCorpusRegistry,
  assembleAuthoringContext,
  type AuthoringContext,
  type Operation,
} from "@tisyn/spec";

export function* draftSpec(input: {
  readonly topic?: string;
  readonly targetSpec?: string;
  readonly specIds?: readonly string[];
}): Operation<AuthoringContext> {
  const scope = input.specIds !== undefined ? { specIds: input.specIds } : undefined;
  const registry = yield* acquireCorpusRegistry(scope);
  return assembleAuthoringContext(registry, {
    targetSpec: input.targetSpec,
    topic: input.topic,
  });
}
