# Test Plan: Return in Try/Catch — Compiler Lowering

**Spec reference:** Compiler Specification §6.7.1
**Test level:** IR emission (`compileOne` → structural assertion on output)
**Scope:** Outcome packing activation, structural invariants, dispatch, finally interaction, SSA joins, continuation suppression, negative cases

---

## Categories

| ID | Category | Count |
|----|----------|-------|
| A | Packing activation | 3 |
| B | Packed outcome structure | 3 |
| C | Dispatch behavior | 3 |
| D | Finally interaction | 5 |
| E | SSA join propagation | 4 |
| F | `alwaysTerminates` integration | 3 |
| G | Nested control flow | 3 |
| H | Negative cases | 2 |
| | **Total** | **26** |

---

## A — Packing Activation

### A01: Return in try activates packing

```typescript
function* f(): Workflow<number> {
  try { return 1; } catch (e) { /* fallthrough */ }
  return 0;
}
```

**Expected:** Try node's body is a `Construct` with `__tag` field. Post-try IR contains an `If(Eq(Get(..., "__tag"), "return"), ...)` dispatch.
**Invariant:** §6.7.1.1 — packing activates when `blockContainsReturn(tryBlock)` is true.

### A02: Return in catch activates packing

```typescript
function* f(): Workflow<string> {
  try { yield* Agent().op(); } catch (e) { return "err"; }
  return "ok";
}
```

**Expected:** Try node's catch body is a `Construct` with `__tag: "return"`. Body produces a `Construct` with `__tag: "fallthrough"`. Post-try dispatch present.
**Invariant:** §6.7.1.1 — packing activates when `blockContainsReturn(catchBlock)` is true.

### A03: No return — packing inactive

```typescript
function* f(): Workflow<number> {
  let x = 0;
  try { x = 1; } catch (e) { x = 2; }
  return x;
}
```

**Expected:** Try node's body and catch body contain no `Construct` with `__tag`. Post-try IR is a `Let`/`Ref` join — no `If(Eq(..., "__tag"), ...)` dispatch.
**Invariant:** CR1 — packing MUST NOT activate when no return is present. Output identical to pre-feature behavior.

---

## B — Packed Outcome Structure

### B01: Return path includes __tag, __value, no join vars

```typescript
function* f(): Workflow<number> {
  try { return 1; } catch (e) { /* fallthrough */ }
  return 0;
}
```

**Expected:** Body `Construct` has `__tag: "return"` and `__value: 1`. Catch `Construct` has `__tag: "fallthrough"` and a `__value` field. Both variants have exactly the same set of field names. Neither has fields beyond `__tag` and `__value` (J_bc is empty).
**Invariant:** I5 — empty J_bc still requires `__tag` and `__value`. I2 — both variants share the same field set.

### B02: Packed outcomes include join variables

```typescript
function* f(): Workflow<number> {
  let x = 0;
  try { x = 1; return x; } catch (e) { x = 2; }
  return x;
}
```

**Expected:** Body `Construct` has fields `__tag`, `__value`, and `x`. Catch `Construct` has fields `__tag`, `__value`, and `x`. Both variants have identical field name sets. The `x` field is keyed by source name (not SSA-versioned name). Body's `__value` is a Ref to the same SSA version as its `x` field.
**Invariant:** I2 — identical join variable field set in both variants. I3 — join vars keyed by source name.

### B03: Multiple join variables packed

```typescript
function* f(): Workflow<number> {
  let x = 0;
  let y = 10;
  try { x = 1; y = 11; return x; } catch (e) { x = 2; y = 12; }
  return y;
}
```

**Expected:** Both `Construct` nodes contain fields `__tag`, `__value`, `x`, and `y`. Field name sets are identical across body and catch variants.
**Invariant:** I2 — field set is J_bc = {x, y} on both paths.

---

## C — Dispatch Behavior

### C01: Return suppresses continuation

```typescript
function* f(): Workflow<number> {
  try { return 1; } catch (e) { /* fallthrough */ }
  return 99;
}
```

