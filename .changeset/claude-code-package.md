---
"@tisyn/claude-code": minor
"@tisyn/transport": patch
---

Extract Claude Code ACP integration into dedicated `@tisyn/claude-code` package. Remove `./claude-code` subpath export from `@tisyn/transport`. The mock transport helper is moved to `@tisyn/transport/test-helpers`.
