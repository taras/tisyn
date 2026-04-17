// v2 structural validation per §5.3 V1–V9 + §12 I8 of
// tisyn-spec-system-specification.source.md.
//
// Every check names the violated rule verbatim in `constraint` ("V1", "V2",
// "V3", "D27", "V5", "V6", "V7", "V8", "V9", "I8") so callers can map back to
// the exact wording in the source spec. Nothing here throws — normalization
// aggregates the returned errors into a { status: "error" } result (§5.1,
// SS-NM-003, SS-NM-005).

import {
  COVERAGE_STATUS,
  OPEN_QUESTION_STATUS,
  RELATIONSHIP_TYPES,
  RULE_LEVELS,
  SPEC_STATUS,
  TEST_PRIORITY,
  TEST_TYPE,
} from "./enums.ts";
import type {
  CoverageEntry,
  NormalizationError,
  OpenQuestion,
  Rule,
  Section,
  SpecModule,
  TestCase,
  TestPlanModule,
  TestPlanSection,
} from "./types.ts";

type Path = readonly (string | number)[];

function push(
  errors: NormalizationError[],
  constraint: string,
  message: string,
  path: Path,
): void {
  errors.push({ constraint, message, path });
}

// V2 is scoped to the D-rules it names. D5 (Section.id) is number|string per
// §4.4; for the number branch V2's non-empty requirement does not apply — the
// shape is handled by V8 (finite). For every other D-rule listed under V2, the
// id is a string and "non-empty" means `.length > 0`.
function v2NonEmptyString(
  errors: NormalizationError[],
  constraint: string,
  value: unknown,
  path: Path,
  message: string,
): void {
  if (typeof value !== "string" || value.length === 0) {
    push(errors, constraint, message, path);
  }
}

// V6 — required-field presence plus basic type sanity. Reports one error per
// missing/malformed field; downstream checks (V7/V8/V9) run only when the
// underlying shape is plausible.
function v6Field(
  errors: NormalizationError[],
  value: unknown,
  path: Path,
  expected: "string" | "number" | "boolean" | "array" | "object" | "string-or-number",
): boolean {
  if (value === undefined) {
    push(errors, "V6", `missing required field`, path);
    return false;
  }
  if (expected === "array") {
    if (!Array.isArray(value)) {
      push(errors, "V6", `expected array`, path);
      return false;
    }
    return true;
  }
  if (expected === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      push(errors, "V6", `expected object`, path);
      return false;
    }
    return true;
  }
  if (expected === "string-or-number") {
    if (typeof value !== "string" && typeof value !== "number") {
      push(errors, "V6", `expected string or number`, path);
      return false;
    }
    return true;
  }
  if (typeof value !== expected) {
    push(errors, "V6", `expected ${expected}`, path);
    return false;
  }
  return true;
}

// V8 — Section ids are finite numbers or non-empty strings. Applies to both
// Section.id (§4.4 D5/D7) and TestPlanSection.id (§4.13 D21).
function v8SectionId(
  errors: NormalizationError[],
  id: unknown,
  path: Path,
): void {
  if (typeof id === "number") {
    if (!Number.isFinite(id)) {
      push(errors, "V8", `section id must be finite`, path);
    }
    return;
  }
  if (typeof id === "string") {
    if (id.length === 0) {
      push(errors, "V8", `section id string must be non-empty`, path);
    }
    return;
  }
  push(errors, "V8", `section id must be a finite number or a non-empty string`, path);
}

function v9Enum<T extends string>(
  errors: NormalizationError[],
  value: unknown,
  allowed: readonly T[],
  path: Path,
): void {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    push(
      errors,
      "V9",
      `expected one of ${(allowed as readonly string[]).map((v) => JSON.stringify(v)).join(", ")}`,
      path,
    );
  }
}