**Expected:** Post-try dispatch `If` has a then-branch extracting `__value` and an else-branch containing the continuation (`99`). At runtime with no error: result is `1`, not `99`.
**Invariant:** CR5 — `"return"` tag suppresses continuation.

### C02: Fallthrough continues execution

```typescript
function* f(): Workflow<string> {
  try { yield* Agent().op(); } catch (e) { return "caught"; }
  return "continued";
}
```

**Expected:** When body succeeds (no throw), body produces `__tag: "fallthrough"`. Dispatch else-branch evaluates. At runtime with successful body: result is `"continued"`.
**Invariant:** §6.7.1.4 — `"fallthrough"` tag reaches else-branch.

### C03: Fallthrough extracts join vars before rest

```typescript
function* f(): Workflow<number> {
  let x = 0;
  try { x = 1; } catch (e) { x = 2; return x; }
  return x;
}
```

**Expected:** Dispatch else-branch extracts the `x` field from the packed result via `Get` and rebinds it before the continuation executes. At runtime with successful body: result is `1`.
**Invariant:** §6.7.1.4 — fallthrough continuation must extract join variables from packed result.

---

## D — Finally Interaction

### D01: Finally executes with return in body — result not replaced

```typescript
function* f(): Workflow<number> {
  try { return 1; } catch (e) { /* fallthrough */ } finally { yield* Agent().cleanup(); }
  return 0;
}
```

**Expected:** Try node has a `finally` field containing the cleanup effect. At runtime: cleanup effect is dispatched (confirming execution), and the workflow result is `1` — not the cleanup effect's return value.
**Invariant:** F1 — finally always executes. F2 — finally cannot override return. F3 — finally result discarded (the cleanup effect returns a value to the kernel, but the packed outcome survives because the kernel discards the finally result).

### D02: Finally throw overrides return

```typescript
function* f(): Workflow<number> {
  try { return 1; } catch (e) { /* fallthrough */ } finally { throw new Error("fail"); }
  return 0;
}
```

**Expected:** Try node's `finally` field contains a `Throw`. At runtime: error propagates; dispatch never reached; result is an error with message `"fail"`.
**Invariant:** F4 — finally throw replaces packed outcome.

### D03: finallyPayload with packing — struct-shaped unpack

```typescript
function* f(): Workflow<number> {
  let x = 0;
  try { x = 1; return x; } catch (e) { x = 2; } finally { x; }
  return x;
}
```

**Expected:** Try node has a `finallyPayload` field (a non-empty string). The finally body contains an inner Try whose catch-clause fallback is a `Construct` node (not a bare `Ref`). Join variable extraction from the inner Try result uses `Get`-based field access, not direct scalar binding.
**Invariant:** F5 — single-var shortcut MUST NOT be used under packing. Inner Try fallback must be struct-shaped.

### D04: Non-packing finallyPayload uses scalar shortcut (contrast)

```typescript
function* f(): Workflow<number> {
  let x = 0;
  try { x = 1; } finally { x; }
  return x;
}
```

**Expected (no packing):** `finallyPayload` present. Finally unpack uses scalar shortcut — inner Try catch-clause fallback is a bare `Ref` (the pre-trial SSA name), not a `Construct`. **Contrast with D03** where packing forces `Get`-based extraction from a struct-shaped fallback.
**Invariant:** Phase B — the packing/non-packing split in finally unpack is observable.

### D05: Multiple join vars + finally + packing

```typescript
function* f(): Workflow<number> {
  let x = 0;
  let y = 10;
  try { x = 1; y = 11; return x; } catch (e) { x = 2; y = 12; } finally { x; y; }
  return y;
}
```

**Expected:** `finallyPayload` present. Inner Try catch-clause fallback is a `Construct` containing fields `x` and `y` (pre-trial SSA refs). Join variables are extracted from the inner Try result using `Get`-based field access for both `x` and `y`.
**Invariant:** F5 — struct-shaped unpack for all J_bc sizes ≥ 1 under packing.

