---
"@tisyn/conformance": minor
---

Replay fixtures now carry `input` and `sha` on payload-sensitive effects, matching the runtime's new journal output. The conformance harness's existing strict canonical-byte comparison (`journalMatches`) rejects fixtures whose `expected_journal` description omits `sha` for a payload-sensitive effect — a stale-fixture regression test (`RD-PD-097`) was added to confirm.

**Breaking pre-1.0:** consumers with custom fixtures must update each `expected_journal` description for payload-sensitive effects to include `input` (the canonicalizable JSON payload from the `descriptor.data`) and `sha` (compute via `payloadSha` from `@tisyn/kernel`). Fixtures for `stream.subscribe` or `__config` keep `{ type, name }` only.
