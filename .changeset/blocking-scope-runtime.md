---
"@tisyn/runtime": minor
---

Add `orchestrateScope` for blocking scope execution.

- New `orchestrateScope` runs a scope's body inside Effection's `scoped()`, providing lifecycle-bounded transport connections, enforcement middleware, and `BoundAgentsContext` registration
- For each `bindings` entry, calls `installAgentTransport(prefix, factory)` — identical teardown semantics to authored `useTransport()` placed inside a `scoped()` block
- If a `handler` FnNode is present, installs it via `installEnforcement` so all dispatch inside the body flows through the compiled middleware
- Unified `childSpawnCount` counter covers `all`, `race`, and `scope` children for replay-safe IDs (e.g. sequential scopes under `root` get `root.0`, `root.1`; a scope after `All([a,b])` gets `root.2`)
- Scope errors are routed through `kernel.throw()` so the parent workflow's `try/catch` can intercept them (T14)
