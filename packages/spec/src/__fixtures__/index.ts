// Supplementary in-tree test fixtures. Small, self-contained v2 modules used
// across the test suite. Not part of the package's public surface.

import {
  CoverageEntry,
  OpenQuestion,
  Relationship,
  Rule,
  Section,
  Spec,
  Term,
  TestCase,
  TestCategory,
  TestPlan,
  TestPlanSection,
} from "../constructors.ts";
import type { SpecModule, TestPlanModule } from "../types.ts";

export const fixtureAlpha: SpecModule = Spec({
  id: "fixture-alpha",
  title: "Fixture Alpha",
  status: "active",
  relationships: [],
  sections: [
    Section({
      id: 1,
      title: "Core",
      prose: "Alpha prose.",
      rules: [
        Rule({ id: "A1", level: "must", text: "Alpha must do A1." }),
        Rule({ id: "A2", level: "should", text: "Alpha should do A2." }),
      ],
      termDefinitions: [Term({ term: "Alpha", definition: "The first fixture." })],
    }),
  ],
});

export const fixtureAlphaPlan: TestPlanModule = TestPlan({
  id: "fixture-alpha-plan",
  title: "Fixture Alpha Plan",
  validatesSpec: "fixture-alpha",
  sections: [TestPlanSection({ id: 1, title: "Cases", prose: "Case prose." })],
  categoriesSectionId: 1,
  categories: [
    TestCategory({
      id: "CAT-A",
      title: "Alpha Cases",
      cases: [
        TestCase({
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
    CoverageEntry({ rule: "A1", testIds: ["T-A-001"], status: "covered" }),
    CoverageEntry({ rule: "A2", testIds: [], status: "uncovered" }),
  ],
});

export const fixtureBeta: SpecModule = Spec({
  id: "fixture-beta",
  title: "Fixture Beta",
  status: "active",
  relationships: [Relationship({ type: "depends-on", target: "fixture-alpha" })],
  sections: [
    Section({
      id: 1,
      title: "Core",
      prose: "Beta prose.",
      rules: [Rule({ id: "B1", level: "must", text: "Beta must do B1." })],
    }),
  ],
});

export function fixtureBetaConflictingTerm(): SpecModule {
  return Spec({
    id: "fixture-beta",
    title: "Fixture Beta",
    status: "active",
    relationships: [Relationship({ type: "depends-on", target: "fixture-alpha" })],
    sections: [
      Section({
        id: 1,
        title: "Core",
        prose: "",
        rules: [Rule({ id: "B1", level: "must", text: "Beta must do B1." })],
        termDefinitions: [
          Term({ term: "Alpha", definition: "A conflicting redefinition of Alpha." }),
        ],
      }),
    ],
  });
}

export const fixtureGamma: SpecModule = Spec({
  id: "fixture-gamma",
  title: "Fixture Gamma",
  status: "superseded",
  relationships: [],
  sections: [
    Section({
      id: 1,
      title: "Legacy",
      prose: "Gamma prose.",
      rules: [Rule({ id: "G1", level: "may", text: "Gamma may do G1." })],
    }),
  ],
});

export const fixtureDelta: SpecModule = Spec({
  id: "fixture-delta",
  title: "Fixture Delta",
  status: "draft",
  relationships: [
    Relationship({ type: "depends-on", target: "fixture-alpha" }),
    Relationship({ type: "complements", target: "fixture-missing" }),
  ],
  sections: [
    Section({
      id: 1,
      title: "Questions",
      prose: "Delta prose referring to §2 of fixture-alpha.",
      rules: [Rule({ id: "D1", level: "must", text: "Delta must do D1." })],
    }),
  ],
  openQuestions: [
    OpenQuestion({
      id: "OQ-D-1",
      text: "Should D1 apply transitively?",
      status: "open",
      blocksTarget: "fixture-delta",
    }),
  ],
});

export function fixtureEpsilonCycle(): readonly [SpecModule, SpecModule] {
  const epsilonA = Spec({
    id: "fixture-epsilon-a",
    title: "Epsilon A",
    status: "active",
    relationships: [Relationship({ type: "depends-on", target: "fixture-epsilon-b" })],
    sections: [Section({ id: 1, title: "Only", prose: "" })],
  });
  const epsilonB = Spec({
    id: "fixture-epsilon-b",
    title: "Epsilon B",
    status: "active",
    relationships: [Relationship({ type: "depends-on", target: "fixture-epsilon-a" })],
    sections: [Section({ id: 1, title: "Only", prose: "" })],
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
