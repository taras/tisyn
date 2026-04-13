// Structural validation of authored modules per §6.3 (N7, N8) and
// §5 D1–D37 of spec-system-specification.source.md. These checks run before
// normalization computes any derived fields; if any returns a StructuralError,
// normalization must return an { ok: false } result and not emit an artifact.

import { Tier } from "./enums.ts";
import type { SpecModule, SpecSection, StructuralError, TestPlanModule } from "./types.ts";

function err(
  code: string,
  path: string,
  message: string,
  detail?: Readonly<Record<string, string | number>>,
): StructuralError {
  return detail != null ? { code, path, message, detail } : { code, path, message };
}

function collectSectionIds(
  sections: readonly SpecSection[],
  out: Set<string>,
  duplicates: Set<string>,
): void {
  for (const section of sections) {
    if (out.has(section.id)) {
      duplicates.add(section.id);
    } else {
      out.add(section.id);
    }
    collectSectionIds(section.subsections, out, duplicates);
  }
}

export function validateSpecStructural(module: SpecModule): readonly StructuralError[] {
  const errors: StructuralError[] = [];

  // D1
  if (module.id.length === 0) {
    errors.push(err("EMPTY_SPEC_ID", "id", "SpecModule.id MUST be non-empty"));
  }
  // D2
  if (module.version.length === 0) {
    errors.push(err("EMPTY_SPEC_VERSION", "version", "SpecModule.version MUST be non-empty"));
  }
  // D4
  if (module.sections.length === 0) {
    errors.push(
      err(
        "EMPTY_SECTIONS",
        "sections",
        "SpecModule.sections MUST contain at least one SpecSection",
      ),
    );
  }

  // D11 — section IDs unique within the module, including across nesting
  const sectionIds = new Set<string>();
  const duplicates = new Set<string>();
  collectSectionIds(module.sections, sectionIds, duplicates);
  for (const dup of duplicates) {
    errors.push(
      err(
        "DUPLICATE_SECTION_ID",
        `sections[${dup}]`,
        `Section id "${dup}" is declared more than once`,
        { sectionId: dup },
      ),
    );
  }

  // D13 — rules reference valid section ids; D15 — non-empty statement
  for (let i = 0; i < module.rules.length; i++) {
    const rule = module.rules[i]!;
    if (!sectionIds.has(rule.section)) {
      errors.push(
        err(
          "MISSING_SECTION_REF",
          `rules[${i}].section`,
          `Rule "${rule.id}" references section "${rule.section}" which does not exist`,
          { ruleId: rule.id, sectionId: rule.section },
        ),
      );
    }
    if (rule.statement.length === 0) {
      errors.push(
        err(
          "EMPTY_RULE_STATEMENT",
          `rules[${i}].statement`,
          `Rule "${rule.id}" has an empty statement`,
          { ruleId: rule.id },
        ),
      );
    }
  }

  // Invariants also reference section ids (D23) and use the rule-location index
  for (let i = 0; i < module.invariants.length; i++) {
    const inv = module.invariants[i]!;
    if (!sectionIds.has(inv.section)) {
      errors.push(
        err(
          "MISSING_SECTION_REF",
          `invariants[${i}].section`,
          `Invariant "${inv.id}" references section "${inv.section}" which does not exist`,
          { ruleId: inv.id, sectionId: inv.section },
        ),
      );
    }
  }

  // D16 — error code; D17 — section ref; D18 — trigger; D19 — requiredContent non-empty if present
  for (let i = 0; i < module.errorCodes.length; i++) {
    const ec = module.errorCodes[i]!;
    if (ec.code.length === 0) {
      errors.push(
        err(
          "EMPTY_ERROR_CODE",
          `errorCodes[${i}].code`,
          "ErrorCodeDeclaration.code MUST be non-empty",
        ),
      );
    }
    if (!sectionIds.has(ec.section)) {
      errors.push(
        err(
          "MISSING_SECTION_REF",
          `errorCodes[${i}].section`,
          `ErrorCode "${ec.code}" references section "${ec.section}" which does not exist`,
          { sectionId: ec.section },
        ),
      );
    }
    if (ec.trigger.length === 0) {
      errors.push(
        err(
          "EMPTY_ERROR_TRIGGER",
          `errorCodes[${i}].trigger`,
          `ErrorCode "${ec.code}" has an empty trigger`,
        ),
      );
    }
    if (ec.requiredContent !== undefined && ec.requiredContent.length === 0) {
      errors.push(
        err(
          "EMPTY_REQUIRED_CONTENT",
          `errorCodes[${i}].requiredContent`,
          `ErrorCode "${ec.code}" has an empty requiredContent array`,
        ),
      );
    }
  }

  // Concepts (D21), terms (D25) — section refs must resolve
  for (let i = 0; i < module.concepts.length; i++) {
    const concept = module.concepts[i]!;
    if (!sectionIds.has(concept.section)) {
      errors.push(
        err(
          "MISSING_SECTION_REF",
          `concepts[${i}].section`,
          `Concept "${concept.name}" references section "${concept.section}" which does not exist`,
          { sectionId: concept.section },
        ),
      );
    }
  }
  for (let i = 0; i < module.terms.length; i++) {
    const term = module.terms[i]!;
    if (!sectionIds.has(term.section)) {
      errors.push(
        err(
          "MISSING_SECTION_REF",
          `terms[${i}].section`,
          `Term "${term.term}" references section "${term.section}" which does not exist`,
          { sectionId: term.section },
        ),
      );
    }
  }

  // D26 — DependsOn/Complements/Implements/Amends specIds are non-empty
  const refGroups: Array<{
    path: string;
    refs: readonly { readonly specId: string }[];
  }> = [
    { path: "dependsOn", refs: module.dependsOn },
    { path: "amends", refs: module.amends },
    { path: "complements", refs: module.complements },
    { path: "implements", refs: module.implements },
  ];
  for (const group of refGroups) {
    for (let i = 0; i < group.refs.length; i++) {
      if (group.refs[i]!.specId.length === 0) {
        errors.push(
          err(
            "EMPTY_DEPENDSON_SPEC_ID",
            `${group.path}[${i}].specId`,
            `Relationship ref at ${group.path}[${i}] has an empty specId`,
          ),
        );
      }
    }
  }

  return errors;
}

