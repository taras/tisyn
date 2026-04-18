// Test helper: normalize modules + buildRegistry. Throws on any normalization
// error so tests can be written as `const r = buildTestRegistry([...])`.

import { normalizeSpec, normalizeTestPlan } from "../normalize.ts";
import { buildRegistry } from "../registry.ts";
import type {
  CorpusRegistry,
  NormalizedSpecModule,
  NormalizedTestPlanModule,
  Scope,
  SpecModule,
  TestPlanModule,
} from "../types.ts";

export function buildTestRegistry(
  specs: readonly SpecModule[],
  plans: readonly TestPlanModule[] = [],
  scope: Scope = { kind: "full" },
): CorpusRegistry {
  const normalizedSpecs: NormalizedSpecModule[] = [];
  for (const s of specs) {
    const r = normalizeSpec(s);
    if (r.status === "error") {
      throw new Error(
        `buildTestRegistry: normalizeSpec failed for ${s.id}: ` +
          r.errors.map((e) => `${e.constraint} ${e.message}`).join("; "),
      );
    }
    normalizedSpecs.push(r.value);
  }
  const normalizedPlans: NormalizedTestPlanModule[] = [];
  for (const p of plans) {
    const r = normalizeTestPlan(p);
    if (r.status === "error") {
      throw new Error(
        `buildTestRegistry: normalizeTestPlan failed for ${p.id}: ` +
          r.errors.map((e) => `${e.constraint} ${e.message}`).join("; "),
      );
    }
    normalizedPlans.push(r.value);
  }
  return buildRegistry([...normalizedSpecs, ...normalizedPlans], scope);
}
