---
"@tisyn/ir": minor
---

Add `ScopeNode` and `ScopeShape` types for the blocking scope IR construct.

- Add `ScopeShape` interface (`handler: FnNode | null`, `bindings: Record<string, RefNode>`, `body: TisynExpr`) and `ScopeNode` type to the IR type system
- Add `"scope"` to `COMPOUND_EXTERNAL_IDS` so `isCompoundExternal("scope")` returns `true`
- Export `ScopeNode` and `ScopeShape` from the package index
- Fix `printCompoundExternal` to handle scope's `{handler, bindings, body}` shape (previously only handled `{exprs}` for `all`/`race`)
