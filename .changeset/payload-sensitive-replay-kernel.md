---
"@tisyn/kernel": minor
---

Payload-sensitive replay support: `EffectDescription` gains optional `input` and `sha` fields, and a new `payloadSha(value)` helper computes `bytesToHex(sha256(utf8(canonical(value))))` (isomorphic Node + browser via `@noble/hashes`).

**Breaking pre-1.0:** `YieldEvent.description` now carries `input` and `sha` for all payload-sensitive effects. Stored journal entries that omit `sha` for payload-sensitive effects now raise `DivergenceError` on replay (no legacy compatibility path). The two non-canonicalizable runtime-direct effects — `stream.subscribe` and `__config` — continue to omit both fields per scoped-effects spec §9.5.8.

Adds `@noble/hashes` dependency.
