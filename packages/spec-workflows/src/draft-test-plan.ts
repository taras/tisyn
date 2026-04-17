// §10.2 draftTestPlan workflow — acquire (full or caller-filtered) + assemble.

import {
  acquireCorpusRegistry,
  assembleTestPlanContext,
  type Operation,
  type TestPlanContext,
} from "@tisyn/spec";

export function* draftTestPlan(input: {
  readonly targetSpec: string;
  readonly specIds?: readonly string[];
}): Operation<TestPlanContext> {
  const scope =
    input.specIds !== undefined
      ? { specIds: [input.targetSpec, ...input.specIds] }
      : undefined;
  const registry = yield* acquireCorpusRegistry(scope);
  return assembleTestPlanContext(registry, { targetSpec: input.targetSpec });
}
