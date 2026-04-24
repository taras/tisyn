---
"@tisyn/transport": minor
---

**BREAKING:** `installRemoteAgent()` and `installAgentTransport()`
now register their dispatch middleware at `{ at: "min" }` (below
user middleware) instead of the default max priority. User-installed
`Effects.around` interceptors, including those installed after the
transport binding, continue to observe and can transform an outbound
dispatch before the transport routes the request — the change to
`min` makes the transport handler sit strictly below the
user-middleware region.

This prepares the ground for the replay-aware dispatch boundary
planned in #125, which will sit between max-priority user middleware
and min-priority framework handlers. No replay logic is introduced
yet.

`resolve` middleware (used by `useAgent` binding-probe) is **not**
moved — it remains at default priority. The single previous
`Effects.around({ dispatch, resolve })` registration in each
install entry point is now split into two separate `Effects.around`
calls so the priority change is scoped to dispatch only.

Callers that already install their own `{ at: "min" }` core handlers
downstream of `installRemoteAgent` / `installAgentTransport` should
note that two min-priority entries now coexist; relative ordering
between them follows registration order.
