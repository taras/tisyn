/**
 * Codex adapter types.
 *
 * Contract types are imported from @tisyn/code-agent.
 * Config types are Codex-specific.
 */

import type { SessionHandle, PromptResult, ForkData } from "@tisyn/code-agent";

export type { SessionHandle, PromptResult, ForkData };

export interface CodexSdkConfig {
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approval?: "on-request" | "never";
  cwd?: string;
  env?: Record<string, string>;
}

export interface CodexExecConfig {
  command?: string;
  arguments?: string[];
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approval?: "on-request" | "never";
  cwd?: string;
  env?: Record<string, string>;
}