export function validateTestPlanStructural(module: TestPlanModule): readonly StructuralError[] {
  const errors: StructuralError[] = [];

  // D6
  if (module.id.length === 0) {
    errors.push(err("EMPTY_TESTPLAN_ID", "id", "TestPlanModule.id MUST be non-empty"));
  }

  // D30, D32 — TestCase identity + non-empty rules
  let coreCount = 0;
  let extendedCount = 0;
  for (let ci = 0; ci < module.categories.length; ci++) {
    const category = module.categories[ci]!;
    for (let ti = 0; ti < category.tests.length; ti++) {
      const tc = category.tests[ti]!;
      if (tc.id.length === 0) {
        errors.push(
          err(
            "EMPTY_TESTCASE_ID",
            `categories[${ci}].tests[${ti}].id`,
            "TestCase.id MUST be non-empty",
          ),
        );
      }
      if (tc.rules.length === 0) {
        errors.push(
          err(
            "EMPTY_TESTCASE_RULES",
            `categories[${ci}].tests[${ti}].rules`,
            `TestCase "${tc.id}" MUST reference at least one rule`,
            { testCaseId: tc.id },
          ),
        );
      }
      if (tc.tier === Tier.Core) {
        coreCount++;
      } else if (tc.tier === Tier.Extended) {
        extendedCount++;
      }
    }
  }

  // D8, D9 — tier counts match actual counts
  if (module.coreTier !== coreCount) {
    errors.push(
      err(
        "CORE_TIER_MISMATCH",
        "coreTier",
        `TestPlanModule.coreTier (${module.coreTier}) does not match Core test count (${coreCount})`,
        { declared: module.coreTier, actual: coreCount },
      ),
    );
  }
  if (module.extendedTier !== extendedCount) {
    errors.push(
      err(
        "EXTENDED_TIER_MISMATCH",
        "extendedTier",
        `TestPlanModule.extendedTier (${module.extendedTier}) does not match Extended test count (${extendedCount})`,
        { declared: module.extendedTier, actual: extendedCount },
      ),
    );
  }

  return errors;
}
