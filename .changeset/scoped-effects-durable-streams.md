---
"@tisyn/durable-streams": minor
---

Add `ReplayIndex.getStart()` to support `StartEvent` replay validation.

- `ReplayIndex` now indexes `StartEvent` entries alongside `YieldEvent` and `CloseEvent`
- New `getStart(coroutineId)` method returns the stored `StartEvent` for a coroutine, or `undefined` if none was recorded
