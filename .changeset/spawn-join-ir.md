---
"@tisyn/ir": minor
---

Add `SpawnNode`, `JoinNode`, and `SpawnShape` types for the spawn/join IR construct.

- Add `SpawnShape` interface (`body: TisynExpr`), `SpawnNode` type (Quote data), and `JoinNode` type (Ref data)
- Add `Spawn()` and `Join()` typed constructors
- Add `"spawn"` and `"join"` to `COMPOUND_EXTERNAL_IDS`
- Add printer support for spawn/join in `printCompoundExternal` and `constructorName`
