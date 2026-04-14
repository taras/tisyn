// Single-file workflow descriptor AND body for the corpus
// verification pipeline. One file holds the authored generator
// body (`verifyCorpus`), the ambient `declare function` contracts
// it dispatches through, and the default-exported workflow
// descriptor that wires in the agent bindings and journal.
//
// Entrypoint:
//   pnpm exec tsn run packages/spec/workflows/verify-corpus.ts \
//     --target <name> [--skip-claude] [-e debug]
//
// Why one file is safe. The CLI's compile-on-the-fly loader
// (Rule 3 in `packages/cli/src/load-descriptor.ts`) runs the
// compiler's reachability sweep from the named entrypoint
// (`verifyCorpus`) via its call graph, not from the module's
// top-level:
//   - `packages/compiler/src/reachability.ts:139` — `findCallTargets`
//     walks the AST of the specific function body named by the
//     `run.export`, not the whole module.
//   - `packages/compiler/src/reachability.ts:185-196` —
//     `E-IMPORT-001` only fires against reachable bare-specifier
//     value imports, so the `@tisyn/config` imports below are
//     invisible to `verifyCorpus`'s call graph and do not trip
//     the rule.
//   - `packages/compiler/src/graph.ts:221-229` — graph traversal
//     only recurses into relative `.ts` imports; bare specifiers
//     become boundary modules that the walker never re-enters.
// Net effect: the `workflow(...)` / `agent(...)` /
// `transport.inprocess(...)` / `journal.file(...)` /
// `entrypoint(...)` / `env(...)` calls in the default export live
// in a top-level expression that `verifyCorpus`'s body never
// touches. The one-file shape compiles cleanly.
//
// **Future-edit rule.** `verifyCorpus`'s body must never call
// `workflow(...)` / `agent(...)` / `transport.inprocess(...)` /
// `journal.file(...)` / `journal.memory()` / `entrypoint(...)` /
// `env(...)` — those are wiring helpers whose bare-specifier
// value imports trip `E-IMPORT-001` the instant they become
// reachable via the call graph. Keep descriptor helpers and
// generator code in strictly separate lexical scopes within this
// module.
//
// The workflow's input type `{ target: string; skipClaude?: boolean }`
// is surfaced as CLI flags automatically by
// `packages/cli/src/inputs.ts` (`--target <value>` for the
// required string field, `--skip-claude` for the optional boolean).
//
// Targeting. `input.target` is threaded through every binding
// call so the pipeline can be retargeted by supplying a different
// `--target` flag. The target name is resolved against per-binding
// registries (`TARGET_FIXTURES` in `filesystem-agent.ts`, `TARGETS`
// in `corpus-agent.ts`); adding a new target later is one row in
// each registry, nothing in this file.
//
// Parameter names in the ambient contracts matter: the compiler
// wraps each single argument as `{ <paramName>: <value> }` before
// emitting the ExternalEval. Handlers in `filesystem-agent.ts`,
// `output-agent.ts`, and `corpus-agent.ts` therefore destructure
// `{ input }`. The claude-code SDK adapter
// (`packages/claude-code/src/sdk-adapter.ts:96-102`) unwraps using
// the parameter names `config`, `handle`, and `args`, so the
// ClaudeCode contract below uses those exact names.
//
// Contract: success-or-throw. Every failure stage throws via
// `throw new Error(...)`, the only throw form the compiler accepts
// (`packages/compiler/src/emit.ts:3243-3259`). `tsn run` propagates
// uncaught errors as nonzero exit codes, so the operator-visible
// stdout stream comes entirely from the `output` agent's log lines.
//
// Debug journal. The default run uses `journal.memory()` so there
// are zero filesystem side effects. The named `debug` entrypoint
// swaps in `journal.file(env("TISYN_VERIFY_CORPUS_JOURNAL",
// "./.debug/verify-corpus.ndjson"))` so `-e debug` persists a
// replay trace to `packages/spec/workflows/.debug/verify-corpus.ndjson`
// (or the env-overridden path). The env var only controls *where*
// the debug journal goes; `-e debug` is the activation handle. The
// `env(name, default)` form is the optional-env constructor
// exported by `@tisyn/config` — there is no `env.optional(...)`.
//
// Replay warning. The debug entrypoint uses a file-backed journal,
// which means prior persisted events at the configured path MAY be
// replayed on the next run. Remove the file (or change the path
// via `TISYN_VERIFY_CORPUS_JOURNAL`) before spawning the workflow
// if you want a fresh run. The e2e tests already do this via
// `rmSync(debugJournalPath, { force: true })` before every spawn
// (see `verify-corpus.e2e.test.ts`). At runtime, the workflow's
// Step 0 reads the resolved journal from the runtime's
// ConfigContext via `yield* Config.useConfig(JournalToken)` and
// prints a `── journal ──` block on stdout announcing the active
// mode and (for the file backend) the resolved path, so operators
// see the live state instead of having to infer it from `-e debug`.

