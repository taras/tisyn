---
"@tisyn/compiler": minor
---

Compile `yield* spawn(function*() { ... })` and `yield* task` (join).

- `yield* spawn(fn)` lowers to `SpawnEval(bodyExpr)`; `yield* task` lowers to `JoinEval(Ref("task"))`
- Scope-aware spawn-handle tracking via `BindingInfo.isSpawnHandle` / `isForbiddenCapture`
- Enforce SP1 (generator arg), SP2 (const binding), SP4 (handle expression restriction), SP11 (parent handle not capturable)
- Add `SpawnEval` and `JoinEval` IR builders; add `"Spawn"` and `"Join"` to codegen constructor list
