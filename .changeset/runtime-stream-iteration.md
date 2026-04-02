---
"@tisyn/runtime": minor
---

Handle `stream.subscribe` and `stream.next` standard external effects in the execution loop.

- `stream.subscribe` creates an Effection subscription and returns a deterministic capability handle (`sub:{coroutineId}:{counter}`)
- `stream.next` iterates the subscription, returning `{ done, value }` results
- Stream-aware dispatch added to all three dispatch sites: main driveKernel, resource init, and resource cleanup
- Capability enforcement: RV1 rejects cross-coroutine handle use, RV2 rejects handles in non-stream effect data, RV3 rejects handles in any coroutine close value
- Replay caches source definitions during `stream.subscribe` replay; lazy subscription reconstruction at the live frontier
