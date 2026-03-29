### 6.7 Try/Catch/Finally

**Supported authored forms:**

| Authored form | Constructor call |
|---|---|
| `try { B } catch (e) { C }` | `Try(B, "e", C)` |
| `try { B } finally { F }` | `Try(B, undefined, undefined, F)` |
| `try { B } catch (e) { C } finally { F }` | `Try(B, "e", C, F)` |

**Disallowed constructs (compile errors):**

| Condition | Code |
|---|---|
| `return` statement inside a `finally` clause | E033 |
| `catch {}` — catch clause with no binding parameter | E034 |
| Assignment to an outer `let` binding inside `finally` | E035 |

`return` inside `try` and `catch` clause bodies is permitted and handled via outcome packing (§6.7.1).

**SSA lowering — three phases:**

**Phase A: body/catch join (J_bc computation)**

The body and catch branches participate in a join following the same machinery as `if/else` (`compileBranchToExpr` / `applyJoinVersions`). Let `J_bc` = the set of outer variables whose SSA versions advanced in either branch.

When packing mode is inactive (§6.7.1), emit per the J_bc cases below. When packing mode is active, emit per §6.7.1.

- **J_bc empty:** Emit `Try(bodyExpr, catchParam?, catchBodyExpr?, finallyExpr?)` as a plain expression. No outer join `Let`-bindings needed.
- **J_bc = {x}, with catch:**
  ```
  Let(x_join, Try(bodyJoinExpr, catchParam, catchJoinExpr, finallyExpr?), rest())
  ```
- **J_bc = {x}, no catch (try/finally only):**
  ```
  Let(x_join, Try(bodyJoinExpr, undefined, undefined, finallyExpr), rest())
  ```
- **J_bc = {x, y, ...}, with catch:**
  ```
  Let(j, Try(bodyJoinExpr, catchParam, catchJoinExpr, finallyExpr?),
    Let(x_join, Get(Ref(j), "x"),
    Let(y_join, Get(Ref(j), "y"), rest())))
  ```
- **J_bc = {x, y, ...}, no catch (try/finally only):**
  ```
  Let(j, Try(bodyJoinExpr, undefined, undefined, finallyExpr),
    Let(x_join, Get(Ref(j), "x"),
    Let(y_join, Get(Ref(j), "y"), rest())))
  ```

`compileBranchToExpr` replaces the clause's natural result with the join terminal (`Ref(x)` for a single var, `Construct({x: Ref(x), y: Ref(y)})` for multiple). The natural result of the Try node is never used by the surrounding code (try is statement-only).

**Phase B: finally compilation**

Finally compilation depends on whether `J_bc` is empty or non-empty:

- **J_bc empty:** Compile `finally` in a clone of the current ctx (no join vars, no unpack needed). Pass as the fourth argument to `Try(...)`; no `finallyPayload`.

- **J_bc non-empty:** Compile `finally` in a clone of the **post-join ctx** (after `applyJoinVersions`). Generate a fresh name `fp` from the counter. Wrap the compiled finally body with a Let-chain that unpacks join vars from `Ref(fp)`:

  **When packing mode is inactive:**
  - Single join var `x` (post-join SSA name `x_N`): `Let("x_N", Try(Ref(fp), errFpName, Ref(x_pretrial)), compiledFinally)`
  - Multiple join vars `{x, y}` (post-join names `x_N`, `y_N`):
    ```
    Let(j_fp, Try(Ref(fp), errFpName, Construct({ x: Ref(x_pretrial), y: Ref(y_pretrial) })),
      Let(x_N, Get(Ref(j_fp), "x"),
      Let(y_N, Get(Ref(j_fp), "y"), compiledFinally)))
    ```

  **When packing mode is active:**
  The single-var shortcut (`Let(x_N, Ref(fp), ...)`) MUST NOT be used. Under packing, `fp` is bound to the packed struct, not to the scalar join value. The compiler MUST use the multi-var `Get`-based pattern for ALL `J_bc` sizes ≥ 1:
  - Single join var `x`:
    ```
    Let(j_fp, Try(Ref(fp), errFpName, Construct({ x: Ref(x_pretrial) })),
      Let(x_N, Get(Ref(j_fp), "x"), compiledFinally))
    ```
  - Multiple join vars `{x, y}`:
    ```
    Let(j_fp, Try(Ref(fp), errFpName, Construct({ x: Ref(x_pretrial), y: Ref(y_pretrial) })),
      Let(x_N, Get(Ref(j_fp), "x"),
      Let(y_N, Get(Ref(j_fp), "y"), compiledFinally)))
    ```

  The inner Try catch clause's fallback value MUST match the shape of the success-path value. Under packing, `fp` resolves to a struct on success, so the error-path fallback MUST also be a struct (using `Construct` with pre-trial SSA references). This ensures that the `Get`-based unpack chain works identically on both paths.

  Pass the wrapped expression as `finallyBody` and `fp` as `finallyPayload` in `Try(body, catchParam, catchBody, finallyBody, fp)`.

  The inner Try around `Ref(fp)` serves the error-path fallback: when the outcome is an error, `fp` is unbound, `Ref(fp)` raises `UnboundVariable` (which is catchable), and the inner Try catch clause substitutes pre-trial SSA references (wrapped in a `Construct` under packing mode). This preserves the kernel's functional immutable-env model.

