# @tisyn/ir

## 0.9.0

## 0.9.0

### Minor Changes

- 38d9ffc: Add `TimeboxShape`, `TimeboxNode`, and `Timebox` constructor. Add timebox cases in printer and decompiler.

## 0.8.0

## 0.7.0

### Minor Changes

- f074970: Add `resource` and `provide` as compound external node types.

  - `ResourceShape`, `ResourceNode`, `ProvideNode` type definitions
  - `Resource(body)` constructor wraps body in Quote (like `Spawn`)
  - `Provide(value)` constructor leaves data unquoted (like `Join`)
  - Print and decompile support for resource/provide nodes
  - `"resource"` and `"provide"` added to `COMPOUND_EXTERNAL_IDS`

## 0.6.0

## 0.5.2

## 0.5.1

## 0.5.0

### Minor Changes

- e71915d: Add `ScopeNode` and `ScopeShape` types for the blocking scope IR construct.

  - Add `ScopeShape` interface (`handler: FnNode | null`, `bindings: Record<string, RefNode>`, `body: TisynExpr`) and `ScopeNode` type to the IR type system
  - Add `"scope"` to `COMPOUND_EXTERNAL_IDS` so `isCompoundExternal("scope")` returns `true`
  - Export `ScopeNode` and `ScopeShape` from the package index
  - Fix `printCompoundExternal` to handle scope's `{handler, bindings, body}` shape (previously only handled `{exprs}` for `all`/`race`)

- 9786a15: Add `SpawnNode`, `JoinNode`, and `SpawnShape` types for the spawn/join IR construct.

  - Add `SpawnShape` interface (`body: TisynExpr`), `SpawnNode` type (Quote data), and `JoinNode` type (Ref data)
  - Add `Spawn()` and `Join()` typed constructors
  - Add `"spawn"` and `"join"` to `COMPOUND_EXTERNAL_IDS`
  - Add printer support for spawn/join in `printCompoundExternal` and `constructorName`

### Patch Changes

- d4a051a: Widen `ScopeShape.bindings` from `RefNode` to `TisynExpr`.

  Binding values in a scope node can now be any IR expression, not just a `RefNode`. This enables the compiler to lower `yield* useTransport(Contract, expr)` where `expr` is a property access, call, ternary, or any other expression.

## 0.4.0

## 0.3.0

### Minor Changes

- 4375b0a: Add `TryNode` / `TryShape` to the Tisyn IR type system. New `Try()` constructor builds a `{ tisyn: "eval", id: "try", data: Q({...}) }` node. `foldStructural` handles the `"try"` case. `classify` counts try nodes. `print` renders `try { … } catch (e) { … } finally { … }` DSL syntax. `isStructural` recognises `"try"`. Public exports updated.

## 0.2.0

### Minor Changes

- 3302f6a: Add the IR support needed for local-state authoring and structural spread lowering while
  keeping workflow state updates in immutable IR form.
- 5551c2d: Tighten `IrInput` and `Call()` typing, align `Eval()` with a single-payload canonical
  form, and improve `print()` so generated constructor output remains valid and
  round-trippable.
