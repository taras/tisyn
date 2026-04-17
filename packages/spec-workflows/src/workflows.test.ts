// SS-WF: the acquire-assemble-return workflows. SS-WF-001 verified by running
// against a stubbed acquire that returns a prebuilt registry; SS-WF-003 by
// typed return shape.

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import {
  assembleAmendmentContext,
  assembleAuthoringContext,
  assembleConsistencyContext,
  assembleReviewContext,
  assembleTestPlanContext,
  buildRegistry,
  coverageEntry,
  createAcquire,
  normalizeSpec,
  normalizeTestPlan,
  rule,
  section,
  spec,
  testCase,
  testCategory,
  testPlan,
  testPlanSection,
  type NormalizedSpecModule,
  type NormalizedTestPlanModule,
  type Operation,
  type SpecModule,
  type TestPlanModule,
} from "@tisyn/spec";

const fixtureSpec: SpecModule = spec({
  id: "wf-fixture",
  title: "Workflow Fixture",
  status: "active",
  relationships: [],
  sections: [
    section({
      id: 1,
      title: "Core",
      prose: "Prose.",
      rules: [rule({ id: "W1", level: "must", text: "Must do W1." })],
    }),
  ],
});

const fixturePlan: TestPlanModule = testPlan({
  id: "wf-fixture-plan",
  title: "Workflow Fixture Plan",
  validatesSpec: "wf-fixture",
  sections: [testPlanSection({ id: 1, title: "Cases", prose: "" })],
  categoriesSectionId: 1,
  categories: [
    testCategory({
      id: "CAT-W",
      title: "W cases",
      cases: [
        testCase({
          id: "T-W-001",
          priority: "p0",
          type: "unit",
          specRef: "§1",
          assertion: "W1 holds.",
        }),
      ],
    }),
  ],
  coverageMatrix: [
    coverageEntry({ rule: "W1", testIds: ["T-W-001"], status: "covered" }),
  ],
});

// Direct composition: workflow bodies are `function* (input) { const r =
// yield* acquireCorpusRegistry(...); return assemble(...); }`. We exercise
// each workflow by calling `createAcquire` against an in-memory manifest —
// no published workflow module import is needed to assert the W1/W2/W3 gate.

function* buildCorpusRegistry() {
  const api = createAcquire({
    manifest: [
      {
        id: "wf-fixture",
        loadSpec: () => Promise.resolve(fixtureSpec),
        loadPlan: () => Promise.resolve(fixturePlan),
      },
    ],
  });
  return yield* api.acquireCorpusRegistry();
}

describe("SS-WF workflow composition", () => {
  it("authoring context reaches assemble via acquire", function* (): Operation<void> {
    const registry = yield* buildCorpusRegistry();
    const ctx = assembleAuthoringContext(registry, { targetSpec: "wf-fixture" });
    expect(ctx.task).toBe("authoring");
    expect(ctx.scopeKind).toBe("full");
    expect(ctx.targetSpec).toBe("wf-fixture");
  });

  it("amendment context preserves scopeKind from filtered acquire", function* (): Operation<void> {
    const api = createAcquire({
      manifest: [
        {
          id: "wf-fixture",
          loadSpec: () => Promise.resolve(fixtureSpec),
          loadPlan: () => Promise.resolve(fixturePlan),
        },
      ],
    });
    const registry = yield* api.acquireCorpusRegistry({ specIds: ["wf-fixture"] });
    const ctx = assembleAmendmentContext(registry, { targetSpec: "wf-fixture" });
    expect(ctx.task).toBe("amendment");
    expect(ctx.scopeKind).toBe("filtered");
    expect(ctx.targetSpec).toBe("wf-fixture");
  });

  it("review / test-plan / consistency contexts expose typed task fields", function* (): Operation<void> {
    const registry = yield* buildCorpusRegistry();
    const review = assembleReviewContext(registry, { targetSpec: "wf-fixture" });
    const tp = assembleTestPlanContext(registry, { targetSpec: "wf-fixture" });
    const cc = assembleConsistencyContext(registry);
    expect(review.task).toBe("review");
    expect(tp.task).toBe("test-plan");
    expect(cc.task).toBe("consistency");
  });

  it("normalizes the shipped corpus cleanly", function* (): Operation<void> {
    const spec = normalizeSpec(fixtureSpec);
    const plan = normalizeTestPlan(fixturePlan);
    expect(spec.status).toBe("ok");
    expect(plan.status).toBe("ok");
    if (spec.status !== "ok" || plan.status !== "ok") return;
    const registry = buildRegistry(
      [spec.value as NormalizedSpecModule, plan.value as NormalizedTestPlanModule],
      { kind: "full" },
    );
    expect(registry.specs.has("wf-fixture")).toBe(true);
  });
});
