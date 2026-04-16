// Structural validation of authored modules per §6.3 (N7, N8) and
// §5 D1–D37 of spec-system-specification.source.md. These checks run before
// normalization computes any derived fields; if any returns a StructuralError,
// normalization must return an { ok: false } result and not emit an artifact.

import { Tier } from "./enums.ts";
import type {
  SpecModule,
  SpecSection,
  StructuralError,
  TestPlanModule,
  TestPlanSection,
} from "./types.ts";

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
  empties: { path: string }[],
  pathPrefix: string,
): void {
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const path = `${pathPrefix}[${i}]`;
    if (section.id.length === 0) {
      empties.push({ path: `${path}.id` });
    } else if (out.has(section.id)) {
      duplicates.add(section.id);
    } else {
      out.add(section.id);
    }
    collectSectionIds(section.subsections, out, duplicates, empties, `${path}.subsections`);
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

  // D10 — section IDs non-empty; D11 — section IDs unique within the module, including across nesting
  const sectionIds = new Set<string>();
  const duplicates = new Set<string>();
  const empties: { path: string }[] = [];
  collectSectionIds(module.sections, sectionIds, duplicates, empties, "sections");
  for (const empty of empties) {
    errors.push(err("EMPTY_SECTION_ID", empty.path, "SpecSection.id MUST be non-empty"));
  }
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

  // D22 — invariant id non-empty; D23 — invariants also reference section ids
  for (let i = 0; i < module.invariants.length; i++) {
    const inv = module.invariants[i]!;
    if (inv.id.length === 0) {
      errors.push(
        err(
          "EMPTY_INVARIANT_ID",
          `invariants[${i}].id`,
          "InvariantDeclaration.id MUST be non-empty",
        ),
      );
    }
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

  // D20 — concept name non-empty; D21 — concepts reference section ids
  for (let i = 0; i < module.concepts.length; i++) {
    const concept = module.concepts[i]!;
    if (concept.name.length === 0) {
      errors.push(
        err("EMPTY_CONCEPT_NAME", `concepts[${i}].name`, "ConceptExport.name MUST be non-empty"),
      );
    }
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
  // D24 — term string non-empty; D25 — terms reference section ids
  for (let i = 0; i < module.terms.length; i++) {
    const term = module.terms[i]!;
    if (term.term.length === 0) {
      errors.push(err("EMPTY_TERM", `terms[${i}].term`, "TermDefinition.term MUST be non-empty"));
    }
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

// Recursive walk collecting section-level structural errors for TestPlanModule.
// Enforces non-empty ids, globally-unique ids across every nesting level,
// non-empty titles, and (when present) a `number` matching `^\d+(?:\.\d+)*$`.
// Numbered-heading validation catches typos like `"1."` or `"§1"` at normalize
// time rather than letting them leak into the rendered Markdown.
function walkTestPlanSections(
  sections: readonly TestPlanSection[],
  seenIds: Set<string>,
  errors: StructuralError[],
  pathPrefix: string,
): void {
  const numberShape = /^\d+(?:\.\d+)*$/;
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const path = `${pathPrefix}[${i}]`;
    if (section.id.length === 0) {
      errors.push(
        err("EMPTY_TESTPLANSECTION_ID", `${path}.id`, "TestPlanSection.id MUST be non-empty"),
      );
    } else if (seenIds.has(section.id)) {
      errors.push(
        err(
          "DUPLICATE_TESTPLANSECTION_ID",
          `${path}.id`,
          `TestPlanSection id "${section.id}" is declared more than once`,
          { sectionId: section.id },
        ),
      );
    } else {
      seenIds.add(section.id);
    }
    if (section.title.length === 0) {
      errors.push(
        err(
          "EMPTY_TESTPLANSECTION_TITLE",
          `${path}.title`,
          "TestPlanSection.title MUST be non-empty",
        ),
      );
    }
    if (section.number !== undefined) {
      if (section.number.length === 0 || !numberShape.test(section.number)) {
        errors.push(
          err(
            "INVALID_TESTPLANSECTION_NUMBER",
            `${path}.number`,
            `TestPlanSection.number "${section.number}" MUST match /^\\d+(?:\\.\\d+)*$/`,
            { number: section.number },
          ),
        );
      }
    }
    walkTestPlanSections(section.subsections, seenIds, errors, `${path}.subsections`);
  }
}

export function validateTestPlanStructural(module: TestPlanModule): readonly StructuralError[] {
  const errors: StructuralError[] = [];

  // D6
  if (module.id.length === 0) {
    errors.push(err("EMPTY_TESTPLAN_ID", "id", "TestPlanModule.id MUST be non-empty"));
  }

  // Prose-section tree: recursive id / title / number shape checks.
  // `categoriesSectionId` must resolve to a section somewhere in this tree
  // so the renderer can locate the slot where category blocks get rendered.
  const sectionIds = new Set<string>();
  walkTestPlanSections(module.sections, sectionIds, errors, "sections");
  if (module.categoriesSectionId.length === 0) {
    errors.push(
      err(
        "EMPTY_CATEGORIES_SECTION_ID",
        "categoriesSectionId",
        "TestPlanModule.categoriesSectionId MUST be non-empty",
      ),
    );
  } else if (!sectionIds.has(module.categoriesSectionId)) {
    errors.push(
      err(
        "MISSING_CATEGORIES_SECTION",
        "categoriesSectionId",
        `TestPlanModule.categoriesSectionId "${module.categoriesSectionId}" does not resolve to any section in sections`,
        { sectionId: module.categoriesSectionId },
      ),
    );
  }

  // D29 — TestCategory id non-empty and unique within this test plan
  // D30, D32 — TestCase identity + non-empty rules
  const categoryIds = new Set<string>();
  let coreCount = 0;
  let extendedCount = 0;
  for (let ci = 0; ci < module.categories.length; ci++) {
    const category = module.categories[ci]!;
    if (category.id.length === 0) {
      errors.push(
        err("EMPTY_TESTCATEGORY_ID", `categories[${ci}].id`, "TestCategory.id MUST be non-empty"),
      );
    } else if (categoryIds.has(category.id)) {
      errors.push(
        err(
          "DUPLICATE_TESTCATEGORY_ID",
          `categories[${ci}].id`,
          `TestCategory id "${category.id}" is declared more than once`,
          { categoryId: category.id },
        ),
      );
    } else {
      categoryIds.add(category.id);
    }
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
