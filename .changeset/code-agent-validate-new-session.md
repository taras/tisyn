---
"@tisyn/code-agent": minor
---

Adapters can now enforce the full declared `newSession` payload
shape `{ model?: string }` at the contract boundary. New public
export: `validateNewSessionPayload(payload)` throws an `Error` with
`name === "InvalidPayload"` when the payload is not a plain object,
contains any key other than `model`, or carries `model` as a
non-string. The check runs before any default-application logic.

Use this in any adapter that implements `code-agent.newSession`. The
declared payload has no required field, so without an explicit
boundary check a malformed payload (wrapped `{ config: { model } }`,
non-object, array, wrong-typed `model`) would be silently tolerated.

Test plan CA-PAYLOAD-06 ("Wrapped payload rejected") restates the
expectation: `newSession` MUST surface `InvalidPayload` for unknown
keys; other operations rely on natural required-field failure.
