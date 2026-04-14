// Authored workflow body for the corpus verification pipeline. Pure
// dispatch — every library call (normalize, render, compare,
// buildReviewPrompt, parseVerdict) is owned by the `corpus` agent's
// binding, every file read is owned by the `filesystem` agent, and
// every user-visible log line is owned by the `output` agent.
//
// The body uses inline `declare function` ambient contracts — the
// canonical workflow-body shape the `tsn run` compile-on-the-fly path
// accepts (Rule 3 in `packages/cli/src/load-descriptor.ts`). Agent
// IDs are derived by `toAgentId` in `packages/compiler/src/agent-id.ts`
// (PascalCase → kebab-case): `Filesystem → "filesystem"`,
// `Output → "output"`, `Corpus → "corpus"`, `ClaudeCode → "claude-code"`.
//
// The body is target-driven: `input.target` is threaded through every
// binding call so the pipeline can be retargeted by supplying a
// different `--target` flag on `tsn run`. The target name is resolved
// against per-binding registries (`TARGET_FIXTURES` in
// `filesystem-agent.ts`, `TARGETS` in `corpus-agent.ts`); adding a new
// target later is one row in each registry, nothing in this file.
//
// Parameter names in the ambient contracts matter: the compiler wraps
// each single argument as `{ <paramName>: <value> }` before emitting
// the ExternalEval. Handlers in `filesystem-agent.ts`,
// `output-agent.ts`, and `corpus-agent.ts` therefore destructure
// `{ input }`. The claude-code SDK adapter (`packages/claude-code/src/
// sdk-adapter.ts:96-102`) unwraps using the parameter names `config`,
// `handle`, and `args`, so the ClaudeCode contract below uses those
// exact names.
//
// Contract: success-or-throw. Every failure stage throws via
// `throw new Error(...)`, the only throw form the compiler accepts
// (`packages/compiler/src/emit.ts:3243-3259`). `tsn run` propagates
// uncaught errors as nonzero exit codes, so the operator-visible
// stdout stream comes entirely from the `output` agent's log lines.

import type { Workflow } from "@tisyn/agent";

declare function Filesystem(): {
  readOriginal(input: { target: string; kind: "spec" | "plan" }): Workflow<{ content: string }>;
};

declare function Output(): {
  log(input: { label: string; text: string }): Workflow<void>;
};

declare function Corpus(): {
  compile(input: { target: string; originalSpec: string; originalPlan: string }): Workflow<{
    ok: boolean;
    summary: string;
    generatedSpec: string;
    generatedPlan: string;
    prompt: string;
  }>;
  checkVerdict(input: { response: string }): Workflow<{ pass: boolean }>;
};

declare function ClaudeCode(): {
  newSession(config: { model: string }): Workflow<{ sessionId: string }>;
  closeSession(handle: { sessionId: string }): Workflow<void>;
  plan(args: { session: { sessionId: string }; prompt: string }): Workflow<{ response: string }>;
};

export function* verifyCorpus(input: { target: string; skipClaude?: boolean }) {
  // Step 1 — read frozen originals via the filesystem agent.
  const originalSpec = yield* Filesystem().readOriginal({
    target: input.target,
    kind: "spec",
  });
  const originalPlan = yield* Filesystem().readOriginal({
    target: input.target,
    kind: "plan",
  });

  // Step 2 — normalize + render + compare (spec only) + build Claude
  // prompt. The corpus binding owns every call into `@tisyn/spec`
  // and throws on any structural-gate failure so the workflow only
  // sees a compare verdict on this path. The handwritten test plan
  // carries ~9 top-level prose sections that `TestPlanModule` cannot
  // express, so test-plan equivalence is verified exclusively by the
  // Claude semantic gate.
  const compiled = yield* Corpus().compile({
    target: input.target,
    originalSpec: originalSpec.content,
    originalPlan: originalPlan.content,
  });

  yield* Output().log({ label: "compare:spec", text: compiled.summary });
  yield* Output().log({
    label: "compare:plan",
    text: `SKIPPED — TestPlanModule cannot express the handwritten outer prose
sections (Purpose, Scope, ..., Implementation Readiness). Test-plan
equivalence is verified by the Claude semantic gate instead.`,
  });

  if (!compiled.ok) {
    throw new Error(`verify-corpus failed at compare: ${compiled.summary}`);
  }

  // Step 3 — Claude semantic gate (optional).
  if (input.skipClaude === true) {
    yield* Output().log({
      label: "skip-claude",
      text: "Deterministic gates passed; Claude gate skipped.",
    });
    return { ok: true, stage: "skipped-claude" };
  }

  const session = yield* ClaudeCode().newSession({ model: "claude-sonnet-4-6" });
  try {
    const plan = yield* ClaudeCode().plan({
      session,
      prompt: compiled.prompt,
    });
    yield* Output().log({ label: "claude:verdict", text: plan.response });
    const verdict = yield* Corpus().checkVerdict({ response: plan.response });
    if (verdict.pass) {
      return { ok: true, stage: "claude" };
    }
    throw new Error("verify-corpus failed at claude: verdict FAIL");
  } finally {
    yield* ClaudeCode().closeSession(session);
  }
}