**Phase C: dispatch (packing mode only)**

When packing mode is active, the compiler emits a dispatch expression after the `Try` node. See §6.7.1 for the required lowering.

**Known limitation (J_bc non-empty, uncaught error path):** When the try body throws without a catch (or the catch itself throws after updating state), the kernel's `outcome.ok` is false. In that case, `finallyPayload` is not bound and the finally body evaluates in the pre-try env, which may not reflect state changes made inside throwing Let-chains. This is a consequence of the kernel's functional immutable env model; no compiler transformation can recover intermediate env state from a throw without kernel-level env-snapshot support.

**emitTryStatement flow:**
1. If `blockContainsReturn(finallyBlock)` → emit E033.
2. Compute `needsPack = blockContainsReturn(tryBlock) || blockContainsReturn(catchClause?.block)`.
3. Check for catch without binding → E034 if present.
4. Scan `finally` for outer-binding assignments → E035 if found.
5. Dry-run body and catch in ctx clones; collect `J_bc`.
6. If `needsPack` is true, emit per §6.7.1. Otherwise emit per the J_bc cases above (finally compiled per Phase B).

**Journal equivalence:** source containing `try/catch/finally` produces identical journals to equivalent generator-level error handling, because no new event types are added and yieldIndex is monotonic across phase boundaries and does NOT reset. This property is preserved under packing mode: packing modifies only the data values flowing through the Try node, not the effect-dispatch or journaling behavior.

#### 6.7.1 Return in Try/Catch — Outcome Packing

##### 6.7.1.1 Activation

Packing mode MUST be activated when `blockContainsReturn` returns true for the `try` clause body or the `catch` clause body (or both).

`blockContainsReturn` traverses nested control-flow structures (`if`, `while`, `try`/`catch`, block statements) and returns true if any `return` statement is found at any depth. It MUST NOT descend into nested function bodies (function declarations, function expressions, arrow functions).

A `return` inside a `finally` clause MUST NOT activate packing mode. Such a `return` MUST produce compile error E033.

When packing mode is inactive, the compiler MUST emit the try statement using the existing Phase A / Phase B lowering rules. No `__tag`/`__value` wrapping is emitted.

##### 6.7.1.2 Packed Outcome Schema

When packing mode is active, every normal exit path from the `try` body and `catch` body MUST produce a packed outcome value. A packed outcome is a `Construct` node with the following fields:

| Field | Type | Description |
|---|---|---|
| `__tag` | `"return"` or `"fallthrough"` | Discriminant indicating exit kind |
| `__value` | Expr | The authored return value (`"return"` path) or the clause's natural join result (`"fallthrough"` path) |
| *join variables* | Expr (one per variable in `J_bc`) | Current SSA version of each join variable, keyed by source-level name |

**Invariants:**

I1. When packing mode is active, ALL normal (non-throwing) exit paths from the `try` body and `catch` body MUST produce packed outcomes. An exit path that does not produce a packed outcome is a compiler bug.

I2. Both `"return"` and `"fallthrough"` variants MUST include the same set of join variable fields. The field set is `J_bc`, even if `J_bc` is empty.

I3. Join variables MUST appear under their source-level names (e.g., `x`, not `x_1`). This is consistent with the existing join packing convention used for `if/else` multi-variable joins and while-loop carried-state packing.

I4. Packed values are plain IR values (`Construct` nodes producing JSON objects). The kernel evaluates them as ordinary expressions. No kernel awareness of the packing convention is required or permitted.

I5. When `J_bc` is empty, packed outcomes MUST still include `__tag` and `__value` fields. Join variable fields are absent (the set is empty).

##### 6.7.1.3 Clause Terminal Transformation

