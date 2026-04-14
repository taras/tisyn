// Agent declarations for the tisyn-cli corpus verification pipeline.
//
// `claude-code` mirrors the declaration used by
// packages/claude-code/src/claude-code.test.ts so `installRemoteAgent`
// resolves against the same operation set as production. `output` is a
// local single-operation agent used for workflow observation
// (`output.log`) — live-only, never journaled. `filesystem` is a
// pilot-local read-only agent whose binding enforces a strict two-file
// allowlist over the frozen `__fixtures__` directory.

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
