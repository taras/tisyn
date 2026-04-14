// Agent declarations for the tisyn-cli corpus verification pipeline.
//
// `claude-code` mirrors the declaration used by
// packages/claude-code/src/claude-code.test.ts so `installRemoteAgent`
// resolves against the same operation set as production. `output` is a
// local single-operation agent used for workflow observation
// (`output.log`) — live-only, never journaled. `filesystem` is a
// pilot-local read-only agent whose binding enforces a strict two-file
// allowlist over the frozen `__fixtures__` directory. `corpus` owns
// the tisyn-cli structured-spec pipeline (normalize → registry →
// readiness → render → compare → buildReviewPrompt → parseVerdict) —
// the workflow body calls `Corpus().compile(...)` + `Corpus().checkVerdict(...)`
// through ambient contracts rather than importing the `@tisyn/spec`
// library directly, because the `tsn run` compile-on-the-fly path
// (Rule 3 in `packages/cli/src/load-descriptor.ts`) walks all relative
// TS imports and the `@tisyn/spec` source graph uses enums and
// re-export barrels the compiler does not support. Agent handlers are
// loaded via `tsx/esm/api` at runtime, so the `corpus` binding is free
// to import the full library + corpus surface without going through
// the compiler.

import { agent, operation } from "@tisyn/agent";
import type { Val } from "@tisyn/ir";

export const claudeCodeDeclaration = agent("claude-code", {
  newSession: operation<Val, Val>(),
  closeSession: operation<Val, Val>(),
  plan: operation<Val, Val>(),
  fork: operation<Val, Val>(),
  openFork: operation<Val, Val>(),
});

export const outputDeclaration = agent("output", {
  log: operation<Val, Val>(),
});

export const filesystemDeclaration = agent("filesystem", {
  readFile: operation<Val, Val>(),
});

export const corpusDeclaration = agent("corpus", {
  compile: operation<Val, Val>(),
  checkVerdict: operation<Val, Val>(),
});
