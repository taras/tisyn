// §9.5 TestPlanContext assembly.

import type { CorpusRegistry, RuleLocation, TestPlanContext } from "../types.ts";
import { checkCoverage } from "../queries/analysis.ts";
import { listOpenQuestions, listRules } from "../queries/listing.ts";

export function assembleTestPlanContext(
  registry: CorpusRegistry,
  opts: { readonly targetSpec: string },
): TestPlanContext {
  const rules = listRules(registry, opts.targetSpec);
  const mustRules: RuleLocation[] = [];
  const shouldRules: RuleLocation[] = [];
  const mayRules: RuleLocation[] = [];
  for (const loc of rules) {
    const level = loc.rule.level;
    if (level === "must" || level === "must-not") {
      mustRules.push(loc);
    } else if (level === "should" || level === "should-not") {
      shouldRules.push(loc);
    } else {
      mayRules.push(loc);
    }
  }

  const siblingPlanIds: string[] = [];
  for (const plan of registry.plans.values()) {
    if (plan.validatesSpec === opts.targetSpec) {
      siblingPlanIds.push(plan.id);
    }
  }

  const openQuestions = listOpenQuestions(registry).filter((loc) => loc.specId === opts.targetSpec);

  return {
    task: "test-plan",
    scopeKind: registry.scope.kind,
    targetSpec: opts.targetSpec,
    mustRules,
    shouldRules,
    mayRules,
    totalRuleCount: rules.length,
    existingCoverage: checkCoverage(registry, opts.targetSpec),
    siblingPlanIds,
    openQuestions,
  };
}