---

## E — SSA Join Propagation

### E01: Body assigns and returns — catch assigns and falls through

```typescript
function* f(): Workflow<number> {
  let x = 0;
  try { x = 1; return x; } catch (e) { x = 2; }
  return x;
}
```

**Expected:** At runtime — body succeeds: result `1`. Body throws: result `2` (via fallthrough + join extraction + `return x`).
**Invariant:** CR4 — fallthrough path sees correct post-join SSA version.

### E02: Catch assigns and returns — body falls through

```typescript
function* f(): Workflow<number> {
  let x = 0;
  try { x = 1; } catch (e) { x = 2; return x; }
  return x;
}
```

**Expected:** At runtime — body succeeds: result `1` (via fallthrough → join → `return x`). Body throws: result `2` (via catch return).
**Invariant:** CR4 — both return and fallthrough paths carry correct join var values.

### E03: Join vars visible in finally via finallyPayload

```typescript
function* f(): Workflow<number> {
  let x = 0;
  try { x = 5; return x; } catch (e) { x = 6; } finally { yield* Agent().observe(x); }
  return x;
}
```

**Expected:** `Agent().observe` receives `5` when body succeeds (finallyPayload unpacks `x` from the packed struct). Receives `6` when body throws and catch runs.
**Invariant:** CR4 — inside `finally`, join variables visible at post-join SSA versions via `finallyPayload` unpack chain.

### E04: Return value independent of join vars

```typescript
function* f(): Workflow<string> {
  let x = 0;
  try { x = 1; return "hello"; } catch (e) { x = 2; }
  return "world";
}
```

**Expected:** Body `Construct` has `__value: "hello"` and a separate `x` field (a Ref, not `"hello"`). At runtime with no error: result is `"hello"`.
**Invariant:** §6.7.1.3 — `__value` carries the authored return value; join vars are separate fields.

---

## F — `alwaysTerminates` Integration

### F01: Both clauses always return — direct extraction

```typescript
function* f(): Workflow<number> {
  try { return 1; } catch (e) { return 2; }
}
```

**Expected:** Post-try consumer extracts `__value` directly — no dispatch `If` with `__tag` comparison. Clause bodies still produce `Construct` nodes with `__tag` and `__value` fields.
**Invariant:** §6.7.1.4 always-return case — dispatch `If` may be omitted. Clause bodies MUST still pack.

### F02: Try always returns, catch absent

```typescript
function* f(): Workflow<number> {
  try { return 1; } finally { yield* Agent().cleanup(); }
}
```

**Expected:** Packing is active (body has return). No catch clause. Post-try consumer may use direct extraction. Finally runs.
**Invariant:** §6.7.1.6 row "Returns | (absent)" — body return on normal exit, throw propagates.

### F03: Try always returns, catch may fall through

```typescript
function* f(): Workflow<number> {
  try { return 1; } catch (e) { /* fallthrough */ }
  return 0;
}
```

**Expected:** Full dispatch `If` present (catch can produce `"fallthrough"`). Body always produces `"return"`, catch always produces `"fallthrough"`.
**Invariant:** §6.7.1.4 — dispatch required when at least one path is not always-return.

---

## G — Nested Control Flow

### G01: Return inside if branch within try

```typescript
function* f(x: number): Workflow<string> {
  try {
    if (x > 0) { return "positive"; }
  } catch (e) { return "error"; }
  return "non-positive";
}
```

**Expected:** Try body is an `If` node. Its then-branch produces a `Construct` with `__tag: "return"`. Its else-branch produces a `Construct` with `__tag: "fallthrough"`. Both branches have identical field name sets. Packing mode activated by `blockContainsReturn` traversing the `if`.
**Invariant:** §6.7.1.1 — traversal descends into nested `if`. I1 — all normal exits packed.

### G02: Return inside nested try within try

