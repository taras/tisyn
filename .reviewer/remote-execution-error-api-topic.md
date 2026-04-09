Topic to revisit: remote execution error API

Current state:

- `executeRemote()` uses an ergonomic value-or-throw API.
- Failures are thrown as `Error` with `cause` set to the underlying `EventResult`.

Possible follow-up APIs:

1. Structured result-returning variant

- `executeRemoteResult(options): Operation<RemoteExecutionResult>`
- returns `{ status: "ok" | "error" | "cancelled", ... }`

2. Rich thrown error type

- `RemoteExecutionError extends Error`
- includes the full `EventResult` as structured data

When this matters:

- callers need programmatic branching on remote execution failures
- handlers need to distinguish runtime/application/cancelled cases cleanly
- transport or HTTP layers need stable error mapping

Current recommendation:

- keep `executeRemote()` as the ergonomic default
- consider `executeRemoteResult()` first if structured handling becomes common
