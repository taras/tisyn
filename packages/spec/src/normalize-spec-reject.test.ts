// SS-NR (spec-module rows) — Structural rejection tests per §5.5 of
// spec-system-test-plan.source.md. Covers SS-NR-001, 002, 003, 005, 006, 007,
// 008, 009, 010, 011, 012, 015 — the twelve spec-module rows. Test-plan rows
// SS-NR-004, 013, 014, 016, 017 land in commit 7 against normalizeTestPlan.

import { describe, expect, test } from "vitest";
import {
  Concept,
  DependsOn,
  ErrorCode,
  Invariant,
  Rule,
  Section,
  Spec,
  Term,
} from "./constructors.ts";
import { Status, Strength } from "./enums.ts";
import { normalizeSpec } from "./normalize.ts";
import type { SpecModule, StructuralError } from "./types.ts";

function expectReject(module: SpecModule, code: string): StructuralError[] {
  const result = normalizeSpec(module);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("unreachable");
  }
  expect(result.errors.some((e) => e.code === code)).toBe(true);
  return [...result.errors];
}

function validSection() {
  return Section({ id: "s1", title: "S", normative: true, prose: "." });
}

describe("SS-NR (spec module)", () => {
  test("SS-NR-001 Empty spec id rejected (EMPTY_SPEC_ID)", () => {
    expectReject(
      Spec({
        id: "",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [validSection()],
      }),
      "EMPTY_SPEC_ID",
    );
  });

  test("SS-NR-002 Empty spec version rejected (EMPTY_SPEC_VERSION)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "",
        status: Status.Active,
        sections: [validSection()],
      }),
      "EMPTY_SPEC_VERSION",
    );
  });

  test("SS-NR-003 Empty sections array rejected (EMPTY_SECTIONS)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [],
      }),
      "EMPTY_SECTIONS",
    );
  });

  test("SS-NR-005 Duplicate section IDs rejected (DUPLICATE_SECTION_ID)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [
          Section({ id: "dup", title: "A", normative: true, prose: "." }),
          Section({ id: "dup", title: "B", normative: true, prose: "." }),
        ],
      }),
      "DUPLICATE_SECTION_ID",
    );
  });

  test("SS-NR-006 Duplicate section IDs across nesting levels rejected", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [
          Section({
            id: "dup",
            title: "Top",
            normative: true,
            prose: ".",
            subsections: [
              Section({
                id: "dup",
                title: "Nested",
                normative: true,
                prose: ".",
              }),
            ],
          }),
        ],
      }),
      "DUPLICATE_SECTION_ID",
    );
  });

  test("SS-NR-007 Rule with invalid section ref rejected (MISSING_SECTION_REF)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [validSection()],
        rules: [
          Rule({
            id: "X-R1",
            section: "nope",
            strength: Strength.MUST,
            statement: "s",
          }),
        ],
      }),
      "MISSING_SECTION_REF",
    );
  });

  test("SS-NR-008 Rule with empty statement rejected (EMPTY_RULE_STATEMENT)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [validSection()],
        rules: [
          Rule({
            id: "X-R1",
            section: "s1",
            strength: Strength.MUST,
            statement: "",
          }),
        ],
      }),
      "EMPTY_RULE_STATEMENT",
    );
  });

  test("SS-NR-009 Error code with empty code rejected (EMPTY_ERROR_CODE)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [validSection()],
        errorCodes: [ErrorCode({ code: "", section: "s1", trigger: "t" })],
      }),
      "EMPTY_ERROR_CODE",
    );
  });

  test("SS-NR-010 Error code with invalid section ref rejected (MISSING_SECTION_REF)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [validSection()],
        errorCodes: [ErrorCode({ code: "X-E1", section: "nope", trigger: "t" })],
      }),
      "MISSING_SECTION_REF",
    );
  });

  test("SS-NR-011 Error code with empty trigger rejected (EMPTY_ERROR_TRIGGER)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [validSection()],
        errorCodes: [ErrorCode({ code: "X-E1", section: "s1", trigger: "" })],
      }),
      "EMPTY_ERROR_TRIGGER",
    );
  });

  test("SS-NR-012 Error code with empty requiredContent rejected (EMPTY_REQUIRED_CONTENT)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [validSection()],
        errorCodes: [
          ErrorCode({
            code: "X-E1",
            section: "s1",
            trigger: "t",
            requiredContent: [],
          }),
        ],
      }),
      "EMPTY_REQUIRED_CONTENT",
    );
  });

  test("SS-NR-015 Empty specId in DependsOn rejected (EMPTY_DEPENDSON_SPEC_ID)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        dependsOn: [DependsOn("")],
        sections: [validSection()],
      }),
      "EMPTY_DEPENDSON_SPEC_ID",
    );
  });

  test("SS-NR-018 Empty top-level section id rejected (EMPTY_SECTION_ID)", () => {
    const errors = expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [Section({ id: "", title: "T", normative: true, prose: "." })],
      }),
      "EMPTY_SECTION_ID",
    );
    const empty = errors.find((e) => e.code === "EMPTY_SECTION_ID");
    expect(empty?.path).toBe("sections[0].id");
  });

  test("SS-NR-019 Empty nested subsection id rejected (EMPTY_SECTION_ID)", () => {
    const errors = expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [
          Section({
            id: "top",
            title: "Top",
            normative: true,
            prose: ".",
            subsections: [Section({ id: "", title: "Sub", normative: true, prose: "." })],
          }),
        ],
      }),
      "EMPTY_SECTION_ID",
    );
    const empty = errors.find((e) => e.code === "EMPTY_SECTION_ID");
    expect(empty?.path).toBe("sections[0].subsections[0].id");
  });

  test("SS-NR-020 Empty concept name rejected (EMPTY_CONCEPT_NAME)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [validSection()],
        concepts: [Concept({ name: "", section: "s1", description: "d" })],
      }),
      "EMPTY_CONCEPT_NAME",
    );
  });

  test("SS-NR-021 Empty invariant id rejected (EMPTY_INVARIANT_ID)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [validSection()],
        invariants: [Invariant({ id: "", section: "s1", statement: "inv" })],
      }),
      "EMPTY_INVARIANT_ID",
    );
  });

  test("SS-NR-022 Empty term string rejected (EMPTY_TERM)", () => {
    expectReject(
      Spec({
        id: "sp-x",
        title: "X",
        version: "0.1.0",
        status: Status.Active,
        sections: [validSection()],
        terms: [Term({ term: "", section: "s1", definition: "d" })],
      }),
      "EMPTY_TERM",
    );
  });
});
