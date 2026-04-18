---
"@tisyn/claude-code": minor
---

Claude Code is now a `CodeAgent` adapter against the shared
`@tisyn/code-agent` contract. Session, prompt, and fork types
(`SessionHandle`, `PromptResult`, `ForkData`) are re-exported from the
shared package instead of being locally redefined, so workflows that
also drive Codex (or any future `CodeAgent` adapter) can pass the same
values between them. Adapters now publish `prompt` as a portable alias
for `plan` on the SDK, ACP, and mock paths; existing `plan` callers
continue to work unchanged. `PlanResult` extends the shared
`PromptResult` with Claude-specific `toolResults`.
