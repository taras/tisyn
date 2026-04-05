---
"@tisyn/runtime": patch
---

Replace `installEnforcement()` with `Effects.around()` in `orchestrateScope()`. Cross-boundary middleware is now installed as the first max-priority `Effects.around()` before transport bindings. Use `BoundAgentsContext.expect()` and `.set()` instead of manual scope access.
