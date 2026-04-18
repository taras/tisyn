// §10.2 consistencyCheck workflow — full-scope acquire + consistency assembly.

import {
  acquireCorpusRegistry,
  assembleConsistencyContext,
  type ConsistencyContext,
  type Operation,
} from "@tisyn/spec";

export function* consistencyCheck(): Operation<ConsistencyContext> {
  const registry = yield* acquireCorpusRegistry();
  return assembleConsistencyContext(registry);
}