Under packing mode, each clause body is compiled with a transformed terminal:

**Return paths.** A `return expr` statement within the clause compiles to:

```
Construct({ __tag: "return", __value: ⟦expr⟧, v₁: Ref(v₁_current), ..., vₖ: Ref(vₖ_current) })
```

where `{v₁, ..., vₖ} = J_bc` and each `vᵢ_current` is the SSA-versioned name of `vᵢ` at the point of the `return` in that clause's compilation context.

A `return` with no expression compiles to `Construct({ __tag: "return", __value: null, ... })`.

**Fallthrough paths.** A clause body that completes without returning compiles with a terminal that produces:

```
Construct({ __tag: "fallthrough", __value: ⟦joinResult⟧, v₁: Ref(v₁_final), ..., vₖ: Ref(vₖ_final) })
```

where `joinResult` is the clause's natural result value (the expression that would have been the join terminal under non-packing mode), and each `vᵢ_final` is the SSA-versioned name of `vᵢ` at the end of the clause body.

**Mixed paths.** When a clause body contains both return and non-return paths (e.g., `if (cond) { return x } else { /* fallthrough */ }`), the compiler MUST ensure each path independently produces the correct packed outcome. Terminating branches produce `"return"`-tagged outcomes; non-terminating branches are compiled with the fallthrough terminal.

**Throw paths.** A `throw` statement within a clause is not a normal exit. It produces an error outcome that the kernel handles via its catch/finally phases. No packing is applied to throw paths.

##### 6.7.1.4 Post-Try Dispatch

After the `Try` node, the compiler MUST emit a dispatch expression that inspects the packed outcome's `__tag` field and either suppresses or continues the post-try continuation.

**Required pattern:**

```
Let(r, Try(bodyExpr, catchParam?, catchExpr?, finallyExpr?, fp?),
  If(Eq(Get(Ref(r), "__tag"), "return"),
    Get(Ref(r), "__value"),
    <fallthrough-continuation>))
```

**Continuation suppression.** When `Get(Ref(r), "__tag")` evaluates to `"return"`, the `If` takes the then-branch, which evaluates to `Get(Ref(r), "__value")`. The else-branch (containing the post-try continuation) is NOT evaluated. This is the same continuation-suppression mechanism used in while-loop Case B (§6.2).

**Fallthrough continuation.** When `Get(Ref(r), "__tag")` evaluates to `"fallthrough"`, the `If` takes the else-branch. The else-branch MUST:

1. Extract join variables from the packed result: `Let(vᵢ_join, Get(Ref(r), "vᵢ"), ...)` for each `vᵢ ∈ J_bc`.
2. Continue with `rest()` — the compilation of statements following the try statement.

When `J_bc` is empty, the fallthrough continuation is `rest()` directly (no join variable extraction).

**Evaluation ordering.** The dispatch `If` expression is evaluated after the `Try` node completes (including its finally phase). The kernel has already evaluated all three phases (body, catch, finally) and produced the packed outcome as the Try node's result. The dispatch operates on a data value, not a control-flow signal.

**Always-return case.** When `alwaysTerminates` is true for both the `try` body and the `catch` body, and every terminating path in both clauses is a `return` (not a `throw`), the `__tag` field is `"return"` on all normal exits. The compiler MAY omit the dispatch `If` and emit:

```
Let(r, Try(bodyExpr, catchParam?, catchExpr?, finallyExpr?, fp?),
  Get(Ref(r), "__value"))
```

The clause bodies MUST still produce packed outcomes with `__tag` and `__value` fields. Only the post-try consumer changes.

##### 6.7.1.5 Interaction with Finally

The following rules govern the interaction between packing mode and `finally` clauses:

F1. **Finally always executes.** The kernel guarantees that the `finally` body executes regardless of whether the body/catch outcome is a packed `"return"` value or a packed `"fallthrough"` value. This is a kernel invariant (Kernel Spec §5.16) that the compiler relies on but does not implement.

F2. **Finally cannot override return.** The kernel discards the `finally` body's result value (Kernel Spec §5.16: "Its return value is discarded"). The packed outcome from Phase 1–2 flows through to the dispatch expression unchanged. This is the mechanism by which `return` inside `try`/`catch` takes effect even when `finally` is present.

F3. **Finally result discarded — compiler dependency.** Packing mode is correct only because the kernel discards the `finally` result (Kernel Spec §5.16). If this kernel invariant were violated, the packed `__tag`/`__value` struct could be silently replaced, breaking continuation suppression.

