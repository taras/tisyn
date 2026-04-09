---
"@tisyn/claude-code": minor
"@tisyn/transport": patch
---

Extract Claude Code ACP integration into dedicated `@tisyn/claude-code` package. Remove `./claude-code` subpath export from `@tisyn/transport`. The mock transport helper replaces manual `createScope()` lifetime with proper resource-scoped `spawn()`.
