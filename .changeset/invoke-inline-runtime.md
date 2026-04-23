---
"@tisyn/runtime": minor
---

Implement inline invocation: workflow authors' dispatch middleware
can call the new `invokeInline(fn, args, opts?)` helper from
`@tisyn/effects` to evaluate a compiled `Fn` under the caller's
effective coroutine identity and scope. Long-lived resources
acquired inside the inline body remain live until the caller's
own scope teardown, so multi-step workflows (browser smoke tests,
session-bound flows) can keep pages, connections, and handles
alive across step boundaries — which `invoke` does not permit.

Inline-body effects traverse the caller's scoped-effects
middleware chain and are durably journaled on a per-call inline
journal lane (`${callerCoroutineId}@inline${q}.${j}`). The unified
child allocator is not advanced by `invokeInline` itself; any
spawn/invoke/resource/timebox/all/race yielded inside the inline
body consume from the caller's allocator exactly as if they
appeared at the caller's program point. Nested `invokeInline`
from within inline-lane dispatch is rejected per spec §5.3.1.a.

Replay semantics (scoped-effects §9.5): middleware re-executes
identically on every run — original, pure replay, and crash
recovery. External agent side effects do not re-fire because the
runtime installs a per-dispatch `RuntimeTerminalBoundary` via
`RuntimeTerminal.with(...)` that substitutes stored results at
`runAsTerminal(...)` delegation sites. Inline bodies' compound
externals (`resource`, `spawn`, `invoke`, `timebox`,
`stream.subscribe`) re-spawn their child driveKernels on replay;
those children replay from their own cursors; live host state
(resource teardown callbacks, spawned task joins, subscription
entries, allocator counters) rebuilds naturally. This makes the
motivating browser/session/resource-continuity use case work
across recovery, not just same-run.

Replay is payload-sensitive: the runtime computes
`payloadSha(descriptor.data)` at every YieldEvent-write site and
stores it as `description.sha`. The divergence check at replay
compares type + name + sha; mismatch raises `DivergenceError` with
both stored and current hashes in the message. This prevents
middleware that branches on payload from silently rebuilding
divergent live state (e.g., opening a session for URL B while
replay substitutes the stored handle for URL A). Legacy journals
written before `description.sha` existed fall back to type + name
matching per scoped-effects §9.5's legacy-compat rule. `payloadSha`
is imported from `@tisyn/kernel` — no `node:crypto` reference in
`@tisyn/runtime`; browser consumers (e.g.
`packages/transport/src/transports/browser-executor.ts`) continue
to build and run.

Internals: `driveKernel` is refactored to extract a `FrameState`
record and a shared `iterateFrame` helper; the caller's own cursor
and each inline lane cursor are processed via the same iteration
logic, partitioned by the journal-lane id stored in
`YieldEvent.coroutineId`. The pre-dispatch stored-yield
short-circuit is removed; the replay check moves into the
per-dispatch `RuntimeTerminalBoundary` closure. Close-event
writing becomes idempotent via `appendCloseEvent` — on replay of a
child whose Close is already durable, the event is pushed to
`ctx.journal` for re-materialization only and the stream is not
re-appended. All existing `driveKernel` behaviors (divergence,
spawn/scope/resource/timebox orchestration, error propagation)
are preserved.