// Walk a Section subtree collecting:
//  • every section id → path mapping (for V3 D5 uniqueness + V5 resolution)
//  • every rule id    → path mapping (for V3 D8 uniqueness)
//  • every term text  → path mapping (for V3 D11 uniqueness)
//  • every open-question id not covered here (V3 D13 lives at module root)
//
// The walk also fires V6/V7/V8/V9 checks per node.
function walkSections(
  sections: readonly unknown[],
  base: Path,
  errors: NormalizationError[],
  sectionIdPaths: Map<string, Path>,
  ruleIdPaths: Map<string, Path>,
  termPaths: Map<string, Path>,
  numericSectionIds: Set<number>,
): void {
  for (let i = 0; i < sections.length; i++) {
    const raw = sections[i];
    const at: Path = [...base, i];
    if (!v6Field(errors, raw, at, "object")) {
      continue;
    }
    const section = raw as Partial<Section>;
    // Section.id — V6 presence + V8 shape + V3 D5 uniqueness (string branch).
    if (v6Field(errors, section.id, [...at, "id"], "string-or-number")) {
      v8SectionId(errors, section.id, [...at, "id"]);
      if (typeof section.id === "string" && section.id.length > 0) {
        const key = `str:${section.id}`;
        if (sectionIdPaths.has(key)) {
          push(errors, "V3", `duplicate section id "${section.id}" within spec`, [...at, "id"]);
        } else {
          sectionIdPaths.set(key, [...at, "id"]);
        }
      } else if (typeof section.id === "number" && Number.isFinite(section.id)) {
        if (numericSectionIds.has(section.id)) {
          push(errors, "V3", `duplicate section id ${section.id} within spec`, [...at, "id"]);
        } else {
          numericSectionIds.add(section.id);
          sectionIdPaths.set(`num:${section.id}`, [...at, "id"]);
        }
      }
    }
    // Section.title — V6 + V7.
    if (v6Field(errors, section.title, [...at, "title"], "string")) {
      if ((section.title as string).length === 0) {
        push(errors, "V7", `section title must be non-empty`, [...at, "title"]);
      }
    }
    // Section.prose — V6.
    v6Field(errors, section.prose, [...at, "prose"], "string");

    // Optional containers — type-check only when present.
    if (section.rules !== undefined) {
      if (v6Field(errors, section.rules, [...at, "rules"], "array")) {
        walkRules(section.rules as readonly unknown[], [...at, "rules"], errors, ruleIdPaths);
      }
    }
    if (section.errorCodes !== undefined) {
      if (v6Field(errors, section.errorCodes, [...at, "errorCodes"], "array")) {
        walkErrorCodes(section.errorCodes as readonly unknown[], [...at, "errorCodes"], errors);
      }
    }
    if (section.conceptExports !== undefined) {
      if (v6Field(errors, section.conceptExports, [...at, "conceptExports"], "array")) {
        walkConceptExports(
          section.conceptExports as readonly unknown[],
          [...at, "conceptExports"],
          errors,
        );
      }
    }
    if (section.termDefinitions !== undefined) {
      if (v6Field(errors, section.termDefinitions, [...at, "termDefinitions"], "array")) {
        walkTermDefinitions(
          section.termDefinitions as readonly unknown[],
          [...at, "termDefinitions"],
          errors,
          termPaths,
        );
      }
    }
    if (section.invariants !== undefined) {
      if (v6Field(errors, section.invariants, [...at, "invariants"], "array")) {
        walkInvariants(section.invariants as readonly unknown[], [...at, "invariants"], errors);
      }
    }
    if (section.subsections !== undefined) {
      if (v6Field(errors, section.subsections, [...at, "subsections"], "array")) {
        walkSections(
          section.subsections as readonly unknown[],
          [...at, "subsections"],
          errors,
          sectionIdPaths,
          ruleIdPaths,
          termPaths,
          numericSectionIds,
        );
      }
    }
  }
}

function walkRules(
  rules: readonly unknown[],
  base: Path,
  errors: NormalizationError[],
  ruleIdPaths: Map<string, Path>,
): void {
  for (let i = 0; i < rules.length; i++) {
    const at: Path = [...base, i];
    if (!v6Field(errors, rules[i], at, "object")) continue;
    const rule = rules[i] as Partial<Rule>;
    // V2 (D8) + V3 (D8 uniqueness within spec).
    if (v6Field(errors, rule.id, [...at, "id"], "string")) {
      v2NonEmptyString(errors, "V2", rule.id, [...at, "id"], `Rule.id MUST be non-empty (D8)`);
      if (typeof rule.id === "string" && rule.id.length > 0) {
        if (ruleIdPaths.has(rule.id)) {
          push(errors, "V3", `duplicate rule id "${rule.id}" within spec`, [...at, "id"]);
        } else {
          ruleIdPaths.set(rule.id, [...at, "id"]);
        }
      }
    }
    // V6 + V9: level in RULE_LEVELS.
    if (v6Field(errors, rule.level, [...at, "level"], "string")) {
      v9Enum(errors, rule.level, RULE_LEVELS, [...at, "level"]);
    }
    v6Field(errors, rule.text, [...at, "text"], "string");
  }
}

