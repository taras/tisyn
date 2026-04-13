// validateCorpus + per-V-rule helpers per §8 of
// spec-system-specification.source.md. Per-rule helpers are module-local —
// test files import them via same-package relative imports, but they are
// not re-exported from src/index.ts.

import { Resolution, Status, Tier } from "./enums.ts";
import { getInternalGraphs } from "./registry.ts";
import type { InternalGraphs } from "./registry.ts";
import type {
  CoverageReport,
  NormalizedSpecModule,
  SpecRegistry,
  SpecSection,
  ValidationError,
  ValidationReport,
} from "./types.ts";

interface GroupResult {
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationError[];
}

function err(
  group: string,
  check: string,
  message: string,
  extras?: Partial<Pick<ValidationError, "specId" | "testPlanId" | "ruleId" | "sectionId">>,
): ValidationError {
  return { group, check, message, ...extras };
}

function collectAllSectionIds(
  sections: readonly SpecSection[],
  out: Set<string>,
): void {
  for (const s of sections) {
    out.add(s.id);
    collectAllSectionIds(s.subsections, out);
  }
}

function collectSectionIdsOf(spec: NormalizedSpecModule): Set<string> {
  const set = new Set<string>();
  collectAllSectionIds(spec.sections, set);
  return set;
}

// ── V1 — Identity and Uniqueness ──

export function validateV1_Identity(
  registry: SpecRegistry,
  graphs: InternalGraphs,
): GroupResult {
  const errors: ValidationError[] = [];

  for (const [id, spec] of registry.specs) {
    if (id.length === 0 || spec.id.length === 0) {
      errors.push(
        err("V1", "V1-1", "Spec id MUST be non-empty", { specId: id }),
      );
    }
  }

  for (const [id, plan] of registry.testPlans) {
    if (id.length === 0 || plan.id.length === 0) {
      errors.push(
        err("V1", "V1-2", "Test plan id MUST be non-empty", { testPlanId: id }),
      );
    }
  }

  for (const dup of graphs.duplicateSpecIds) {
    errors.push(
      err("V1", "V1-3", `Duplicate spec id "${dup}"`, { specId: dup }),
    );
  }
  for (const dup of graphs.duplicateTestPlanIds) {
    errors.push(
      err("V1", "V1-4", `Duplicate test plan id "${dup}"`, { testPlanId: dup }),
    );
  }
  for (const dup of graphs.duplicateRuleIds) {
    errors.push(
      err("V1", "V1-5", `Duplicate rule id "${dup}" across corpus`, {
        ruleId: dup,
      }),
    );
  }
  for (const dup of graphs.duplicateErrorCodes) {
    errors.push(
      err("V1", "V1-6", `Duplicate error code "${dup}" across corpus`),
    );
  }

  return { errors, warnings: [] };
}

// ── V2 — Spec/Test-Plan Linkage ──

export function validateV2_Linkage(registry: SpecRegistry): GroupResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Collect test plans seen per target spec for V2-3
  const plansPerSpec = new Map<string, string[]>();

  for (const [planId, plan] of registry.testPlans) {
    const targetId = plan.testsSpec.specId;
    const target = registry.specs.get(targetId);
    if (target === undefined) {
      errors.push(
        err(
          "V2",
          "V2-1",
          `Test plan "${planId}" references nonexistent spec "${targetId}"`,
          { testPlanId: planId, specId: targetId },
        ),
      );
      continue;
    }
    if (
      plan.testsSpec.version !== undefined &&
      plan.testsSpec.version !== target.version
    ) {
      warnings.push(
        err(
          "V2",
          "V2-2",
          `Test plan "${planId}" testsSpec.version "${plan.testsSpec.version}" does not match spec "${targetId}" version "${target.version}"`,
          { testPlanId: planId, specId: targetId },
        ),
      );
    }
    const list = plansPerSpec.get(targetId) ?? [];
    list.push(planId);
    plansPerSpec.set(targetId, list);
  }

  for (const [specId, spec] of registry.specs) {
    if (spec.status !== Status.Active) {continue;}
    if ((plansPerSpec.get(specId) ?? []).length === 0) {
      warnings.push(
        err(
          "V2",
          "V2-3",
          `Active spec "${specId}" has no companion test plan`,
          { specId },
        ),
      );
    }
  }

  return { errors, warnings };
}

// ── V3 — Rule Coverage (corpus-wide) ──

