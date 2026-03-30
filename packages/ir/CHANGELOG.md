# @tisyn/ir

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
