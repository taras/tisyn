---
"@tisyn/runtime": patch
---

Replace the separate enforcement path in `orchestrateScope()` with ordinary `Effects.around()` middleware. Cross-boundary middleware is now installed as the first max-priority `Effects.around()` before transport bindings so parent constraints remain outermost through normal scope inheritance. Runtime no longer mutates or depends on `BoundAgentsContext`.