export function validateV3_Coverage(registry: SpecRegistry): GroupResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const [planId, plan] of registry.testPlans) {
    const target = registry.specs.get(plan.testsSpec.specId);
    if (target === undefined) {continue;} // V2 already flagged

    const ruleIdsInTarget = new Set<string>();
    for (const r of target.rules) {ruleIdsInTarget.add(r.id);}
    for (const i of target.invariants) {ruleIdsInTarget.add(i.id);}

    const testIdsInPlan = new Set<string>();
    let actualCore = 0;
    let actualExtended = 0;
    for (const cat of plan.categories) {
      for (const tc of cat.tests) {
        testIdsInPlan.add(tc.id);
        if (tc.tier === Tier.Core) {actualCore++;}
        else if (tc.tier === Tier.Extended) {actualExtended++;}
        // V3-3 — every rule id in a TestCase.rules must exist in the corpus ruleIndex
        for (const ruleId of tc.rules) {
          if (!registry.ruleIndex.has(ruleId)) {
            errors.push(
              err(
                "V3",
                "V3-3",
                `TestCase "${tc.id}" in plan "${planId}" references nonexistent rule "${ruleId}"`,
                { testPlanId: planId, ruleId },
              ),
            );
          }
        }
      }
    }

    // V3-1, V3-2 — coverage-matrix references
    const coveredRuleIds = new Set<string>();
    const coredCovered = new Set<string>();
    for (const entry of plan.coverageMatrix) {
      if (!ruleIdsInTarget.has(entry.ruleId)) {
        errors.push(
          err(
            "V3",
            "V3-1",
            `Coverage entry references rule "${entry.ruleId}" which is not declared in spec "${target.id}"`,
            { testPlanId: planId, specId: target.id, ruleId: entry.ruleId },
          ),
        );
      } else {
        coveredRuleIds.add(entry.ruleId);
      }
      for (const testId of entry.testIds) {
        if (!testIdsInPlan.has(testId)) {
          errors.push(
            err(
              "V3",
              "V3-2",
              `Coverage entry for rule "${entry.ruleId}" references test "${testId}" which is not in plan "${planId}"`,
              { testPlanId: planId, ruleId: entry.ruleId },
            ),
          );
        }
        // Track whether this rule is covered by at least one Core test.
        for (const cat of plan.categories) {
          for (const tc of cat.tests) {
            if (tc.id === testId && tc.tier === Tier.Core) {
              coredCovered.add(entry.ruleId);
            }
          }
        }
      }
    }

    // V3-4 — every normative rule should be covered
    for (const rid of ruleIdsInTarget) {
      if (!coveredRuleIds.has(rid)) {
        warnings.push(
          err(
            "V3",
            "V3-4",
            `Rule "${rid}" in spec "${target.id}" has no coverage entry in plan "${planId}"`,
            { testPlanId: planId, specId: target.id, ruleId: rid },
          ),
        );
      }
    }

    // V3-5 — every normative rule should have at least one Core test
    for (const rid of ruleIdsInTarget) {
      if (!coredCovered.has(rid)) {
        warnings.push(
          err(
            "V3",
            "V3-5",
            `Rule "${rid}" in spec "${target.id}" has no Tier.Core test coverage`,
            { testPlanId: planId, specId: target.id, ruleId: rid },
          ),
        );
      }
    }

    // V3-6 — tier counts should match actuals
    if (plan.coreTier !== actualCore) {
      warnings.push(
        err(
          "V3",
          "V3-6",
          `Plan "${planId}" coreTier=${plan.coreTier} but actual Core count=${actualCore}`,
          { testPlanId: planId },
        ),
      );
    }
    if (plan.extendedTier !== actualExtended) {
      warnings.push(
        err(
          "V3",
          "V3-6",
          `Plan "${planId}" extendedTier=${plan.extendedTier} but actual Extended count=${actualExtended}`,
          { testPlanId: planId },
        ),
      );
    }
  }

  return { errors, warnings };
}

// ── V4 — Amendment Integrity ──

export function validateV4_Amendments(registry: SpecRegistry): GroupResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const [specId, spec] of registry.specs) {
    for (const ref of spec.amends) {
      const target = registry.specs.get(ref.specId);
      if (target === undefined) {
        errors.push(
          err(
            "V4",
            "V4-1",
            `Spec "${specId}" amends nonexistent spec "${ref.specId}"`,
            { specId },
          ),
        );
        continue;
      }
      if (ref.sections !== undefined) {
        const targetSectionIds = collectSectionIdsOf(target);
        for (const sid of ref.sections) {
          if (!targetSectionIds.has(sid)) {
            errors.push(
              err(
                "V4",
                "V4-2",
                `Spec "${specId}" amends target "${ref.specId}" section "${sid}" which does not exist`,
                { specId, sectionId: sid },
              ),
            );
          }
        }
      }
    }
    if (spec.amends.length > 0 && spec.amendment === undefined) {
      warnings.push(
        err(
          "V4",
          "V4-3",
          `Spec "${specId}" has amends but no amendment detail`,
          { specId },
        ),
      );
    }
  }

  return { errors, warnings };
}

