Topic to revisit: Case A `while` lowering should preserve per-iteration bindings

Current problem:

- non-returning `while` loops are lowered through Case A to `While(condition, exprs)`
- Case A currently compiles the body as independent sibling expressions
- `const` bindings created earlier in the loop body are therefore not visible to later statements in the same iteration
- the multi-agent chat demo works around this by adding `if (false) { return; }` to force Case B (`Fn + Call`) lowering

Desired fix:

- keep Case A for loops with no real `return`
- compile the loop body as a single composite expression chain per iteration, instead of an array of independently emitted statements
- preserve bindings within one iteration without leaking them across iterations

Likely implementation direction:

- in `packages/compiler/src/emit.ts`, change Case A `while` lowering to use the normal statement-list emitter for the full loop body
- emit `While(condition, [bodyExpr])` where `bodyExpr` is a `Let`/`If`/`Seq` chain for the whole iteration
- keep Case B only for true return-bearing loops

Regression coverage to add:

- compiler test for a non-returning loop with local bindings referenced later in the same iteration
- demo workflow should compile without the dummy `if (false) { return; }` block
- existing Case B tests must continue to pass unchanged