```typescript
function* f(): Workflow<number> {
  try {
    try { return 1; } catch (e2) { /* inner catch */ }
  } catch (e) { return 2; }
  return 0;
}
```

**Expected:** Packing mode active for outer try (`blockContainsReturn` traverses nested try and finds inner return). Inner try is itself compiled with packing mode (its own body has return). Outer try's body produces a packed outcome. Outer dispatch present.
**Invariant:** §6.7.1.1 — traversal descends into nested `try` blocks. Packing composes: each level packs independently.

### G03: Return inside while within try

```typescript
function* f(): Workflow<number> {
  try {
    let x = 0;
    while (x < 10) {
      if (x === 5) { return x; }
      x = x + 1;
    }
  } catch (e) { /* fallthrough */ }
  return 0;
}
```

**Expected:** Packing mode active for try (`blockContainsReturn` traverses while body). The while loop uses Case B (Fn + Call) internally. The try body's overall result is a packed `Construct`.
**Invariant:** §6.7.1.1 — traversal descends into `while`. While-loop Case B return and try-level packing compose.

---

## H — Negative Cases

### H01: Return in finally — E033

```typescript
function* f(): Workflow<number> {
  try { yield* Agent().op(); } catch (e) { /* ok */ } finally { return 1; }
}
```

**Expected:** Compile error E033.
**Invariant:** §6.7.1.1 — E033 for `blockContainsReturn(finallyBlock)`.

### H02: Return in nested function body not detected

```typescript
function* f(): Workflow<number> {
  try {
    const g = function* (): Workflow<number> { return 99; };
  } catch (e) { /* ok */ }
  return 0;
}
```

**Expected:** No packing mode activation. The `return 99` is inside a nested generator function body. `blockContainsReturn` excludes it. Output uses standard Phase A lowering — no `Construct` with `__tag`, no dispatch.
**Invariant:** §6.7.1.1 — nested function bodies excluded from traversal. The inner generator's `return` belongs to `g`, not to `f`.

---

## Coverage Matrix

| Invariant | Tests |
|-----------|-------|
| §6.7.1.1 activation | A01, A02, A03, G01, G02, G03, H01, H02 |
| I1 all exits packed | B01, B02, B03, G01 |
| I2 field set parity | B01, B02, B03, G01 |
| I3 source-level names | B02, B03 |
| I4 kernel-opaque | (structural — verified by absence of kernel changes in all tests) |
| I5 empty J_bc packing | B01, C01 |
| §6.7.1.4 dispatch | C01, C02, C03, F01, F03 |
| §6.7.1.4 always-return | F01, F02 |
| F1 finally executes | D01, D05 |
| F2 finally no override | D01 |
| F3 finally discard | D01 |
| F4 finally throw | D02 |
| F5 finallyPayload struct | D03, D04, D05 |
| F6 error-path fallback | D03, D04 |
| CR1 behavioral equivalence | A03 |
| CR4 SSA join correctness | E01, E02, E03, E04, C03 |
| CR5 continuation suppression | C01, C02, F03 |
| CR6 packing completeness | B01, B02, B03, G01 |
| E033 enforcement | H01 |

---

## Test Implementation Notes

**IR-level tests** (in `compiler.test.ts`): A01–A03, B01–B03, D03–D05, F01–F03, G01–G03, H01–H02. These call `compileOne(source)` and walk the returned IR tree asserting structural properties: presence/absence of `Construct` nodes with `__tag` fields, field name sets on packed outcomes, dispatch `If` shape, `finallyPayload` presence, inner Try fallback node type (`Construct` vs bare `Ref`).

**Runtime integration tests** (in `compiler-runtime.test.ts`): C01–C03, D01–D02, E01–E04. These call `compileOne(source)`, wrap in `Call`, execute via `execute()`, and assert on `result.value`. Tests that verify finally side effects (D01, E03) use `Dispatch.around` to capture dispatched effect arguments.

**Error tests** (in `compiler.test.ts`): H01. Calls `compileOne(source)` inside `expect(...).toThrow("E033")`.