// ── V5 — Changed/Unchanged Section Integrity ──

export function validateV5_ChangedUnchanged(
  registry: SpecRegistry,
): GroupResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const [specId, spec] of registry.specs) {
    const detail = spec.amendment;
    if (detail === undefined) {continue;}

    // Group changes by target spec for V5-4 inventory completeness
    const sectionsByTarget = new Map<
      string,
      { changed: Set<string>; unchanged: Set<string> }
    >();
    function bucket(target: string) {
      const existing = sectionsByTarget.get(target);
      if (existing !== undefined) {return existing;}
      const fresh = { changed: new Set<string>(), unchanged: new Set<string>() };
      sectionsByTarget.set(target, fresh);
      return fresh;
    }

    for (const change of detail.changedSections) {
      bucket(change.targetSpec).changed.add(change.section);
      const target = registry.specs.get(change.targetSpec);
      if (target !== undefined) {
        const ids = collectSectionIdsOf(target);
        if (!ids.has(change.section)) {
          errors.push(
            err(
              "V5",
              "V5-1",
              `Spec "${specId}" changedSection "${change.section}" does not exist in target spec "${change.targetSpec}"`,
              { specId, sectionId: change.section },
            ),
          );
        }
      }
    }

    for (const preserve of detail.unchangedSections) {
      bucket(preserve.targetSpec).unchanged.add(preserve.section);
      const target = registry.specs.get(preserve.targetSpec);
      if (target !== undefined) {
        const ids = collectSectionIdsOf(target);
        if (!ids.has(preserve.section)) {
          errors.push(
            err(
              "V5",
              "V5-2",
              `Spec "${specId}" unchangedSection "${preserve.section}" does not exist in target spec "${preserve.targetSpec}"`,
              { specId, sectionId: preserve.section },
            ),
          );
        }
      }
    }

    // V5-3 — no section in both
    for (const [, lists] of sectionsByTarget) {
      for (const sid of lists.changed) {
        if (lists.unchanged.has(sid)) {
          errors.push(
            err(
              "V5",
              "V5-3",
              `Spec "${specId}" lists section "${sid}" as both changed and unchanged`,
              { specId, sectionId: sid },
            ),
          );
        }
      }
    }

    // V5-4 — union should cover all sections of target
    for (const [targetId, lists] of sectionsByTarget) {
      const target = registry.specs.get(targetId);
      if (target === undefined) {continue;}
      const allSections = collectSectionIdsOf(target);
      for (const sid of allSections) {
        if (!lists.changed.has(sid) && !lists.unchanged.has(sid)) {
          warnings.push(
            err(
              "V5",
              "V5-4",
              `Amendment from "${specId}" to "${targetId}" does not account for section "${sid}"`,
              { specId, sectionId: sid },
            ),
          );
        }
      }
    }
  }

  return { errors, warnings };
}

// ── V6 — Dependency and Reference Integrity ──

function hasCycle(graph: ReadonlyMap<string, readonly string[]>): boolean {
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(node: string): boolean {
    if (stack.has(node)) {return true;}
    if (visited.has(node)) {return false;}
    visited.add(node);
    stack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (dfs(next)) {return true;}
    }
    stack.delete(node);
    return false;
  }
  for (const node of graph.keys()) {
    if (dfs(node)) {return true;}
  }
  return false;
}

export function validateV6_Graphs(
  registry: SpecRegistry,
  graphs: InternalGraphs,
): GroupResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const [specId, spec] of registry.specs) {
    for (const dep of spec.dependsOn) {
      if (!registry.specs.has(dep.specId)) {
        errors.push(
          err(
            "V6",
            "V6-1",
            `Spec "${specId}" depends on nonexistent spec "${dep.specId}"`,
            { specId },
          ),
        );
      } else if (registry.specs.get(dep.specId)!.status === Status.Superseded) {
        warnings.push(
          err(
            "V6",
            "V6-5",
            `Spec "${specId}" depends on superseded spec "${dep.specId}"`,
            { specId },
          ),
        );
      }
    }
    for (const comp of spec.complements) {
      if (!registry.specs.has(comp.specId)) {
        errors.push(
          err(
            "V6",
            "V6-2",
            `Spec "${specId}" complements nonexistent spec "${comp.specId}"`,
            { specId },
          ),
        );
      }
    }
  }

  if (hasCycle(graphs.dependencyGraph)) {
    errors.push(err("V6", "V6-3", "Dependency graph contains a cycle"));
  }
  if (hasCycle(graphs.amendmentChain)) {
    errors.push(err("V6", "V6-4", "Amendment graph contains a cycle"));
  }

  return { errors, warnings };
}

