---
"@tisyn/kernel": minor
---

Add `payloadSha(data)` helper and optional `EffectDescription.sha` field
for payload-sensitive replay divergence detection per scoped-effects
§9.5. `payloadSha(v) = bytesToHex(sha256(utf8(canonical(v))))` — a
deterministic, isomorphic (Node + browser) SHA-256 fingerprint of the
canonical JSON serialization. Backed by `@noble/hashes` (new runtime
dependency) so `@tisyn/kernel` stays pure ESM and browser-safe — no
`node:crypto` path anywhere in the public surface.

`EffectDescription` now reads `{ type, name, sha? }`. The `sha` field
is optional for backward compatibility with journal entries written
before it existed; the runtime treats those as legacy entries and
skips the payload-fingerprint check for them per scoped-effects §9.5's
legacy-compat rule. New `YieldEvent`s written by `@tisyn/runtime`
always include `description.sha`.
