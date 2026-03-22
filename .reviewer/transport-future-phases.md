Topic to revisit: transport future phases

Expected transport sequence after Phase 1:

1. Real wire transports
- `stdio`
- `websocket`

2. Richer protocol/session behavior
- opt-in progress forwarding
- stronger cancel behavior across all backends
- reconnect as fresh session

3. Additional bindings
- `worker`
- `SSE + POST`

4. Hardening
- multiplexing multiple agents over one connection/session
- transport reuse and pooling
- observability and backpressure

Specific follow-ups to preserve:

- real runtime-derived `taskId` / `executionId`
- protocol adapter tests in `@tisyn/runtime` and possibly `@tisyn/agent`
- integration with `@tisyn/validate` at the transport/protocol boundary

Why:

- current transport planning uses temporary transport-local IDs
- protocol package exists, but adapter behavior is not implemented on `main`
- boundary validation should happen before protocol-driven execution of untrusted input