// ── V7 — Term Authority and Concept Conflicts ──

export function validateV7_Terms(registry: SpecRegistry): GroupResult {
  const warnings: ValidationError[] = [];

  // V7-1 — duplicate term definitions. termAuthority has already dropped
  // duplicates (last-write-wins), so recompute from specs to detect them.
  const termToSpecs = new Map<string, Set<string>>();
  for (const [specId, spec] of registry.specs) {
    for (const term of spec.terms) {
      const set = termToSpecs.get(term.term) ?? new Set();
      set.add(specId);
      termToSpecs.set(term.term, set);
    }
  }
  for (const [term, defs] of termToSpecs) {
    if (defs.size > 1) {
      warnings.push(
        err(
          "V7",
          "V7-1",
          `Term "${term}" is defined by multiple specs: ${Array.from(defs).join(", ")}`,
        ),
      );
    }
  }

  // V7-2 — conflicting concept exports (same name, different description)
  const conceptByName = new Map<
    string,
    { specId: string; description: string }
  >();
  for (const [specId, spec] of registry.specs) {
    for (const concept of spec.concepts) {
      const prior = conceptByName.get(concept.name);
      if (prior === undefined) {
        conceptByName.set(concept.name, {
          specId,
          description: concept.description,
        });
      } else if (prior.description !== concept.description) {
        warnings.push(
          err(
            "V7",
            "V7-2",
            `Concept "${concept.name}" exported by "${prior.specId}" and "${specId}" with conflicting descriptions`,
          ),
        );
      }
    }
  }

  return { errors: [], warnings };
}

// ── V8 — Stale References ──

export function validateV8_Stale(registry: SpecRegistry): GroupResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const [planId, plan] of registry.testPlans) {
    const target = registry.specs.get(plan.testsSpec.specId);
    // V8-1 — every rule id referenced in TestCase.rules must exist in
    // corpus ruleIndex. (V3-3 covers the same ground but keys the error off
    // the plan/testcase context; V8-1 exists to catch removed rules.)
    for (const cat of plan.categories) {
      for (const tc of cat.tests) {
        for (const rid of tc.rules) {
          if (!registry.ruleIndex.has(rid)) {
            errors.push(
              err(
                "V8",
                "V8-1",
                `TestCase "${tc.id}" in plan "${planId}" references removed rule "${rid}"`,
                { testPlanId: planId, ruleId: rid },
              ),
            );
          }
        }
      }
    }
    // V8-2 — ambiguity section references should resolve
    if (target !== undefined) {
      const targetSections = collectSectionIdsOf(target);
      for (const amb of plan.ambiguitySurface) {
        if (!targetSections.has(amb.specSection)) {
          warnings.push(
            err(
              "V8",
              "V8-2",
              `Ambiguity "${amb.id}" in plan "${planId}" references section "${amb.specSection}" not found in spec "${target.id}"`,
              { testPlanId: planId, specId: target.id, sectionId: amb.specSection },
            ),
          );
        }
        // V8-3 — resolvedIn should be a recognizable version string.
        // "Recognizable" here = non-empty and loosely semver-shaped.
        if (
          amb.resolution === Resolution.Resolved &&
          amb.resolvedIn !== undefined &&
          !/^\d+\.\d+(\.\d+)?/.test(amb.resolvedIn)
        ) {
          warnings.push(
            err(
              "V8",
              "V8-3",
              `Ambiguity "${amb.id}" resolvedIn "${amb.resolvedIn}" is not a recognizable version string`,
              { testPlanId: planId },
            ),
          );
        }
      }
    }
  }

  return { errors, warnings };
}

// ── V9 — Error-Code Traceability Integrity ──

