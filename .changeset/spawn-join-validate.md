---
"@tisyn/validate": minor
---

Add validation rules for `spawn` and `join` IR nodes.

- Spawn requires Quote data with a `body` field; body is an evaluation position
- Join requires Ref data (not Quote)
- Add `checkSpawnConstraints` and evaluation position entries for spawn/join