function walkErrorCodes(codes: readonly unknown[], base: Path, errors: NormalizationError[]): void {
  for (let i = 0; i < codes.length; i++) {
    const at: Path = [...base, i];
    if (!v6Field(errors, codes[i], at, "object")) continue;
    const code = codes[i] as { code?: unknown; trigger?: unknown; requiredContent?: unknown };
    if (v6Field(errors, code.code, [...at, "code"], "string")) {
      v2NonEmptyString(errors, "V2", code.code, [...at, "code"], `ErrorCode.code MUST be non-empty (D15)`);
    }
    v6Field(errors, code.trigger, [...at, "trigger"], "string");
    if (code.requiredContent !== undefined) {
      v6Field(errors, code.requiredContent, [...at, "requiredContent"], "string");
    }
  }
}

function walkConceptExports(
  concepts: readonly unknown[],
  base: Path,
  errors: NormalizationError[],
): void {
  for (let i = 0; i < concepts.length; i++) {
    const at: Path = [...base, i];
    if (!v6Field(errors, concepts[i], at, "object")) continue;
    const concept = concepts[i] as { name?: unknown; description?: unknown };
    if (v6Field(errors, concept.name, [...at, "name"], "string")) {
      v2NonEmptyString(
        errors,
        "V2",
        concept.name,
        [...at, "name"],
        `ConceptExport.name MUST be non-empty (D16)`,
      );
    }
    v6Field(errors, concept.description, [...at, "description"], "string");
  }
}

function walkTermDefinitions(
  terms: readonly unknown[],
  base: Path,
  errors: NormalizationError[],
  termPaths: Map<string, Path>,
): void {
  for (let i = 0; i < terms.length; i++) {
    const at: Path = [...base, i];
    if (!v6Field(errors, terms[i], at, "object")) continue;
    const term = terms[i] as { term?: unknown; definition?: unknown };
    if (v6Field(errors, term.term, [...at, "term"], "string")) {
      // D10 is not named under V2 explicitly but is required by §4.6. Treat as
      // a V6-adjacent non-empty check so obvious garbage is caught early.
      if (typeof term.term === "string" && term.term.length === 0) {
        push(errors, "V6", `TermDefinition.term MUST be non-empty (D10)`, [...at, "term"]);
      }
      if (typeof term.term === "string" && term.term.length > 0) {
        if (termPaths.has(term.term)) {
          push(
            errors,
            "V3",
            `term "${term.term}" is defined more than once within spec (D11)`,
            [...at, "term"],
          );
        } else {
          termPaths.set(term.term, [...at, "term"]);
        }
      }
    }
    v6Field(errors, term.definition, [...at, "definition"], "string");
  }
}

function walkInvariants(invs: readonly unknown[], base: Path, errors: NormalizationError[]): void {
  for (let i = 0; i < invs.length; i++) {
    const at: Path = [...base, i];
    if (!v6Field(errors, invs[i], at, "object")) continue;
    const inv = invs[i] as { id?: unknown; text?: unknown };
    if (v6Field(errors, inv.id, [...at, "id"], "string")) {
      v2NonEmptyString(
        errors,
        "V2",
        inv.id,
        [...at, "id"],
        `InvariantDeclaration.id MUST be non-empty (D17)`,
      );
    }
    v6Field(errors, inv.text, [...at, "text"], "string");
  }
}

