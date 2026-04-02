---
"@tisyn/runtime": minor
---

Orchestrate `resource` and `provide` compound externals in the execution loop.

- `orchestrateResourceChild` manages init → provide → background → teardown lifecycle
- Parent blocks until child reaches `provide`, resumes with provided value
- Resource children torn down in reverse creation order on parent exit (R21)
- Child Close events precede parent Close events (R23)
- Init failure propagates to parent (catchable via try/catch)
- Cancellation writes exactly one `Close(cancelled)` per child via `ensure` handler
- Provided value is not journaled — recomputed on replay
