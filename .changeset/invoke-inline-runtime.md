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

Internals: `driveKernel` is refactored to extract a `FrameState`
record and a shared `iterateFrame` helper; the caller's own cursor
and each inline lane cursor are processed via the same iteration
logic, partitioned by the journal-lane id stored in
`YieldEvent.coroutineId`. All existing `driveKernel` behaviors
(replay, divergence, spawn/scope/resource/timebox orchestration,
error propagation) are preserved bit-for-bit.
