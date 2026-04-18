---
"@tisyn/codex": minor
---

Workflows can now drive OpenAI Codex through the new `@tisyn/codex`
package. `createSdkBinding()` is a conforming core-tier `CodeAgent`
adapter over `@openai/codex-sdk`: `newSession`, `prompt`,
`closeSession`, and cancellation are validated; per-thread conversation
history is maintained by the SDK. `createExecBinding()` wraps
`codex exec --json` as an explicit non-conforming one-shot utility for
self-contained prompts — each call spawns a fresh subprocess with no
conversation history. Fork and resume remain unsupported until the
remaining SDK API questions are resolved.