F4. **Finally may throw and override prior outcome.** If the `finally` body raises an error, that error replaces the packed outcome (Kernel Spec §5.16). The dispatch expression is never reached. The error propagates normally.

F5. **`finallyPayload` receives packed struct.** When `J_bc` is non-empty and packing mode is active, the `finallyPayload` binding `fp` receives the packed struct as its value (the Try node's successful outcome). Because `fp` holds a struct rather than a scalar join value, the single-var unpack shortcut MUST NOT be used. The inner-Try unpack chain MUST use the `Get`-based pattern for all `J_bc` sizes (see Phase B). The inner Try's error-path fallback MUST produce a `Construct` wrapping pre-trial refs so that the `Get`-based extraction works identically on both success and error paths. Both `"return"` and `"fallthrough"` tagged values include the same join variable fields (I2), so the unpack chain operates identically on both.

F6. **Error-path fallback unchanged.** On the error path (body throws, no catch, or catch rethrows), `fp` is unbound. The existing inner-Try fallback mechanism (§6.7 Phase B) substitutes pre-trial SSA references. No change to this mechanism is required under packing mode.

##### 6.7.1.6 Mixed Return/Fallthrough Semantics

The following table defines the required observable behavior for each combination of clause exit kinds. "Returns" means `blockContainsReturn` is true for the clause; "falls through" means the clause completes without a `return`. In all cases, packing mode is active (at least one clause returns).

| Body | Catch | Observable behavior |
|---|---|---|
| Returns | Falls through | Body: `__tag: "return"`. Catch: `__tag: "fallthrough"`. Post-try dispatch selects based on which clause executed. |
| Falls through | Returns | Body: `__tag: "fallthrough"`. Catch: `__tag: "return"`. Post-try dispatch selects. |
| Returns | Returns | Both: `__tag: "return"`. Dispatch always suppresses continuation. |
| Falls through | Falls through | Packing mode is NOT active. No `__tag`/`__value` wrapping. Standard Phase A lowering applies. |
| Throws | Returns | Body error triggers catch. Catch: `__tag: "return"`. Post-try dispatch suppresses continuation. |
| Returns | Throws | Body: `__tag: "return"` if body succeeds. If body throws, catch throws — error propagates. |
| Returns | (absent) | Body: `__tag: "return"` on normal exit. Body throw propagates (no catch). Post-try dispatch suppresses continuation on normal exit. Fallthrough: impossible if body always returns; otherwise body produces `"fallthrough"` on non-return paths. |

When a `finally` clause is present: it executes after the body/catch outcome is determined (F1), its result is discarded (F3), and it may override the outcome by throwing (F4).

---

## §6.7 Compiler Lowering Rules

### `emitTryStatement` — Updated Flow

1. **E033 check:** If `blockContainsReturn(finallyBlock)` is true, emit compile error E033.

2. **Packing mode determination:** Compute `bodyHasReturn = blockContainsReturn(tryBlock)` and `catchHasReturn = blockContainsReturn(catchClause?.block)`. Set `needsPack = bodyHasReturn || catchHasReturn`.

3. **E034 check:** If catch clause is present and has no binding parameter, emit compile error E034.

4. **E035 check:** If `finally` clause contains assignment to an outer `let` binding, emit compile error E035.

5. **J_bc computation:** Dry-run body and catch in cloned contexts. Collect `J_bc` (the set of outer `let` variables whose SSA versions advanced in either branch).

6. **Emit:** If `needsPack` is false, emit per the existing Phase A / Phase B rules. If `needsPack` is true, emit per Phase A (with packed terminals), Phase B (finally compilation), and Phase C (dispatch).

### `compileBranchToExpr` — Packing Mode Extension

When packing mode is active, `compileBranchToExpr` MUST be extended (or a parallel function used) to produce packed outcomes instead of raw join terminals.

For a clause body compiled under packing mode, the fallthrough terminal MUST produce a `"fallthrough"`-tagged packed outcome. `return` statements encountered during statement-list compilation MUST produce `"return"`-tagged packed outcomes with `Construct({ __tag: "return", __value: retVal, ...joinVarRefs })`.

### `alwaysTerminates` — Try Statement Recognition

`alwaysTerminates` MUST recognize try statements. A `try/catch` statement always terminates if:

- Both the `try` body and the `catch` body always terminate (both contain return or throw on all paths), OR
- The `try` body always terminates via return/throw AND there is no catch clause (the body either succeeds with a return or throws — both are terminal).

This is required for correct branch analysis in enclosing `if` statements and loop bodies when a try-with-return is nested inside them.

### `blockContainsReturn` — Traversal Rules

`blockContainsReturn` MUST:

- Traverse nested `if`, `while`, `try/catch`, and block statements.
- Traverse nested `try` statements within `try`/`catch` clause bodies.
- NOT descend into nested function bodies (function declarations, function expressions, arrow functions).
- Return `true` if any `return` statement is found at any depth (subject to the function-body exclusion).

---

## §6.7 Static Restrictions — Error Code Updates

### E033 — Revised

**Previous definition:** `return` inside a `try`/`catch`/`finally` clause is not supported.

**Revised definition:** `return` inside a `finally` clause is not supported.

`return` inside `try` and `catch` clause bodies is now supported via outcome packing (§6.7.1). E033 MUST be raised only when `blockContainsReturn` returns true for a `finally` clause body.

The `return` inside `finally` restriction is a permanent design boundary, not a staged restriction. The kernel discards `finally` results (Kernel Spec §5.16). Supporting `return` in `finally` would require a new control-flow signal or kernel modification, both of which are outside the scope of this specification.

### E034 — Unchanged

`catch` clause requires a binding parameter. No change.

### E035 — Unchanged

Assignment to an outer `let` binding inside `finally` is not visible after the `try` statement. No change.

### §11 Error Table — Updated Row

| Construct                 | Code              | Error             |
| ------------------------- | ----------------- | ----------------- |
| `try` — `return` in `finally` | `return x` inside `finally` | E033 |

---

## §6.7 Conformance Requirements

### CR1. Behavioral Equivalence Without Return

When no `return` statement is present in `try` or `catch` clause bodies, the compiler MUST produce output identical to the output produced before packing mode support was added. Packing mode MUST NOT be activated and no `__tag`/`__value` fields MUST appear in the IR.

### CR2. Finally Execution Guarantee

When a `finally` clause is present and packing mode is active, the `finally` body MUST execute regardless of whether the body or catch clause produced a `"return"` or `"fallthrough"` outcome. This is a kernel invariant that the compiler relies on. Conformance tests MUST verify that side effects within `finally` are observable on all exit paths.

### CR3. Deterministic Replay Equivalence

Programs compiled with packing mode MUST produce identical journals under replay as under original execution. Packing modifies only the data values flowing through the Try node. No new event types, no new journal entries, and no changes to `yieldIndex` monotonicity are introduced.

### CR4. SSA Join Correctness

When packing mode is active and `J_bc` is non-empty:

- On a `"fallthrough"` path, the post-try code MUST see the correct post-join SSA versions (extracted from the packed struct).
- On a `"return"` path, join variable extraction MUST NOT occur (the continuation is suppressed).
- Inside `finally`, join variables MUST be visible at their post-join SSA versions via the `finallyPayload` unpack chain.

### CR5. Continuation Suppression Correctness

When a `"return"`-tagged outcome flows through the dispatch `If`, the post-try continuation (the else-branch) MUST NOT be evaluated. This MUST hold even when the try statement is followed by further statements in the enclosing function body.

### CR6. Packing Mode Completeness

When packing mode is active, every normal (non-throwing) exit path from both the `try` body and the `catch` body MUST produce a packed outcome with the correct `__tag`, `__value`, and join variable fields. A missing or malformed packed outcome on any exit path is a compiler bug.

---

## §6.7 Canonical Examples

### Example 1: Return in try, catch falls through

**Source:**

```typescript
function* f(): Workflow<number> {
  try {
    return 1;
  } catch (e) {
    // fallthrough
  }
  return 0;
}
```

**IR:**

```
Let(r_0, Try(
    Construct({ __tag: "return", __value: 1 }),
    "e",
    Construct({ __tag: "fallthrough", __value: null })),
  If(Eq(Get(Ref(r_0), "__tag"), "return"),
    Get(Ref(r_0), "__value"),
    0))
```

### Example 2: Return in catch, body falls through

**Source:**

```typescript
function* f(): Workflow<string> {
  try {
    yield* Agent().riskyOp();
  } catch (e) {
    return "recovered";
  }
  return "ok";
}
```

**IR:**

```
Let(r_0, Try(
    Let(discard_0, Eval("agent.riskyOp", []),
      Construct({ __tag: "fallthrough", __value: null })),
    "e",
    Construct({ __tag: "return", __value: "recovered" })),
  If(Eq(Get(Ref(r_0), "__tag"), "return"),
    Get(Ref(r_0), "__value"),
    "ok"))
```

### Example 3: Return with SSA join variables

**Source:**

```typescript
function* f(): Workflow<number> {
  let x = 0;
  try {
    x = 1;
    return x;
  } catch (e) {
    x = 2;
  }
  return x;
}
```

**IR:**

```
Let(x_0, 0,
  Let(r_0, Try(
      Let(x_1, 1,
        Construct({ __tag: "return", __value: Ref(x_1), x: Ref(x_1) })),
      "e",
      Let(x_1, 2,
        Construct({ __tag: "fallthrough", __value: null, x: Ref(x_1) }))),
    If(Eq(Get(Ref(r_0), "__tag"), "return"),
      Get(Ref(r_0), "__value"),
      Let(x_2, Get(Ref(r_0), "x"),
        Ref(x_2)))))
```

### Example 4: Return in try with finally

**Source:**

```typescript
function* f(): Workflow<number> {
  try {
    return 42;
  } catch (e) {
    // fallthrough
  } finally {
    yield* Agent().cleanup();
  }
  return 0;
}
```

**IR (simplified):**

```
Let(r_0, Try(
    Construct({ __tag: "return", __value: 42 }),
    "e",
    Construct({ __tag: "fallthrough", __value: null }),
    Eval("agent.cleanup", [])),
  If(Eq(Get(Ref(r_0), "__tag"), "return"),
    Get(Ref(r_0), "__value"),
    0))
```

The `finally` body (`Eval("agent.cleanup", [])`) executes after the body/catch outcome. Its result is discarded by the kernel. The packed outcome flows through to the dispatch.

### Example 5: Return with SSA join variables and finally

**Source:**

```typescript
function* f(): Workflow<number> {
  let x = 0;
  try {
    x = 1;
    return x;
  } catch (e) {
    x = 2;
  } finally {
    yield* Agent().observe(x);
  }
  return x;
}
```

**IR (key structure):**

```
Let(x_0, 0,
  Let(r_0, Try(
      Let(x_1, 1,
        Construct({ __tag: "return", __value: Ref(x_1), x: Ref(x_1) })),
      "e",
      Let(x_1, 2,
        Construct({ __tag: "fallthrough", __value: null, x: Ref(x_1) })),
      Let(j_fp, Try(Ref(fp_0), err_fp_0, Construct({ x: Ref(x_0) })),
        Let(x_2, Get(Ref(j_fp), "x"),
          Eval("agent.observe", [Ref(x_2)]))),
      "fp_0"),
    If(Eq(Get(Ref(r_0), "__tag"), "return"),
      Get(Ref(r_0), "__value"),
      Let(x_2, Get(Ref(r_0), "x"),
        Ref(x_2)))))
```

The `finallyPayload` `fp_0` receives the packed struct. The inner Try resolves `Ref(fp_0)` on the success path; on the error path (body throws, no catch), `fp_0` is unbound, so the inner Try's catch returns `Construct({ x: Ref(x_0) })` — the pre-trial value wrapped in a struct so the `Get`-based extraction works. The finally body then references `x_2` which holds the extracted join variable value.

### Example 6: Both clauses return

**Source:**

```typescript
function* f(): Workflow<number> {
  try {
    return 1;
  } catch (e) {
    return 2;
  }
}
```

Both clauses always terminate via `return`. The always-return case (§6.7.1.4) applies.

**IR:**

```
Let(r_0, Try(
    Construct({ __tag: "return", __value: 1 }),
    "e",
    Construct({ __tag: "return", __value: 2 })),
  Get(Ref(r_0), "__value"))
```

The full dispatch form (`If(Eq(Get(Ref(r_0), "__tag"), "return"), ..., ...)`) is also correct. The else-branch would be dead code in that case.

### Example 7: Return inside nested if within try

**Source:**

```typescript
function* f(x: number): Workflow<string> {
  try {
    if (x > 0) {
      return "positive";
    }
  } catch (e) {
    return "error";
  }
  return "non-positive";
}
```

**IR:**

```
Let(r_0, Try(
    If(Gt(Ref(x), 0),
      Construct({ __tag: "return", __value: "positive" }),
      Construct({ __tag: "fallthrough", __value: null })),
    "e",
    Construct({ __tag: "return", __value: "error" })),
  If(Eq(Get(Ref(r_0), "__tag"), "return"),
    Get(Ref(r_0), "__value"),
    "non-positive"))
```

---

*End of §6.7 Try Statements.*
