---
"@tisyn/claude-code": minor
---

Add dedicated package for driving Claude Code from Tisyn workflows.

- Workflows can open, plan, fork, and close Claude Code sessions through two adapter paths: ACP stdio transport and the `@anthropic-ai/claude-agent-sdk` TypeScript API
- Session lifecycle types (`SessionHandle`, `PlanResult`, `ForkData`) are published for use in authored workflow signatures
- When a Claude Code subprocess dies, the binding surfaces exit code and stderr instead of a generic transport error
