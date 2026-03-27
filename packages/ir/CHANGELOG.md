# @tisyn/ir

## 0.2.0

### Minor Changes

- 3302f6a: Add the IR support needed for local-state authoring and structural spread lowering while
  keeping workflow state updates in immutable IR form.
- 5551c2d: Tighten `IrInput` and `Call()` typing, align `Eval()` with a single-payload canonical
  form, and improve `print()` so generated constructor output remains valid and
  round-trippable.
