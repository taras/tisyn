// §8.3 Lookup queries. Pure, no-throw — misses return `undefined`.

import type {
  CorpusRegistry,
  ErrorCodeLocation,
  NormalizedSpecModule,
  OpenQuestionLocation,
  RuleLocation,
  TermLocation,
  TestCaseLocation,
} from "../types.ts";

export function findSpec(
  registry: CorpusRegistry,
  specId: string,
): NormalizedSpecModule | undefined {
  return registry.specs.get(specId);
}

export function findRule(registry: CorpusRegistry, ruleId: string): RuleLocation | undefined {
  return registry.ruleIndex.get(ruleId);
}

// Exact match, case-sensitive (SS-QL-023 / §8.3).
export function findTerm(registry: CorpusRegistry, term: string): TermLocation | undefined {
  return registry.termIndex.get(term);
}

export function findTestCase(
  registry: CorpusRegistry,
  testId: string,
): TestCaseLocation | undefined {
  for (const plan of registry.plans.values()) {
    for (const category of plan.categories) {
      for (const tc of category.cases) {
        if (tc.id === testId) {
          return { planId: plan.id, categoryId: category.id, testCase: tc };
        }
      }
    }
  }
  return undefined;
}

export function findErrorCode(
  registry: CorpusRegistry,
  code: string,
): ErrorCodeLocation | undefined {
  return registry.errorCodeIndex.get(code);
}

export function findOpenQuestion(
  registry: CorpusRegistry,
  oqId: string,
): OpenQuestionLocation | undefined {
  return registry.openQuestionIndex.get(oqId);
}