export function validateV9_ErrorCodes(registry: SpecRegistry): GroupResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const [specId, spec] of registry.specs) {
    const ruleIdsInSpec = new Set<string>();
    for (const r of spec.rules) {ruleIdsInSpec.add(r.id);}
    for (const i of spec.invariants) {ruleIdsInSpec.add(i.id);}

    for (const ec of spec.errorCodes) {
      // V9-1 — defensive re-check; structural validation already blocks this
      if (ec.trigger.length === 0) {
        warnings.push(
          err(
            "V9",
            "V9-1",
            `Error code "${ec.code}" in spec "${specId}" has empty trigger`,
            { specId },
          ),
        );
      }
      // V9-2 — defensive re-check
      if (ec.requiredContent !== undefined && ec.requiredContent.length === 0) {
        warnings.push(
          err(
            "V9",
            "V9-2",
            `Error code "${ec.code}" in spec "${specId}" has empty requiredContent`,
            { specId },
          ),
        );
      }
      // V9-3 — error code must not collide with a rule id in same spec
      if (ruleIdsInSpec.has(ec.code)) {
        errors.push(
          err(
            "V9",
            "V9-3",
            `Error code "${ec.code}" collides with a rule id in spec "${specId}"`,
            { specId },
          ),
        );
      }
    }
  }

  return { errors, warnings };
}

// ── Public entry point ──

// ── checkCoverage — D43, §11.3 ──

export function checkCoverage(
  registry: SpecRegistry,
  specId: string,
): CoverageReport {
  const spec = registry.specs.get(specId);
  if (spec === undefined) {
    return {
      specId,
      errors: [
        err("V3", "V3-0", `Spec "${specId}" not found in registry`, { specId }),
      ],
      warnings: [],
      uncoveredRules: [],
    };
  }

  // Find the companion plan(s) for this spec from internal graphs.
  const graphs = getInternalGraphs(registry);
  const companionPlanIds = graphs.specToTestPlans.get(specId) ?? [];

  // Filter V3 findings to those tied to this spec / its companion plan(s).
  const fullV3 = validateV3_Coverage(registry);
  const inScope = (e: ValidationError) =>
    e.specId === specId ||
    (e.testPlanId !== undefined && companionPlanIds.includes(e.testPlanId));
  const errors = fullV3.errors.filter(inScope);
  const warnings = fullV3.warnings.filter(inScope);

  // uncoveredRules — rules declared in this spec with zero Core test coverage
  // across its companion plan(s).
  const ruleIdsInSpec: string[] = [];
  for (const r of spec.rules) {ruleIdsInSpec.push(r.id);}
  for (const i of spec.invariants) {ruleIdsInSpec.push(i.id);}

  const coreCovered = new Set<string>();
  for (const planId of companionPlanIds) {
    const plan = registry.testPlans.get(planId);
    if (plan === undefined) {continue;}
    const coreTestIds = new Set<string>();
    for (const cat of plan.categories) {
      for (const tc of cat.tests) {
        if (tc.tier === Tier.Core) {coreTestIds.add(tc.id);}
      }
    }
    for (const entry of plan.coverageMatrix) {
      for (const testId of entry.testIds) {
        if (coreTestIds.has(testId)) {coreCovered.add(entry.ruleId);}
      }
    }
  }
  const uncoveredRules = ruleIdsInSpec.filter((r) => !coreCovered.has(r));

  return { specId, errors, warnings, uncoveredRules };
}

// ── isReady — V10, §11.3 ──

export function isReady(registry: SpecRegistry, specId: string): boolean {
  const spec = registry.specs.get(specId);
  if (spec === undefined) {return false;}
  // V10-1 — spec must be active
  if (spec.status !== Status.Active) {return false;}

  // V10-2 — at least one companion test plan exists and is active
  const graphs = getInternalGraphs(registry);
  const companionIds = graphs.specToTestPlans.get(specId) ?? [];
  if (companionIds.length === 0) {return false;}
  const companionPlans = companionIds
    .map((id) => registry.testPlans.get(id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
  if (companionPlans.length === 0) {return false;}
  if (!companionPlans.every((p) => p.status === Status.Active)) {return false;}

  // V10-3 — checkCoverage has zero errors
  if (checkCoverage(registry, specId).errors.length > 0) {return false;}

  // V10-4 — companion plans have zero unresolved ambiguities
  for (const plan of companionPlans) {
    for (const amb of plan.ambiguitySurface) {
      if (amb.resolution === Resolution.Unresolved) {return false;}
    }
  }

  return true;
}

export function validateCorpus(registry: SpecRegistry): ValidationReport {
  const graphs = getInternalGraphs(registry);
  const groups: readonly GroupResult[] = [
    validateV1_Identity(registry, graphs),
    validateV2_Linkage(registry),
    validateV3_Coverage(registry),
    validateV4_Amendments(registry),
    validateV5_ChangedUnchanged(registry),
    validateV6_Graphs(registry, graphs),
    validateV7_Terms(registry),
    validateV8_Stale(registry),
    validateV9_ErrorCodes(registry),
  ];
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  for (const g of groups) {
    errors.push(...g.errors);
    warnings.push(...g.warnings);
  }
  return { errors, warnings };
}
