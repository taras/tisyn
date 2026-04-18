---
"@tisyn/code-agent": minor
---

Workflows can now declare code-agent sessions against one shared portable
surface. The new `@tisyn/code-agent` package publishes the `CodeAgent`
contract — five operations (`newSession`, `closeSession`, `prompt`,
`fork`, `openFork`), shared session/result types (`SessionHandle`,
`PromptResult`, `ForkData`), and a published mock harness — so Claude
Code, Codex, and future adapters can be driven through the same authored
operations without redefining their own session or result shapes.
