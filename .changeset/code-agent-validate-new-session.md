---
"@tisyn/code-agent": minor
---

Adapters can now reject `newSession` payloads that carry keys other
than `model` at the contract boundary. New public export:
`validateNewSessionPayload(payload)` throws an `Error` with
`name === "InvalidPayload"` when the payload contains any unexpected
key, before any default-application logic runs.

Use this in any adapter that implements `code-agent.newSession`. The
declared payload shape `{ model?: string }` has no required field, so
without an explicit boundary check a wrapped payload like
`{ config: { model: "..." } }` would be silently tolerated.

Test plan CA-PAYLOAD-06 ("Wrapped payload rejected") restates the
expectation: `newSession` MUST surface `InvalidPayload` for unknown
keys; other operations rely on natural required-field failure.
