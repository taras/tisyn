---
"@tisyn/ir": minor
---

Add `resource` and `provide` as compound external node types.

- `ResourceShape`, `ResourceNode`, `ProvideNode` type definitions
- `Resource(body)` constructor wraps body in Quote (like `Spawn`)
- `Provide(value)` constructor leaves data unquoted (like `Join`)
- Print and decompile support for resource/provide nodes
- `"resource"` and `"provide"` added to `COMPOUND_EXTERNAL_IDS`
