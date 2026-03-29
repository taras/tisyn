---
"@tisyn/runtime": minor
---

Add durable middleware input recording to `execute()`.

- `ExecuteOptions` gains an optional `middleware?: Val | null` field
- When provided, `execute()` writes a `StartEvent` to the journal before the first yield (live path) and validates the stored value matches on replay (divergence → error result)
