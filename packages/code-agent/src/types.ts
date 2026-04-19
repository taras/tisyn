/**
 * Portable contract types for the CodeAgent contract.
 *
 * These types define the workflow-visible surface shared by all
 * conforming CodeAgent adapters. Backend-specific extensions
 * (e.g., PlanResult.toolResults) belong in adapter profile packages.
 */

// ── Contract result/handle types ──

export interface SessionHandle {
  sessionId: string;
}

export interface PromptResult {
  response: string;
}

export interface ForkData {
  parentSessionId: string;
  forkId: string;
}

// ── Operation parameter types ──

export interface NewSessionConfig {
  model?: string;
}

export interface PromptArgs {
  session: SessionHandle;
  prompt: string;
}
