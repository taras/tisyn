// Supplementary in-tree test fixtures. Small, self-contained v2 modules used
// across the test suite. Not part of the package's public surface.

import {
  coverageEntry,
  openQuestion,
  relationship,
  rule,
  section,
  spec,
  term,
  testCase,
  testCategory,
  testPlan,
  testPlanSection,
} from "../constructors.ts";
import type { SpecModule, TestPlanModule } from "../types.ts";

export const fixtureAlpha: SpecModule = spec({
  id: "fixture-alpha",
  title: "Fixture Alpha",
  status: "active",
  relationships: [],
  sections: [
    section({
      id: 1,
      title: "Core",
      prose: "Alpha prose.",
      rules: [
        rule({ id: "A1", level: "must", text: "Alpha must do A1." }),
        rule({ id: "A2", level: "should", text: "Alpha should do A2." }),
      ],
      termDefinitions: [term({ term: "Alpha", definition: "The first fixture." })],
    }),
  ],
});

export const fixtureAlphaPlan: TestPlanModule = testPlan({
  id: "fixture-alpha-plan",
  title: "Fixture Alpha Plan",
  validatesSpec: "fixture-alpha",
  sections: [
    testPlanSection({ id: 1, title: "Cases", prose: "Case prose." }),
  ],
  categoriesSectionId: 1,
  categories: [
    testCategory({
      id: "CAT-A",
      title: "Alpha Cases",
      cases: [
        testCase({
          id: "T-A-001",
          priority: "p0",
          type: "unit",
          specRef: "§1",
          assertion: "A1 holds.",
        }),
      ],
    }),
  ],
  coverageMatrix: [
    coverageEntry({ rule: "A1", testIds: ["T-A-001"], status: "covered" }),
    coverageEntry({ rule: "A2", testIds: [], status: "uncovered" }),
  ],
});

export const fixtureBeta: SpecModule = spec({
  id: "fixture-beta",
  title: "Fixture Beta",
  status: "active",
  relationships: [relationship({ type: "depends-on", target: "fixture-alpha" })],
  sections: [
    section({
      id: 1,
      title: "Core",
      prose: "Beta prose.",
      rules: [rule({ id: "B1", level: "must", text: "Beta must do B1." })],
    }),
  ],
});

export function fixtureBetaConflictingTerm(): SpecModule {
  return spec({
    id: "fixture-beta",
    title: "Fixture Beta",
    status: "active",
    relationships: [relationship({ type: "depends-on", target: "fixture-alpha" })],
    sections: [
      section({
        id: 1,
        title: "Core",
        prose: "",
        rules: [rule({ id: "B1", level: "must", text: "Beta must do B1." })],
        termDefinitions: [
          term({ term: "Alpha", definition: "A conflicting redefinition of Alpha." }),
        ],
      }),
    ],
  });
}

export const fixtureGamma: SpecModule = spec({
  id: "fixture-gamma",
  title: "Fixture Gamma",
  status: "superseded",
  relationships: [],
  sections: [
    section({
      id: 1,
      title: "Legacy",
      prose: "Gamma prose.",
      rules: [rule({ id: "G1", level: "may", text: "Gamma may do G1." })],
    }),
  ],
});

export const fixtureDelta: SpecModule = spec({
  id: "fixture-delta",
  title: "Fixture Delta",
  status: "draft",
  relationships: [
    relationship({ type: "depends-on", target: "fixture-alpha" }),
    relationship({ type: "complements", target: "fixture-missing" }),
  ],
  sections: [
    section({
      id: 1,
      title: "Questions",
      prose: "Delta prose referring to §2 of fixture-alpha.",
      rules: [rule({ id: "D1", level: "must", text: "Delta must do D1." })],
    }),
  ],
  openQuestions: [
    openQuestion({
      id: "OQ-D-1",
      text: "Should D1 apply transitively?",
      status: "open",
      blocksTarget: "fixture-delta",
    }),
  ],
});

export function fixtureEpsilonCycle(): readonly [SpecModule, SpecModule] {
  const epsilonA = spec({
    id: "fixture-epsilon-a",
    title: "Epsilon A",
    status: "active",
    relationships: [relationship({ type: "depends-on", target: "fixture-epsilon-b" })],
    sections: [section({ id: 1, title: "Only", prose: "" })],
  });
  const epsilonB = spec({
    id: "fixture-epsilon-b",
    title: "Epsilon B",
    status: "active",
    relationships: [relationship({ type: "depends-on", target: "fixture-epsilon-a" })],
    sections: [section({ id: 1, title: "Only", prose: "" })],
  });
  return [epsilonA, epsilonB];
}

// Intentionally malformed: empty spec id (V2 on D1 violation).
export const fixtureMalformed: SpecModule = {
  tisyn_spec: "spec",
  id: "",
  title: "Malformed",
  status: "active",
  relationships: [],
  sections: [],
};
