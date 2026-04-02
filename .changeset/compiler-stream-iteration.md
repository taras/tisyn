---
"@tisyn/compiler": minor
---

Compile authored `for (const x of yield* each(expr)) { ... }` stream iteration form to IR.

- `emitForOfEach` validates the constrained form: `const` binding, no destructuring, `yield* each()` iterable, no `break`/`continue`, no nesting
- Lowers to recursive `Fn+Call` IR with `stream.subscribe` and `stream.next` standard external effects
- Case A (simple): no return, no carried state — direct recursive loop
- Case B (carried state/return): outer `let` variables threaded through `Fn` params and `Call` args, mirrors `emitWhileCaseB` pattern
- Six new error codes E-STREAM-001 through E-STREAM-006 reject invalid `each()` usage in all expression positions