import type { Workflow } from "@tisyn/agent";
import {
  type ConfigToken,
  agent,
  entrypoint,
  env,
  journal,
  transport,
  workflow,
} from "@tisyn/config";

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

// `Config.useConfig(JournalToken)` is the compiler-recognized
// intrinsic that reads the post-overlay / post-rebase /
// post-env-resolution ResolvedConfig from the runtime's
// ConfigContext. See `packages/compiler/src/emit.ts:3362-3387`
// for the lowering site and `packages/runtime/src/execute.ts:591-592`
// for the runtime dispatch. Both `Config` and `JournalToken` are
// ambient `declare const`s — they have no runtime emission and
// never become reachable bare-specifier value imports.
declare const Config: {
  useConfig<T>(token: ConfigToken<T>): Generator<unknown, T, unknown>;
};

// Discriminated union on `journal.kind` so TS narrows `path` to
// `string` after a `kind === "file"` check. The runtime guarantees
// `path` is set whenever `kind === "file"` — `createJournalStream`
// in `packages/cli/src/startup.ts` throws a CliError if a file
// journal is wired up without a resolved path — so the narrowing
// matches production behavior and the body needs no fallback.
declare const JournalToken: ConfigToken<{
  journal: { kind: "memory" } | { kind: "file"; path: string };
}>;

export function* verifyCorpus(input: { target: string; skipClaude?: boolean }) {
  // Step 0 — announce the resolved journal mode so the operator
  // knows whether replay is active and where events are landing.
  // The read flows through `Config.useConfig` (compiler intrinsic)
  // rather than guessing based on `input.skipClaude` or `-e debug`.
  const cfg = yield* Config.useConfig(JournalToken);
  if (cfg.journal.kind === "file") {
    yield* Output().log({
      label: "journal",
      text: `File-backed journal at ${cfg.journal.path}.
Replay is ENABLED — if events already exist at this path from a
prior run, they MAY be reused. Remove the file (or change the
path via TISYN_VERIFY_CORPUS_JOURNAL) to force a fresh run.`,
    });
  } else {
    yield* Output().log({
      label: "journal",
      text: `In-memory journal. Replay is DISABLED — no persisted
events will be reused, and each run starts from a clean slate.`,
    });
  }

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

export default workflow({
  run: {
    export: "verifyCorpus",
    module: "./verify-corpus.ts",
  },
  agents: [
    agent("filesystem", transport.inprocess("./filesystem-agent.ts")),
    agent("output", transport.inprocess("./output-agent.ts")),
    agent("corpus", transport.inprocess("./corpus-agent.ts")),
    agent("claude-code", transport.inprocess("./claude-code-binding.ts")),
  ],
  journal: journal.memory(),
  entrypoints: {
    debug: entrypoint({
      journal: journal.file(env("TISYN_VERIFY_CORPUS_JOURNAL", "./.debug/verify-corpus.ndjson")),
    }),
  },
});