function walkOpenQuestions(
  oqs: readonly unknown[],
  base: Path,
  errors: NormalizationError[],
): void {
  const seen = new Map<string, Path>();
  for (let i = 0; i < oqs.length; i++) {
    const at: Path = [...base, i];
    if (!v6Field(errors, oqs[i], at, "object")) continue;
    const oq = oqs[i] as Partial<OpenQuestion>;
    if (v6Field(errors, oq.id, [...at, "id"], "string")) {
      v2NonEmptyString(
        errors,
        "V2",
        oq.id,
        [...at, "id"],
        `OpenQuestion.id MUST be non-empty (D13)`,
      );
      if (typeof oq.id === "string" && oq.id.length > 0) {
        if (seen.has(oq.id)) {
          push(
            errors,
            "V3",
            `open-question id "${oq.id}" is declared more than once (D13)`,
            [...at, "id"],
          );
        } else {
          seen.set(oq.id, [...at, "id"]);
        }
      }
    }
    v6Field(errors, oq.text, [...at, "text"], "string");
    if (v6Field(errors, oq.status, [...at, "status"], "string")) {
      v9Enum(errors, oq.status, OPEN_QUESTION_STATUS, [...at, "status"]);
    }
  }
}

function walkRelationships(
  rels: readonly unknown[],
  base: Path,
  errors: NormalizationError[],
): void {
  for (let i = 0; i < rels.length; i++) {
    const at: Path = [...base, i];
    if (!v6Field(errors, rels[i], at, "object")) continue;
    const rel = rels[i] as { type?: unknown; target?: unknown };
    if (v6Field(errors, rel.type, [...at, "type"], "string")) {
      v9Enum(errors, rel.type, RELATIONSHIP_TYPES, [...at, "type"]);
    }
    if (v6Field(errors, rel.target, [...at, "target"], "string")) {
      if (typeof rel.target === "string" && rel.target.length === 0) {
        push(errors, "V6", `Relationship.target MUST be non-empty (D12)`, [...at, "target"]);
      }
    }
  }
}

export function validateSpecStructural(module: SpecModule): readonly NormalizationError[] {
  const errors: NormalizationError[] = [];

  // V1 / I8 — root discriminant.
  if ((module as { tisyn_spec?: unknown }).tisyn_spec !== "spec") {
    push(errors, "V1", `SpecModule.tisyn_spec MUST equal "spec"`, ["tisyn_spec"]);
  }
  if ((module as { tisyn?: unknown }).tisyn !== undefined) {
    push(errors, "I8", `SpecModule MUST NOT carry both tisyn_spec and tisyn`, ["tisyn"]);
  }

  // V2 (D1) — id.
  if (v6Field(errors, module.id, ["id"], "string")) {
    v2NonEmptyString(errors, "V2", module.id, ["id"], `SpecModule.id MUST be non-empty (D1)`);
  }
  // V7 — title.
  if (v6Field(errors, module.title, ["title"], "string")) {
    if (module.title.length === 0) {
      push(errors, "V7", `SpecModule.title MUST be non-empty`, ["title"]);
    }
  }
  // V9 — status.
  if (v6Field(errors, module.status, ["status"], "string")) {
    v9Enum(errors, module.status, SPEC_STATUS, ["status"]);
  }
  // V6 — relationships array + element shape (type/target).
  if (v6Field(errors, module.relationships, ["relationships"], "array")) {
    walkRelationships(module.relationships as readonly unknown[], ["relationships"], errors);
  }
  // V6 — sections must be a non-empty array (D3).
  if (v6Field(errors, module.sections, ["sections"], "array")) {
    if ((module.sections as readonly unknown[]).length === 0) {
      push(errors, "V6", `SpecModule.sections MUST contain at least one Section (D3)`, [
        "sections",
      ]);
    }
    const sectionIds = new Map<string, Path>();
    const ruleIds = new Map<string, Path>();
    const termPaths = new Map<string, Path>();
    const numericSectionIds = new Set<number>();
    walkSections(
      module.sections as readonly unknown[],
      ["sections"],
      errors,
      sectionIds,
      ruleIds,
      termPaths,
      numericSectionIds,
    );
  }
  // Optional openQuestions.
  if (module.openQuestions !== undefined) {
    if (v6Field(errors, module.openQuestions, ["openQuestions"], "array")) {
      walkOpenQuestions(
        module.openQuestions as readonly unknown[],
        ["openQuestions"],
        errors,
      );
    }
  }

  return errors;
}

// ── Test plan validation ──

