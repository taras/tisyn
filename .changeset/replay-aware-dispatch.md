---
"@tisyn/effects": minor
"@tisyn/runtime": minor
---

**BREAKING:** Workflow replay is now structural: user middleware
installed via `Effects.around` re-executes on replay, while
framework handlers and core dispatch do not re-execute when the
journal already records a result for that dispatch. Max-priority
middleware sees the stored result returned from `next()`; the
live handler (`Agents.use`, `installAgentTransport`,
`installRemoteAgent`, `implementAgent(...).install`) fires only
once per dispatch across the original run and any replays.
Short-circuiting max frames yield to the stored cursor at chain
exit (the stored result wins over the short-circuit value).
Resource init and resource cleanup dispatches traverse the same
replay boundary as ordinary coroutine dispatch; middleware around
a resource-body dispatch now receives a `DispatchContext` with
`ctx.invoke` capability using the resource child's allocator.

For `@tisyn/effects`, this release also covers the middleware
composition substrate from #128: three lanes (`max` / internal
`replay` / `min`) declared on the `Effects` dispatch API, a
non-stable `installReplayDispatch` on
`@tisyn/effects/internal` for workspace-internal use, and
`Effects.around` narrowed to `{ at: "max" | "min" }` at both the
type and runtime layers. Consumers of the public `Effects.around`
see no surface change; internal workspace code now uses the
`replay` lane to position the runtime boundary.

Callers that were relying on the previous pre-dispatch replay
short-circuit (where `Effects.around` middleware did not re-run
on replay) will observe their middleware bodies running again on
replay. Middleware that should execute on every dispatch —
including replay — is in the right position already. Middleware
that should NOT re-run on replay can move to `{ at: "min" }`,
which places it below the replay boundary.
