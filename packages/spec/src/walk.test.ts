// SS-TRV — Traversal helpers per §5.9 of spec-system-test-plan.source.md.

import { describe, expect, test } from "vitest";
import { ErrorCode, Rule, Section, Spec, Term } from "./constructors.ts";
import { Status, Strength } from "./enums.ts";
import type { SpecModule, SpecSection } from "./types.ts";
import { collectErrorCodes, collectRules, collectTerms, walkSections } from "./walk.ts";

function tree(): SpecModule {
  return Spec({
    id: "sp-trv",
    title: "T",
    version: "0.1.0",
    status: Status.Active,
    sections: [
      Section({
        id: "A",
        title: "A",
        normative: true,
        prose: ".",
        subsections: [
          Section({ id: "A1", title: "A1", normative: true, prose: "." }),
          Section({
            id: "A2",
            title: "A2",
            normative: true,
            prose: ".",
            subsections: [
              Section({
                id: "A2a",
                title: "A2a",
                normative: true,
                prose: ".",
              }),
            ],
          }),
        ],
      }),
      Section({ id: "B", title: "B", normative: true, prose: "." }),
    ],
    rules: [
      Rule({
        id: "T-R1",
        section: "A1",
        strength: Strength.MUST,
        statement: "one",
      }),
      Rule({
        id: "T-R2",
        section: "B",
        strength: Strength.SHOULD,
        statement: "two",
      }),
      Rule({
        id: "T-R3",
        section: "A2a",
        strength: Strength.MUST,
        statement: "three",
      }),
    ],
    errorCodes: [
      ErrorCode({ code: "E-B", section: "B", trigger: "bt" }),
      ErrorCode({ code: "E-A", section: "A", trigger: "at" }),
    ],
    terms: [
      Term({ term: "alpha", section: "A", definition: "def-a" }),
      Term({ term: "beta", section: "B", definition: "def-b" }),
    ],
  });
}

describe("SS-TRV", () => {
  test("SS-TRV-001 walkSections visits depth-first pre-order", () => {
    const visited: string[] = [];
    walkSections(tree(), (s) => visited.push(s.id));
    expect(visited).toEqual(["A", "A1", "A2", "A2a", "B"]);
  });

  test("SS-TRV-002 walkSections exposes path and depth", () => {
    const seen: Array<{ id: string; depth: number; pathIds: string[] }> = [];
    walkSections(tree(), (s, path, depth) =>
      seen.push({
        id: s.id,
        depth,
        pathIds: path.map((p: SpecSection) => p.id),
      }),
    );
    // A is depth 0, path = [A]
    expect(seen.find((e) => e.id === "A")).toEqual({
      id: "A",
      depth: 0,
      pathIds: ["A"],
    });
    // A2a is depth 2, path = [A, A2, A2a]
    expect(seen.find((e) => e.id === "A2a")).toEqual({
      id: "A2a",
      depth: 2,
      pathIds: ["A", "A2", "A2a"],
    });
  });

  test("SS-TRV-003 collectRules emits rules in section traversal order", () => {
    const rules = collectRules(tree());
    expect(rules.map((r) => r.id)).toEqual(["T-R1", "T-R3", "T-R2"]);
  });

  test("SS-TRV-004 collectErrorCodes emits in section traversal order", () => {
    const codes = collectErrorCodes(tree());
    expect(codes.map((c) => c.code)).toEqual(["E-A", "E-B"]);
  });

  test("SS-TRV-005 collectTerms emits in section traversal order", () => {
    const terms = collectTerms(tree());
    expect(terms.map((t) => t.term)).toEqual(["alpha", "beta"]);
  });
});
