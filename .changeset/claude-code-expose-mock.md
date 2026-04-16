---
"@tisyn/claude-code": minor
---

Expose `createMockClaudeCodeTransport` (and its `MockClaudeCodeConfig` / `MockOperationConfig` types) from the package root so cross-package test harnesses can drive the Claude Code ACP agent without touching internal deep paths. Previously the mock was a test-only internal of this package; it is now a first-class test-helper surface consumers can import via `@tisyn/claude-code`.
