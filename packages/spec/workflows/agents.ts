// Agent declarations for the tisyn-cli corpus verification pipeline.
//
// `claude-code` mirrors the declaration used by
// packages/claude-code/src/claude-code.test.ts so `installRemoteAgent`
// resolves against the same operation set as production. `output` is a
// local single-operation agent installed via `Agents.use` and used for
// workflow observation (`output.log`) — live-only, never journaled.

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
