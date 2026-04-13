// buildRegistry + internal R9–R12 graph structures per §7 of
// spec-system-specification.source.md. Public surface is the SpecRegistry
// interface (R3–R8). R9–R12 are internal module-private state, exposed to
// validate.ts through a same-package import — never attached to SpecRegistry
// and never re-exported from src/index.ts (R14).

import { Strength } from "./enums.ts";
import type {
  ConceptLocation,
  ErrorCodeLocation,
  NormalizedSpecModule,
  NormalizedTestPlanModule,
  RuleLocation,
  SpecRegistry,
} from "./types.ts";

// R9–R12 plus collision bookkeeping — internal structures, keyed by registry
// identity so a single buildRegistry call's graphs never leak into another
// call's validation. V1-3..V1-6 need the raw duplicate lists because
// buildRegistry itself runs no validation and overwrites colliding keys.
export interface InternalGraphs {
  readonly dependencyGraph: ReadonlyMap<string, readonly string[]>;
  readonly reverseDependencyGraph: ReadonlyMap<string, readonly string[]>;
  readonly amendmentChain: ReadonlyMap<string, readonly string[]>;
  readonly specToTestPlans: ReadonlyMap<string, readonly string[]>;
  readonly duplicateSpecIds: readonly string[];
  readonly duplicateTestPlanIds: readonly string[];
  readonly duplicateRuleIds: readonly string[];
  readonly duplicateErrorCodes: readonly string[];
}

const internalGraphsByRegistry = new WeakMap<SpecRegistry, InternalGraphs>();

export function getInternalGraphs(registry: SpecRegistry): InternalGraphs {
  const graphs = internalGraphsByRegistry.get(registry);
  if (graphs === undefined) {
    throw new Error(
      "InternalGraphs not registered for this SpecRegistry — registry was not created by buildRegistry().",
    );
  }
  return graphs;
}

export function buildRegistry(
  specs: readonly NormalizedSpecModule[],
  testPlans: readonly NormalizedTestPlanModule[],
): SpecRegistry {
  // Seed the spec / test-plan maps. Duplicates are retained here — collision
  // detection is V1 / V2's job, not buildRegistry's. Duplicate IDs are
  // recorded in InternalGraphs for validate.ts to read.
  const specMap = new Map<string, NormalizedSpecModule>();
  const duplicateSpecIds: string[] = [];
  for (const spec of specs) {
    if (specMap.has(spec.id)) duplicateSpecIds.push(spec.id);
    else specMap.set(spec.id, spec);
  }

  const testPlanMap = new Map<string, NormalizedTestPlanModule>();
  const duplicateTestPlanIds: string[] = [];
  for (const plan of testPlans) {
    if (testPlanMap.has(plan.id)) duplicateTestPlanIds.push(plan.id);
    else testPlanMap.set(plan.id, plan);
  }

  // R5 — rule index covers both rules and invariants (SS-REG-006).
  // Invariants carry no authored Strength; D22 treats them as always
  // normative, so they index with Strength.MUST.
  const ruleIndex = new Map<string, RuleLocation>();
  const duplicateRuleIds: string[] = [];
  for (const spec of specs) {
    for (const rule of spec.rules) {
      if (ruleIndex.has(rule.id)) duplicateRuleIds.push(rule.id);
      else
        ruleIndex.set(rule.id, {
          specId: spec.id,
          section: rule.section,
          strength: rule.strength,
        });
    }
    for (const inv of spec.invariants) {
      if (ruleIndex.has(inv.id)) duplicateRuleIds.push(inv.id);
      else
        ruleIndex.set(inv.id, {
          specId: spec.id,
          section: inv.section,
          strength: Strength.MUST,
        });
    }
  }

  // R6 — error code index
  const errorCodeIndex = new Map<string, ErrorCodeLocation>();
  const duplicateErrorCodes: string[] = [];
  for (const spec of specs) {
    for (const ec of spec.errorCodes) {
      if (errorCodeIndex.has(ec.code)) duplicateErrorCodes.push(ec.code);
      else
        errorCodeIndex.set(ec.code, {
          specId: spec.id,
          section: ec.section,
          trigger: ec.trigger,
        });
    }
  }

  // R8 — concept index
  const conceptIndex = new Map<string, ConceptLocation>();
  for (const spec of specs) {
    for (const concept of spec.concepts) {
      conceptIndex.set(concept.name, {
        specId: spec.id,
        section: concept.section,
        description: concept.description,
      });
    }
  }

  // R7 — term authority
  const termAuthority = new Map<string, string>();
  for (const spec of specs) {
    for (const term of spec.terms) {
      termAuthority.set(term.term, spec.id);
    }
  }

  // R9 — dependency graph
  const dependencyGraph = new Map<string, readonly string[]>();
  for (const spec of specs) {
    dependencyGraph.set(
      spec.id,
      spec.dependsOn.map((ref) => ref.specId),
    );
  }

  // R10 — reverse dependency graph
  const reverseDependencyGraph = new Map<string, string[]>();
  for (const [from, targets] of dependencyGraph.entries()) {
    for (const to of targets) {
      const list = reverseDependencyGraph.get(to) ?? [];
      list.push(from);
      reverseDependencyGraph.set(to, list);
    }
  }

  // R11 — amendment chain map
  const amendmentChain = new Map<string, readonly string[]>();
  for (const spec of specs) {
    amendmentChain.set(
      spec.id,
      spec.amends.map((ref) => ref.specId),
    );
  }

  // R12 — spec-to-test-plan pairing. A spec may in theory be paired with
  // more than one test plan (V2 does not forbid it), so this is a multi-map;
  // callers that assume a single companion use the first entry.
  const specToTestPlansMut = new Map<string, string[]>();
  for (const plan of testPlans) {
    const list = specToTestPlansMut.get(plan.testsSpec.specId) ?? [];
    list.push(plan.id);
    specToTestPlansMut.set(plan.testsSpec.specId, list);
  }
  const specToTestPlans = new Map<string, readonly string[]>(
    specToTestPlansMut,
  );

  const registry: SpecRegistry = {
    specs: specMap,
    testPlans: testPlanMap,
    ruleIndex,
    errorCodeIndex,
    termAuthority,
    conceptIndex,
  };

  const graphs: InternalGraphs = {
    dependencyGraph,
    reverseDependencyGraph,
    amendmentChain,
    specToTestPlans,
    duplicateSpecIds,
    duplicateTestPlanIds,
    duplicateRuleIds,
    duplicateErrorCodes,
  };
  internalGraphsByRegistry.set(registry, graphs);

  return registry;
}
