---
"@tisyn/runtime": minor
---

Replay matching is now payload-sensitive. Chain-dispatched delegated dispatch records and compares against the **post-max boundary descriptor** (so a max middleware that transforms `effectId` or `data` produces a journal entry reflecting the transformed request); chain-dispatched short-circuit and runtime-direct dispatch use the **source descriptor**. `stream.next` is payload-sensitive; `stream.subscribe` and `__config` are non-canonicalizable per the amended spec and continue to journal `{ type, name }` only.

**Breaking pre-1.0:**
- Workflows whose stored journals omit `sha` for payload-sensitive effects will fail replay with `DivergenceError`. Re-run the live execution to rebuild the journal under the new shape.
- `Effects.around` no longer intercepts the runtime-direct effects `__config`, `stream.subscribe`, or `stream.next` — they bypass the user-facing Effects chain per scoped-effects §3.1.1. Workflows that incidentally observed these effectIds in middleware logs will no longer see them.
- `__config` `YieldEvent`s now write `{ type, name }` only (no `input`, no `sha`); replay treats missing `sha` on stored `__config` entries as expected, mirroring `stream.subscribe`.

The motivating failure this resolves: a stored result for one input now correctly diverges instead of silently substituting against a different live input. See scoped-effects spec §9.5.3 / §9.5.5 / §9.5.8 / §9.5.10 and `RD-PD-031` / `RD-PD-091`.
