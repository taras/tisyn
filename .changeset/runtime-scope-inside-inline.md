---
"@tisyn/runtime": minor
---

`scope` inside an `invokeInline` body now creates an ordinary child scope (own Effection scope, own bindings, own handler middleware, own `CloseEvent` under `laneId.{m}`) instead of throwing. The scope child uses its own coroutineId for both journal and owner identity; the inline lane itself still produces no `CloseEvent`. Closes #136.
