/**
 * CodeAgent contract declaration.
 *
 * This is the portable agent declaration for session-oriented coding
 * agents. Workflows use this declaration to interact with coding agent
 * backends through a fixed set of typed operations.
 *
 * Concrete adapter packages (@tisyn/claude-code, @tisyn/codex, etc.)
 * implement this contract for specific backends.
 */

import type { OperationSpec } from "@tisyn/agent";
import { agent, operation } from "@tisyn/agent";
import type {
  SessionHandle,
  PromptResult,
  ForkData,
  NewSessionConfig,
  PromptArgs,
} from "./types.js";

type CodeAgentOps = {
  newSession: OperationSpec<NewSessionConfig, SessionHandle>;
  closeSession: OperationSpec<SessionHandle, null>;
  prompt: OperationSpec<PromptArgs, PromptResult>;
  fork: OperationSpec<SessionHandle, ForkData>;
  openFork: OperationSpec<ForkData, SessionHandle>;
};

export const CodeAgent = agent<CodeAgentOps>("code-agent", {
  newSession: operation<NewSessionConfig, SessionHandle>(),
  closeSession: operation<SessionHandle, null>(),
  prompt: operation<PromptArgs, PromptResult>(),
  fork: operation<SessionHandle, ForkData>(),
  openFork: operation<ForkData, SessionHandle>(),
});