function walkTestPlanSections(
  sections: readonly unknown[],
  base: Path,
  errors: NormalizationError[],
  ids: Map<string, Path>,
  numericIds: Set<number>,
): void {
  for (let i = 0; i < sections.length; i++) {
    const at: Path = [...base, i];
    if (!v6Field(errors, sections[i], at, "object")) continue;
    const section = sections[i] as Partial<TestPlanSection>;
    if (v6Field(errors, section.id, [...at, "id"], "string-or-number")) {
      v8SectionId(errors, section.id, [...at, "id"]);
      if (typeof section.id === "string" && section.id.length > 0) {
        const key = `str:${section.id}`;
        if (ids.has(key)) {
          push(errors, "V3", `duplicate test-plan section id "${section.id}" (D21)`, [
            ...at,
            "id",
          ]);
        } else {
          ids.set(key, [...at, "id"]);
        }
      } else if (typeof section.id === "number" && Number.isFinite(section.id)) {
        if (numericIds.has(section.id)) {
          push(errors, "V3", `duplicate test-plan section id ${section.id} (D21)`, [
            ...at,
            "id",
          ]);
        } else {
          numericIds.add(section.id);
          ids.set(`num:${section.id}`, [...at, "id"]);
        }
      }
    }
    if (v6Field(errors, section.title, [...at, "title"], "string")) {
      if ((section.title as string).length === 0) {
        push(errors, "V7", `test-plan section title must be non-empty`, [...at, "title"]);
      }
    }
    v6Field(errors, section.prose, [...at, "prose"], "string");
    if (section.subsections !== undefined) {
      if (v6Field(errors, section.subsections, [...at, "subsections"], "array")) {
        walkTestPlanSections(
          section.subsections as readonly unknown[],
          [...at, "subsections"],
          errors,
          ids,
          numericIds,
        );
      }
    }
  }
}

function walkTestCategories(
  categories: readonly unknown[],
  base: Path,
  errors: NormalizationError[],
  testCaseIds: Set<string>,
): void {
  const ids = new Map<string, Path>();
  for (let i = 0; i < categories.length; i++) {
    const at: Path = [...base, i];
    if (!v6Field(errors, categories[i], at, "object")) continue;
    const category = categories[i] as { id?: unknown; title?: unknown; cases?: unknown };
    if (v6Field(errors, category.id, [...at, "id"], "string")) {
      v2NonEmptyString(
        errors,
        "V2",
        category.id,
        [...at, "id"],
        `TestCategory.id MUST be non-empty (D23)`,
      );
      if (typeof category.id === "string" && category.id.length > 0) {
        if (ids.has(category.id)) {
          push(
            errors,
            "V3",
            `duplicate test category id "${category.id}" within plan (D23)`,
            [...at, "id"],
          );
        } else {
          ids.set(category.id, [...at, "id"]);
        }
      }
    }
    if (v6Field(errors, category.title, [...at, "title"], "string")) {
      if ((category.title as string).length === 0) {
        push(errors, "V7", `test category title must be non-empty`, [...at, "title"]);
      }
    }
    if (v6Field(errors, category.cases, [...at, "cases"], "array")) {
      walkTestCases(category.cases as readonly unknown[], [...at, "cases"], errors, testCaseIds);
    }
  }
}

function walkTestCases(
  cases: readonly unknown[],
  base: Path,
  errors: NormalizationError[],
  testCaseIds: Set<string>,
): void {
  for (let i = 0; i < cases.length; i++) {
    const at: Path = [...base, i];
    if (!v6Field(errors, cases[i], at, "object")) continue;
    const tc = cases[i] as Partial<TestCase>;
    if (v6Field(errors, tc.id, [...at, "id"], "string")) {
      v2NonEmptyString(errors, "V2", tc.id, [...at, "id"], `TestCase.id MUST be non-empty (D24)`);
      if (typeof tc.id === "string" && tc.id.length > 0) {
        testCaseIds.add(tc.id);
      }
    }
    if (v6Field(errors, tc.priority, [...at, "priority"], "string")) {
      v9Enum(errors, tc.priority, TEST_PRIORITY, [...at, "priority"]);
    }
    if (v6Field(errors, tc.type, [...at, "type"], "string")) {
      v9Enum(errors, tc.type, TEST_TYPE, [...at, "type"]);
    }
    v6Field(errors, tc.specRef, [...at, "specRef"], "string");
    v6Field(errors, tc.assertion, [...at, "assertion"], "string");
  }
}

