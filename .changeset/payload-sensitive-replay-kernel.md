---
"@tisyn/kernel": minor
---

Payload-sensitive replay support: `EffectDescription` gains optional `input` and `sha` fields, and two new helpers — `payloadSha(value)` computes `bytesToHex(sha256(utf8(canonical(value))))` (isomorphic Node + browser via `@noble/hashes`); `payloadIdentity(value)` returns `{ input, sha }` derived from a single canonical snapshot, guaranteeing the pair stays self-consistent under in-place mutation of the original value.

**Breaking pre-1.0:** `YieldEvent.description` now carries `input` and `sha` for all payload-sensitive effects. Stored journal entries that omit `sha` for payload-sensitive effects now raise `DivergenceError` on replay (no legacy compatibility path). The two non-canonicalizable runtime-direct effects — `stream.subscribe` and `__config` — continue to omit both fields per scoped-effects spec §9.5.8.

Adds `@noble/hashes` dependency.
