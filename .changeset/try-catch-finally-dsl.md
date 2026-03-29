---
"@tisyn/dsl": minor
---

Add `try` parsing and round-trip support to the Constructor DSL. The parser recognises `try { … } catch (e) { … } finally { … }` syntax (catch-only, finally-only, and catch+finally forms) and lowers it to `TryNode` IR. `print` renders the node back to the same syntax, completing the round-trip.