function walkCoverageMatrix(
  entries: readonly unknown[],
  base: Path,
  errors: NormalizationError[],
): void {
  for (let i = 0; i < entries.length; i++) {
    const at: Path = [...base, i];
    if (!v6Field(errors, entries[i], at, "object")) continue;
    const entry = entries[i] as Partial<CoverageEntry>;
    v6Field(errors, entry.rule, [...at, "rule"], "string");
    v6Field(errors, entry.testIds, [...at, "testIds"], "array");
    if (v6Field(errors, entry.status, [...at, "status"], "string")) {
      v9Enum(errors, entry.status, COVERAGE_STATUS, [...at, "status"]);
    }
    // D27 / V4 — status consistency.
    const ids = Array.isArray(entry.testIds) ? (entry.testIds as unknown[]) : undefined;
    if (ids !== undefined && typeof entry.status === "string") {
      if (ids.length === 0 && entry.status === "covered") {
        push(
          errors,
          "D27",
          `CoverageEntry with empty testIds MUST NOT have status "covered" (V4 / D27)`,
          [...at, "status"],
        );
      }
      if (ids.length > 0 && entry.status !== "covered") {
        push(
          errors,
          "D27",
          `CoverageEntry with non-empty testIds MUST have status "covered" (V4 / D27)`,
          [...at, "status"],
        );
      }
    }
  }
}

export function validateTestPlanStructural(
  module: TestPlanModule,
): readonly NormalizationError[] {
  const errors: NormalizationError[] = [];

  // V1 / I8 — root discriminant.
  if ((module as { tisyn_spec?: unknown }).tisyn_spec !== "test-plan") {
    push(errors, "V1", `TestPlanModule.tisyn_spec MUST equal "test-plan"`, ["tisyn_spec"]);
  }
  if ((module as { tisyn?: unknown }).tisyn !== undefined) {
    push(errors, "I8", `TestPlanModule MUST NOT carry both tisyn_spec and tisyn`, ["tisyn"]);
  }

  // V2 (D18) + V6 — id.
  if (v6Field(errors, module.id, ["id"], "string")) {
    v2NonEmptyString(
      errors,
      "V2",
      module.id,
      ["id"],
      `TestPlanModule.id MUST be non-empty (D18)`,
    );
  }
  if (v6Field(errors, module.title, ["title"], "string")) {
    if (module.title.length === 0) {
      push(errors, "V7", `TestPlanModule.title MUST be non-empty`, ["title"]);
    }
  }
  if (v6Field(errors, module.validatesSpec, ["validatesSpec"], "string")) {
    if ((module.validatesSpec as string).length === 0) {
      push(errors, "V6", `TestPlanModule.validatesSpec MUST be non-empty (D19)`, [
        "validatesSpec",
      ]);
    }
  }

  // Prose sections tree — V3/V7/V8.
  const sectionIds = new Map<string, Path>();
  const numericSectionIds = new Set<number>();
  if (v6Field(errors, module.sections, ["sections"], "array")) {
    walkTestPlanSections(
      module.sections as readonly unknown[],
      ["sections"],
      errors,
      sectionIds,
      numericSectionIds,
    );
  }

  // V5 — categoriesSectionId resolves inside sections.
  if (v6Field(errors, module.categoriesSectionId, ["categoriesSectionId"], "string-or-number")) {
    const csid = module.categoriesSectionId;
    const key = typeof csid === "number" ? `num:${csid}` : `str:${csid}`;
    if (typeof csid === "string" && csid.length === 0) {
      push(
        errors,
        "V5",
        `TestPlanModule.categoriesSectionId MUST be non-empty`,
        ["categoriesSectionId"],
      );
    } else if (!sectionIds.has(key)) {
      push(
        errors,
        "V5",
        `TestPlanModule.categoriesSectionId ${JSON.stringify(csid)} does not resolve to any section`,
        ["categoriesSectionId"],
      );
    }
  }

  const testCaseIds = new Set<string>();
  if (v6Field(errors, module.categories, ["categories"], "array")) {
    walkTestCategories(
      module.categories as readonly unknown[],
      ["categories"],
      errors,
      testCaseIds,
    );
  }
  if (v6Field(errors, module.coverageMatrix, ["coverageMatrix"], "array")) {
    walkCoverageMatrix(module.coverageMatrix as readonly unknown[], ["coverageMatrix"], errors);
  }

  return errors;
}
