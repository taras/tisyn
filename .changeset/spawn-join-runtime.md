---
"@tisyn/runtime": minor
---

Orchestrate `spawn` and `join` compound-external operations in the runtime.

- Spawn creates a background Effection task with `withResolvers` for join waiting
- Join validates task handle shape, checks double-join, and waits for child completion
- `scoped()` wrapper binds spawned children to the parent's lifetime — torn down when parent exits
- Child failure propagates via Effection structured concurrency
