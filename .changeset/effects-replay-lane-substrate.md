---
"@tisyn/effects": minor
---

**BREAKING (pre-1.0):** The `Effects` dispatch API now composes
through three middleware lanes instead of two. Public
`Effects.around({ at })` continues to accept only `"max"` and
`"min"`; an internal `replay` lane sits between them and is
reserved for the runtime's replay-substitution boundary. Passing
any other `{ at }` value through the public API — including
`{ at: "replay" as any }` via an unsafe cast — is rejected at
runtime with an error that does not name the internal lane.

A non-stable `installReplayDispatch` is exported on
`@tisyn/effects/internal` for workspace-internal consumers
(`@tisyn/runtime`) to install middleware into the replay lane
without exposing the lane name through any public surface.
`@tisyn/effects/internal` remains a non-stable workspace seam and
is NOT part of the package's compatibility contract.

No change to existing user-facing `Effects.around` / `dispatch` /
agent-binding behavior. Middleware installed at `{ at: "max" }`
still runs outermost and middleware at `{ at: "min" }` still runs
innermost, with the same append/prepend ordering. The change is
purely structural — it enables `@tisyn/runtime` to install a
replay-substitution frame between the max and min regions without
requiring user middleware to know that the lane exists.

This entry covers the substrate that shipped in PR #128 without
an accompanying changeset; the matching runtime behavior change
is in the paired `@tisyn/runtime` release.
