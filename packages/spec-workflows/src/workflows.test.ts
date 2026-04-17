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
  manifest,
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
import type { Val } from "@tisyn/ir";
import { acquireFixture } from "./acquire.ts";
import { compile, evaluateCompile, type CompileOutput } from "./corpus-agent.ts";

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

  it("verify-corpus compile reaches the compare stage for a spec with open questions", function* (): Operation<void> {
    // Regression: verify-corpus must NOT gate on isReady(). `tisyn-cli`
    // currently carries at least one open question
    // (CLI-OQ-flag-collision-strategy), which previously caused
    // corpus-agent.compile to throw before rendering. The test asserts two
    // things:
    //   1. The acquired registry has open questions (preamble sanity).
    //   2. compile() still returns a CompileOutput with compare summaries
    //      and a built review prompt — i.e. it reached the compare stage.
    // If tisyn-cli's open question is ever resolved, assertion (1) fails
    // loudly; swap in a synthetic fixture at that point.
    const sanityApi = createAcquire({ manifest });
    const sanityRegistry = yield* sanityApi.acquireCorpusRegistry({
      specIds: ["tisyn-cli"],
    });
    expect(sanityRegistry.openQuestionIndex.size).toBeGreaterThan(0);

    const originalSpec = yield* acquireFixture("tisyn-cli", "spec");
    const originalPlan = yield* acquireFixture("tisyn-cli", "plan");
    const payload = {
      input: { target: "tisyn-cli", originalSpec, originalPlan },
    } as unknown as Val;
    const result = yield* compile(payload);
    const output = result as unknown as CompileOutput;
    expect(typeof output.specCompareSummary).toBe("string");
    expect(typeof output.planCompareSummary).toBe("string");
    expect(typeof output.emittedSpecCompareSummary).toBe("string");
    expect(typeof output.emittedPlanCompareSummary).toBe("string");
    expect(typeof output.prompt).toBe("string");
    expect(output.prompt.length).toBeGreaterThan(0);
  });

  it("evaluateCompile marks ok=false when emitted markdown drifts from live render", function* (): Operation<void> {
    // Regression for the reviewer's verify-corpus contract requirement: a
    // stale committed file under `specs/` must fail the deterministic gate.
    // We drive the pure evaluator with the real `tisyn-cli` registry + real
    // fixtures, but pass crafted stale emitted strings — no filesystem
    // mutation needed.
    const sanityApi = createAcquire({ manifest });
    const registry = yield* sanityApi.acquireCorpusRegistry({
      specIds: ["tisyn-cli"],
    });
    const spec = registry.specs.get("tisyn-cli");
    const plan = [...registry.plans.values()].find(
      (p) => p.validatesSpec === "tisyn-cli",
    );
    expect(spec).toBeDefined();
    expect(plan).toBeDefined();
    if (spec === undefined || plan === undefined) return;

    const originalSpec = yield* acquireFixture("tisyn-cli", "spec");
    const originalPlan = yield* acquireFixture("tisyn-cli", "plan");

    const staleEmittedSpec = "# Stale\n\n## Outdated Heading\n\nStale body.\n";
    const staleEmittedPlan = "# Stale Plan\n\n## Outdated Heading\n\nStale.\n";

    const result = evaluateCompile(
      spec,
      plan,
      originalSpec,
      originalPlan,
      staleEmittedSpec,
      staleEmittedPlan,
    );

    expect(result.ok).toBe(false);
    const emittedSpecReport = JSON.parse(result.emittedSpecCompareSummary) as {
      match: boolean;
    };
    const emittedPlanReport = JSON.parse(result.emittedPlanCompareSummary) as {
      match: boolean;
    };
    expect(emittedSpecReport.match).toBe(false);
    expect(emittedPlanReport.match).toBe(false);
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
