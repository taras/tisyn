---
"@tisyn/validate": minor
---

Add Level-2 semantic validation for `scope` eval nodes.

- Validate that `scope` data is a `Quote` node (same requirement as structural ops)
- Validate that `body` is present and not itself a `Quote` node (eval-position check)
- Validate that `handler` is `null` or a `Fn` node
- Validate that `bindings` is a plain object whose values are all `Ref` nodes
