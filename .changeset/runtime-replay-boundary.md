---
"@tisyn/runtime": minor
---

**BREAKING (pre-1.0):** Workflow replay is now structural. User
middleware installed via `Effects.around` re-executes on replay,
seeing the stored result returned from `next()`; framework
handlers (`Agents.use`, `implementAgent(...).install`,
`installAgentTransport`, `installRemoteAgent`) and core dispatch
do NOT re-execute when the journal already records a result for
that dispatch. Short-circuiting max frames yield to the stored
cursor at chain exit — the stored result wins over the
short-circuit value.

Resource init and resource cleanup dispatches traverse the same
replay-boundary-aware chain as ordinary coroutine dispatch.
Middleware around a resource-body dispatch now receives a
`DispatchContext` with `ctx.invoke` capability using the resource
child's allocator. The resource body's authored surface is
unchanged; only the middleware's observable surface expands.

Callers that were relying on the previous pre-dispatch replay
short-circuit — where `Effects.around` middleware did not re-run
on replay — will observe their middleware bodies running again on
replay. Middleware that should execute on every dispatch
(including replay) is already in the right position at
`{ at: "max" }` (the default) and no migration is required.
Middleware that should NOT re-run on replay can move to
`{ at: "min" }`, which places it below the replay-substitution
boundary and preserves the previous behavior.

The companion `@tisyn/effects` release provides the internal
three-lane composition substrate this behavior change uses.
