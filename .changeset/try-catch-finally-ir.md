---
"@tisyn/ir": minor
---

Add `TryNode` / `TryShape` to the Tisyn IR type system. New `Try()` constructor builds a `{ tisyn: "eval", id: "try", data: Q({...}) }` node. `foldStructural` handles the `"try"` case. `classify` counts try nodes. `print` renders `try { … } catch (e) { … } finally { … }` DSL syntax. `isStructural` recognises `"try"`. Public exports updated.
