# Tisyn Compiler Specification

**Version:** 1.2.0
**Target:** Tisyn System Specification 1.0.0
**Status:** Normative

---

## 1. Overview

This document specifies a compiler that transforms a
restricted subset of TypeScript source modules into Tisyn
IR. The compiler accepts one or more root module paths,
constructs the static import graph reachable from those
roots, classifies each module, extracts and compiles
workflow-relevant symbols, and emits a compiled artifact.
Depending on the selected output format, the artifact is
either a generated TypeScript module or serialized IR.
The artifact contains compiled callable bindings for
workflows and helpers, reflects compiler-visible contract
metadata, and provides grouped exports.

### 1.1 Correctness Criterion

```
∀R: journal(interpret(compile(G), R)) = journal(run(G, R))
```

### 1.2 Guarantee Hierarchy

**Level 1 — Structural validity.** Output conforms to grammar, passes all validation rules. Always guaranteed.

**Level 2 — Scope consistency.** Every Ref bound by enclosing Let or Fn. Always guaranteed.

**Level 3 — Journal equivalence.** Guaranteed for source within the authoring subset.

---

## 2. Authoring Model

### 2.1 Allowed Constructs

| Construct       | Authoring form                             | IR                                       |
| --------------- | ------------------------------------------ | ---------------------------------------- |
| Effect          | `yield* Agent().method(args)`              | External Eval                            |
| Concurrency     | `yield* all([...])` / `yield* race([...])` | Compound Eval                            |
| Blocking scope  | `yield* scoped(function* () { ... })`      | Compound Eval (`id: "scope"`)            |
| Sleep           | `yield* sleep(ms)`                         | External Eval                            |
| Config access   | `yield* Config.useConfig(Token)`           | External Eval (`id: "__config"`)          |
| Stream iteration | `for (const x of yield* each(expr)) { ... }` | Recursive `Fn` + `Call` with `stream.subscribe` / `stream.next` |
| Sub-workflow    | `yield* otherWorkflow(args)`               | Inlined or `call`                        |
| Variable        | `const x = <expr>`                         | `let`                                    |
| `let` declaration | `let x = v`                              | SSA-versioned `let` binding (`x_0`)      |
| `let` reassignment | `x = e` (where `x` is `let`)           | Bumped SSA binding (`x_N`)               |
| Conditional     | `if / else`                                | `if`                                     |
| While           | `while (cond) { ... }`                     | `while` or recursive Fn                  |
| Return          | `return <expr>`                            | Final expression                         |
| Throw           | `throw new Error(msg)`                     | `throw`                                  |
| Try/catch/finally | `try { ... } catch (e) { ... } finally { ... }` | `try`                          |
| Property        | `obj.prop` / `obj["literal"]`              | `get`                                    |
| Arithmetic      | `+`, `-`, `*`, `/`, `%`, unary `-`         | `add`, `sub`, `mul`, `div`, `mod`, `neg` |
| Comparison      | `>`, `>=`, `<`, `<=`, `===`, `!==`         | `gt`, `gte`, `lt`, `lte`, `eq`, `neq`    |
| Logical         | `&&`, `\|\|`, `!`                          | `and`, `or`, `not`                       |
| String template | `` `hello ${name}` ``                      | `concat`                                 |
| Object literal  | `{ a: 1, b: x }`                           | `construct`                              |
| Array literal   | `[a, b, c]`                                | `array`                                  |
| Arrow function  | `(x) => pureExpr`                          | `fn`                                     |

### 2.2 Effects and the Durability Boundary

An **effect** is a `yield*` targeting an Agent method, `all`, `race`, `scoped`, `sleep`, `Config.useConfig(Token)`, `each(...)` in the accepted stream-iteration form, or a sub-workflow containing effects. Each agent method call produces one Yield event.

The accepted stream-iteration form is intentionally narrow: only `for (const x of yield* each(expr)) { ... }` is supported. The compiler lowers that form to a recursive loop using the standard external effect IDs `stream.subscribe` and `stream.next`. All other `for...of` usage remains rejected.

**Rule:** `yield*` MUST appear only in statement position — as the RHS of `const x = yield* ...` or as a bare statement. It MUST NOT appear in condition expressions, short-circuit operands, function arguments, or array/object literals.

### 2.3 Import Semantics

Imports define composition. Cross-module references to
helpers, workflows, and contracts are resolved through
explicit import/export bindings in the source graph.

The compiler MUST support:

- Named value imports with relative specifiers and explicit
  extensions, e.g. `import { x } from "./mod.ts"`.
- Type-only imports from any specifier. Type-only imports
  are forwarded to generated output and do not participate
  in workflow compilation.

The compiler MUST reject the following forms when they are
required by compiled code:

- Dynamic imports: `E-IMPORT-006`
- Import specifiers without file extensions: `E-IMPORT-002`
- Value imports from bare specifiers or `node:` modules:
  `E-IMPORT-001`
- Default imports, namespace imports, and re-exports:
  `E-IMPORT-007`

Bare specifiers and `node:` imports are graph boundaries.
The compiler does not resolve them and does not read the
target module.

---

## 3. Compilation Pipeline

### 3.1 Six Stages

```
Roots (.ts files)
  → [Graph Construction]
  → [Module Classification]
  → [Symbol Extraction]
  → [Reachability]
  → [Compilation]
  → [Emission]
  → Compiled artifact
```

**Stage 1 — Graph construction.** The compiler resolves
relative imports from the supplied roots, records boundary
modules, and builds a visited module graph.

**Stage 2 — Module classification.** Each module is
classified as one of:
`"workflow-implementation"`, `"contract-declaration"`,
`"generated"`, `"type-only"`, or `"external"`.

**Stage 3 — Symbol extraction.** The compiler records
export maps, function declarations, contract declarations,
and imported bindings relevant to workflow compilation.

**Stage 4 — Reachability.** Exported generator workflows
seed the reachable symbol closure. Cross-module helper and
workflow references resolve through the import/export graph.

**Stage 5 — Compilation.** Reachable generators and
qualified helpers compile to callable `Fn` bindings.
Unreachable extracted symbols are not compiled.

**Stage 6 — Emission.** Compiled bindings, compiler-visible
contract metadata, forwarded type-only imports, and runtime
imports for generated-module dependencies are assembled into
the emitted artifact.

### 3.2 Determinism

Same roots + same source contents + same options MUST
produce byte-identical output.

Module compilation order is lexicographic by resolved path.
A single monotonic counter spans the entire graph.
Counter-derived synthetic names are assigned in compilation
order. JSON output MUST use canonical key ordering.

### 3.3 Naming

Exported symbols keep their source names. Non-exported
symbols use deterministic compiler-generated names that are
collision-free and stable across recompilation for the same
graph. User variables MUST NOT start with `__`.

---

## 4. The `yield*` Desugaring

### 4.1 Three Cases

| Case         | Target                        | IR                            |
| ------------ | ----------------------------- | ----------------------------- |
| Agent effect | `yield* Agent().method(args)` | External Eval (unquoted data) |
| Concurrency  | `yield* all/race([...])`      | Compound Eval (quoted data)   |
| Blocking scope | `yield* scoped(function*(){ ... })` | Compound Eval (quoted data) |
| Built-in     | `yield* sleep(ms)`            | External Eval (unquoted data) |
| Config access | `yield* Config.useConfig(Token)` | External Eval (quoted null data) |

### 4.2 Agent Effect

```typescript
yield* OrderService().fetchOrder(orderId);
```

```json
{
  "tisyn": "eval",
  "id": "order-service.fetchOrder",
  "data": [{ "tisyn": "ref", "name": "orderId" }]
}
```

**ID:** `Agent.id + "." + methodName`. **Data:** plain array (NOT quoted). `resolve()` traverses at runtime.

### 4.3 Concurrency

```typescript
yield* all([() => A().step1(x), () => B().step2(y)]);
```

```json
{
  "tisyn": "eval",
  "id": "all",
  "data": {
    "tisyn": "quote",
    "expr": {
      "exprs": [
        { "tisyn": "eval", "id": "a.step1", "data": [{ "tisyn": "ref", "name": "x" }] },
        { "tisyn": "eval", "id": "b.step2", "data": [{ "tisyn": "ref", "name": "y" }] }
      ]
    }
  }
}
```

**Data:** Quote wrapping `{ exprs: [...] }`. Children remain unevaluated. Execution layer uses `unquote()`, NOT `resolve()`. Arrow functions are unwrapped — body extracted into `exprs`.

### 4.4 Built-in Effect

```
yield* sleep(5000) → { tisyn: "eval", id: "sleep", data: [5000] }
```

### 4.5 Sub-Workflow Composition

```typescript
function* sub(x: string): Workflow<number> { ... }
function* main(): Workflow<string> {
  const n = yield* sub("hello");
}
```

**Strategy A — Inline** (small workflows):

```
⟦ yield* sub("hello") ⟧ = Let("x", "hello", ⟦sub.body⟧)
```

**Strategy B — Call** (large or recursive workflows):

```
Let("__sub_0", ⟦compile(sub)⟧, Let("n", Call(Ref("__sub_0"), "hello"), ...))
```

### 4.6 Config Access

```typescript
yield* Config.useConfig(AppConfigToken)
```

```json
{
  "tisyn": "eval",
  "id": "__config",
  "data": { "tisyn": "quote", "expr": null }
}
```

`Config.useConfig()` requires exactly one argument: a `ConfigToken` identifier (UC1 if wrong arity, UC2 if non-identifier). The token provides static typing for the resolved config projection via `ConfigToken<T>` — it is erased by the compiler and does not appear in the emitted IR. Data is Quote-wrapped null; there is no payload to evaluate. Bare `useConfig()` without the `Config.` namespace is rejected (UC3).

At runtime, the `__config` effect is resolved from the execution-scoped config context. The token identity has no runtime effect.

---

## 5. Sequential Statement Compilation

### 5.1 Block-to-Let Transformation

```
transform_block([]):
  return null

transform_block([return expr]):
  return ⟦expr⟧

transform_block([const x = expr, ...rest]):
  return Let("x", ⟦expr⟧, transform_block(rest))

transform_block([yield* effect, ...rest]):
  return Let("__discard_N", ⟦effect⟧, transform_block(rest))

transform_block([if (cond) { return A }, ...rest]):
  return If(⟦cond⟧, ⟦A⟧, transform_block(rest))

transform_block([while ..., ...rest]):
  return Let("__while_N", ⟦while⟧, transform_block(rest))

transform_block([throw new Error(msg)]):
  return Throw(⟦msg⟧)
```

### 5.2 Implicit Return

Workflows with no explicit `return` emit `null` as terminal value.

---

## 6. Control Flow

### 6.1 Conditional

```
⟦ if (cond) { A } else { B } ⟧
= If(⟦cond⟧, ⟦A⟧, ⟦B⟧)
```

With early return:

```typescript
if (x < 0) {
  return "negative";
}
const result = yield* Agent().process(x);
return result;
```

```
If(Lt(Ref("x"), 0), "negative",
  Let("result", Eval("agent.process", [Ref("x")]), Ref("result")))
```

Code after `if`-with-return becomes the `else` branch.

### 6.2 While Loop — Two Compilation Strategies

The Tisyn `while` node has **no early-exit mechanism**. Its body expressions evaluate, the result is stored, the condition is re-checked, and the loop continues. A value returned from the body is just the iteration's result — the loop does not terminate.

This means `while` with `return` inside the body CANNOT compile to a `while` IR node. The compiler MUST distinguish two cases:

**Case A: No return in body.** Compile to `while` IR node directly.

```typescript
while (true) {
  yield* Agent().tick();
}
```

```
While(true, [Eval("agent.tick", [])])
```

This loop terminates only via error, cancellation, or the condition becoming falsy via effect in a future iteration. For `while(true)` with no return, this typically runs until cancellation.

**Case B: Return in body.** Compile to recursive Fn + Call.

```typescript
while (true) {
  const status = yield* JobService().checkStatus(jobId);
  if (status.state === "complete") {
    return yield* JobService().getResult(jobId);
  }
  yield* sleep(1000);
}
```

The compiler transforms this into:

```
Let("__loop_0", Fn([],
  Let("status", Eval("job-service.checkStatus", [Ref("jobId")]),
    If(Eq(Get(Ref("status"), "state"), "complete"),
      Eval("job-service.getResult", [Ref("jobId")]),
      Let("__discard_0", Eval("sleep", [1000]),
        Call(Ref("__loop_0")))))),
  Call(Ref("__loop_0")))
```

**How this works:**

1. `__loop_0` is bound to a Fn with no params.
2. The outer `Call(Ref("__loop_0"))` starts the first iteration.
3. Inside the body: if status is "complete", return the result (the `If`'s then-branch value propagates out through the Call as the result).
4. If not complete: sleep, then `Call(Ref("__loop_0"))` recurses.
5. Tisyn uses call-site resolution — `Ref("__loop_0")` inside the body resolves in the caller's environment, which contains the `__loop_0 → Fn(...)` binding.
6. Free variables from the enclosing scope (`jobId`) resolve correctly via call-site resolution — the caller's environment includes them.

**Detection:** The compiler walks the while body's AST. If any `return` statement exists (at any nesting depth within the body), use Case B. Otherwise, use Case A.

**Throw in body:** `throw` inside a while body works with both strategies. Errors propagate upward through `while` (Case A) and through `call` (Case B) identically.

### 6.3 While with Loop-Carried State

When a `while` loop body reassigns one or more outer `let` variables, the compiler treats those variables as loop-carried and applies Case B (recursive Fn + Call), regardless of whether the body contains `return`.

**Source:**

```typescript
let x = 0;
while (x < 10) {
  x = x + 1;
}
```

**IR** (loop is the last statement — result extracted directly):

```
Let("x_0", 0,
  Let("loop_0", Fn(["x_0", "last_0"],
    If(Lt(Ref("x_0"), 10),
      Let("x_1", Add(Ref("x_0"), 1),
        Call(Ref("loop_0"), [Ref("x_1"), Ref("x_1")])),
      Construct({ __value: Ref("last_0"), x: Ref("x_0") }))),
    Let("loop_result_0", Call(Ref("loop_0"), [Ref("x_0"), null]),
      Get(Ref("loop_result_0"), "__value"))))
```

**IR** (loop is followed by `return x` — carried var rebound in outer scope):

```
Let("x_0", 0,
  Let("loop_0", Fn(["x_0", "last_0"],
    If(Lt(Ref("x_0"), 10),
      Let("x_1", Add(Ref("x_0"), 1),
        Call(Ref("loop_0"), [Ref("x_1"), Ref("x_1")])),
      Construct({ __value: Ref("last_0"), x: Ref("x_0") }))),
    Let("loop_result_0", Call(Ref("loop_0"), [Ref("x_0"), null]),
      Let("x_1", Get(Ref("loop_result_0"), "x"),
        Ref("x_1")))))
```

**How this works:**

1. `loop_0` is a Fn with two parameters: the loop-carried variable `x_0` and a `last_0` accumulator initialized to `null`.
2. The outer Call starts the first iteration with `x_0 = 0` and `last_0 = null`.
3. Inside the Fn: the condition is checked **before** the body executes (using the parameter versions). If true, the body runs (`x_1 = x_0 + 1`), and the recursive Call passes both the updated `x` and the last body result as `last_0`.
4. When the condition becomes false, the Fn returns a packed struct `{ __value: last_0, x: x_0 }`. The `__value` field carries the last body result; each loop-carried variable is included under its source name so the caller can destructure it.
5. The outer scope destructures the result struct and rebinds each loop-carried variable to its final value before the continuation runs. Code following the loop sees the post-loop version.
6. For `while(true)` loops, no `last_0` parameter is added (the condition is never false). Early returns are the only exit path.

**Loop-carried variable scope:** After the while statement, each loop-carried variable is rebound in the outer scope to its final value. Code that follows the loop sees the post-loop version, so `return x` after a while loop correctly returns the final value.

### 6.4 SSA Lowering for `let` Declarations

`let` variables are lowered to Static Single Assignment (SSA) form. Each reassignment produces a fresh versioned name:

| Source | IR |
|--------|-----|
| `let x = e` | `Let("x_0", ⟦e⟧, ...)` |
| `x = e` | `Let("x_1", ⟦e⟧, ...)` (bumps to next version) |

**If/else SSA join:** When both branches of an if statement reassign `x`, the compiler synthesizes a join:

```typescript
let x = 0;
if (cond) {
  x = 1;
} else {
  x = 2;
}
return x;
```

Compiled:

```
Let("x_0", 0,
  Let("x_1", If(⟦cond⟧, 1, 2),
    Ref("x_1")))
```

The snapshot → dry-run → join-emit algorithm detects which variables change in each branch and synthesizes the minimal join expression. This works recursively: an `if` inside a branch also gets join synthesis.

**Scope:** After a while loop with loop-carried state, each loop-carried variable is rebound in the outer scope to its final value. The continuation sees the post-loop versions.

### 6.5 While with Invariant Condition

```typescript
const limit = 10;
while (count < limit) { ... }
```

If `count` is an immutable `const`, the condition is invariant. The compiler SHOULD emit warning W001.

### 6.6 Break/Continue

DISALLOWED. No IR equivalent. Loops terminate via return (Case B), throw, or condition.

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

##### 6.7.1.7 Canonical Examples

**Example 1: Return in try, catch falls through**

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

IR:

```
Let(r_0, Try(
    Construct({ __tag: "return", __value: 1 }),
    "e",
    Construct({ __tag: "fallthrough", __value: null })),
  If(Eq(Get(Ref(r_0), "__tag"), "return"),
    Get(Ref(r_0), "__value"),
    0))
```

**Example 2: Return in catch, body falls through**

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

IR:

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

**Example 3: Return with SSA join variables**

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

IR:

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

**Example 4: Return in try with finally**

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

IR (simplified):

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

**Example 5: Return with SSA join variables and finally**

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

IR (key structure):

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

**Example 6: Both clauses return (always-return optimization)**

```typescript
function* f(): Workflow<number> {
  try {
    return 1;
  } catch (e) {
    return 2;
  }
}
```

IR:

```
Let(r_0, Try(
    Construct({ __tag: "return", __value: 1 }),
    "e",
    Construct({ __tag: "return", __value: 2 })),
  Get(Ref(r_0), "__value"))
```

**Example 7: Return inside nested if within try**

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

IR:

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

## 7. Expression Compilation

### 7.1 Structural Operations

All pure expressions compile to structural Eval nodes with quoted data:

```
⟦ a + b ⟧ = { tisyn:"eval", id:"add", data:Q({ a:⟦a⟧, b:⟦b⟧ }) }
⟦ a > b ⟧ = { tisyn:"eval", id:"gt",  data:Q({ a:⟦a⟧, b:⟦b⟧ }) }
⟦ !a    ⟧ = { tisyn:"eval", id:"not", data:Q({ a:⟦a⟧ }) }
⟦ -a    ⟧ = { tisyn:"eval", id:"neg", data:Q({ a:⟦a⟧ }) }
```

### 7.2 Type Constraints

| Operator                  | Operands    | Note                                         |
| ------------------------- | ----------- | -------------------------------------------- |
| `add/sub/mul/div/mod/neg` | number only | TypeError on non-number                      |
| `gt/gte/lt/lte`           | number only | TypeError on non-number                      |
| `eq/neq`                  | any         | Structural comparison via canonical encoding |
| `and/or`                  | any         | Returns operand values, not booleans         |
| `not`                     | any         | Returns boolean                              |

### 7.3 `+` Disambiguation

JavaScript `+` is addition or concatenation. The compiler MUST disambiguate:

- Both operands statically typed `number` → `add`
- String context (template literal) → `concat`
- Ambiguous → compile error E011

### 7.4 Short-Circuit

`&&` → `and`, `||` → `or`. Return operand values (Tisyn Spec §6.7). This works correctly as conditions because `if` uses truthiness.

### 7.5 Property Access

```
⟦ obj.prop ⟧ = Get(⟦obj⟧, "prop")
⟦ obj.a.b ⟧ = Get(Get(⟦obj⟧, "a"), "b")
```

Computed access (`obj[expr]`) DISALLOWED.

### 7.6 Object Literals

```
⟦ { a: e1, b: e2 } ⟧ = Construct({ a: ⟦e1⟧, b: ⟦e2⟧ })
```

Evaluator sorts keys lexicographically at runtime (Spec §6.10).

### 7.7 Array Literals

```
⟦ [a, b, c] ⟧ = Array([⟦a⟧, ⟦b⟧, ⟦c⟧])
```

### 7.8 Template Literals

```
⟦ `Hello ${name}` ⟧ = Concat(["Hello ", ⟦name⟧])
```

### 7.9 Throw

```
⟦ throw new Error(msgExpr) ⟧ = Throw(⟦msgExpr⟧)
```

`msgExpr` may be string, template, or variable. Non-Error throws DISALLOWED.

---

## 8. Concurrency

### 8.1 `all` with Simple Children

```typescript
yield* all([() => A().step(x), () => B().step(y)]);
```

Arrow functions unwrapped. Bodies placed in `exprs`:

```json
{
  "tisyn": "eval",
  "id": "all",
  "data": {
    "tisyn": "quote",
    "expr": {
      "exprs": [
        { "tisyn": "eval", "id": "a.step", "data": [{ "tisyn": "ref", "name": "x" }] },
        { "tisyn": "eval", "id": "b.step", "data": [{ "tisyn": "ref", "name": "y" }] }
      ]
    }
  }
}
```

### 8.2 `all` with Multi-Step Children

Generator functions compiled as inline expression trees:

```typescript
yield* all([
    function* () {
      const order = yield* OrderService().fetchOrder("123");
      return yield* Processor().process(order);
    },
    () => FastService().quick(),
  ]);
```

```json
{
  "exprs": [
    {
      "tisyn": "eval",
      "id": "let",
      "data": {
        "tisyn": "quote",
        "expr": {
          "name": "order",
          "value": { "tisyn": "eval", "id": "order-service.fetchOrder", "data": ["123"] },
          "body": {
            "tisyn": "eval",
            "id": "processor.process",
            "data": [{ "tisyn": "ref", "name": "order" }]
          }
        }
      }
    },
    { "tisyn": "eval", "id": "fast-service.quick", "data": [] }
  ]
}
```

Generator children are inlined, NOT compiled as Fn nodes.

### 8.3 `race`

Same structure, `id: "race"`. Winner's result returned (not array).

### 8.4 Destructured Results

```typescript
const [a, b] = yield* all([...]);
```

```
Let("__all_0", Eval("all", Q({exprs:[...]})),
  Let("a", Get(Ref("__all_0"), "0"),
    Let("b", Get(Ref("__all_0"), "1"), ...)))
```

### 8.5 Free Variables in Children

Children may reference parent-scope variables via Ref. Correct — execution layer evaluates children in parent's environment. Compiler MUST verify all free variables are in scope at the call site.

---

## 9. Function Semantics

### 9.1 Arrow Functions → Fn

```typescript
const double = (x: number) => x * 2;
```

```json
{
  "tisyn": "fn",
  "params": ["x"],
  "body": {
    "tisyn": "eval",
    "id": "mul",
    "data": {
      "tisyn": "quote",
      "expr": {
        "a": { "tisyn": "ref", "name": "x" },
        "b": 2
      }
    }
  }
}
```

### 9.2 Arrow Function Bodies

Arrow function bodies MUST be **single pure expressions**. No block bodies, no `yield*`, no statements. This is a JavaScript language constraint — arrow functions cannot use `yield*`.

Arrow functions passed to `all`/`race` as thunks `() => expr` are unwrapped (§8.1), not compiled as Fn nodes.

### 9.3 Fn Bodies CAN Contain Effects

A Fn called via Tisyn `call` evaluates its body using the full evaluator. If the body contains external Evals, they cross the execution boundary normally. The `call` structural operation invokes `eval(body, E')`, and `eval` handles suspension/resumption transparently.

This is relevant for sub-workflow composition (§4.5 Strategy B) and the recursive loop pattern (§6.2 Case B), where the Fn body contains agent method calls.

### 9.4 Closure Restriction

Tisyn Fn has no closures. The compiler MUST ensure:

**Condition A:** No free variables. **Condition B:** All free variables in scope at every call site.

**Substitution** (replace free Refs with values) is MANDATORY when a Fn crosses the execution boundary as an agent argument.

### 9.5 Calling

```
⟦ f(a, b) ⟧ = Call(⟦f⟧, [⟦a⟧, ⟦b⟧])
```

---

## 10. Environment and Scope

### 10.1 Variables → Let

Every `const` → `let` binding. Scoped by nesting:

```
⟦ const a = e1; const b = e2; return a + b ⟧
= Let("a", ⟦e1⟧, Let("b", ⟦e2⟧, Add(Ref("a"), Ref("b"))))
```

### 10.2 Block Scoping

Variables in `if` branches scoped to branch body. Not visible outside.

### 10.3 Shadowing

Inner bindings shadow outer with same name. Outer restored after inner scope.

### 10.4 No Mutation

**`let` and `const` are both allowed.** The compiler lowers `let` + reassignment to SSA form (§6.4). `var` is rejected (E002). Reassignment of a `const` binding or an undeclared name is rejected (E003).

---

## 11. Unsupported Constructs

| Construct                 | Code              | Error             |
| ------------------------- | ----------------- | ----------------- |
| Var                       | `var x = ...`     | E002: Use "const" |
| Reassignment of `const` or undeclared name | `x = v` where x is `const` or undeclared | E003 |
| Property mutation         | `obj.p = v`       | E004              |
| Computed property         | `obj[expr]`       | E005              |
| `Math.random()`           |                   | E006              |
| `Date.now()`              |                   | E007              |
| `new Map/Set()`           |                   | E008              |
| `async/await`             |                   | E009              |
| `yield*` in expr position | `if (yield* ...)` | E010              |
| Ambiguous `+`             |                   | E011              |
| `for...in`                |                   | E013              |
| general `for...of`        | except `for (const x of yield* each(expr)) { ... }` | E013 |
| `eval()/new Function()`   |                   | E014              |
| `try` — `return` in `finally` | `return x` inside `finally` | E033 |
| `try` — catch without binding | `catch {}` (no binding name) | E034    |
| `try` — outer var in `finally` | assignment to outer `let` inside `finally` | E035 |
| `class/this`              |                   | E016              |
| `yield` (no `*`)          |                   | E017              |
| `call(() => ...)`         |                   | E018              |
| `typeof/instanceof`       |                   | E019              |
| `break/continue`          |                   | E020              |
| `Promise`                 |                   | E021              |
| Non-Error throw           | `throw "string"`  | E023              |
| Arrow block body          | `(x) => { ... }`  | E024              |
| `delete`/`Symbol`         |                   | E029/E030         |
| stream `for...of` with `let` or `var` binding | | E-STREAM-001 |
| stream `for...of` destructuring binding | | E-STREAM-002 |
| `for (const x of each(expr))` | | E-STREAM-003 |
| `each()` outside iterable position | | E-STREAM-004 |
| `each.next()` | | E-STREAM-005 |
| nested `for (const x of yield* each(expr))` | | E-STREAM-006 |
| `Config.useConfig()` without token | `Config.useConfig()` | UC1    |
| `Config.useConfig()` non-identifier | `Config.useConfig("string")` | UC2 |
| Bare `useConfig()` without namespace | `useConfig(Token)` | UC3   |
| User var `__` prefix      | `const __x`       | E028              |

---

## 12. End-to-End Examples

### 12.1 Simple Sequential Workflow

**Source:**

```typescript
function* processOrder(orderId: string): Workflow<Receipt> {
  const order = yield* OrderService().fetchOrder(orderId);
  const receipt = yield* PaymentService().chargeCard(order.payment);
  return receipt;
}
```

**IR:**

```json
{
  "tisyn": "fn",
  "params": ["orderId"],
  "body": {
    "tisyn": "eval",
    "id": "let",
    "data": {
      "tisyn": "quote",
      "expr": {
        "name": "order",
        "value": {
          "tisyn": "eval",
          "id": "order-service.fetchOrder",
          "data": [{ "tisyn": "ref", "name": "orderId" }]
        },
        "body": {
          "tisyn": "eval",
          "id": "let",
          "data": {
            "tisyn": "quote",
            "expr": {
              "name": "receipt",
              "value": {
                "tisyn": "eval",
                "id": "payment-service.chargeCard",
                "data": [
                  {
                    "tisyn": "eval",
                    "id": "get",
                    "data": {
                      "tisyn": "quote",
                      "expr": {
                        "obj": { "tisyn": "ref", "name": "order" },
                        "key": "payment"
                      }
                    }
                  }
                ]
              },
              "body": { "tisyn": "ref", "name": "receipt" }
            }
          }
        }
      }
    }
  }
}
```

**Key:** Two external Evals with unquoted data arrays. Two Lets with quoted data. All Refs bound. ✓

### 12.2 Effect-Driven Loop with Early Return

**Source:**

```typescript
function* pollJob(jobId: string): Workflow<Result> {
  const config = yield* ConfigService().getRetryConfig();

  while (true) {
    const status = yield* JobService().checkStatus(jobId);

    if (status.state === "complete") {
      return yield* JobService().getResult(jobId);
    }

    if (status.state === "failed") {
      throw new Error("Job failed");
    }

    yield* sleep(config.intervalMs);
  }
}
```

**Analysis:** Body contains `return` → Case B (recursive Fn + Call).

**IR:**

```json
{
  "tisyn": "fn",
  "params": ["jobId"],
  "body": {
    "tisyn": "eval",
    "id": "let",
    "data": {
      "tisyn": "quote",
      "expr": {
        "name": "config",
        "value": { "tisyn": "eval", "id": "config-service.getRetryConfig", "data": [] },
        "body": {
          "tisyn": "eval",
          "id": "let",
          "data": {
            "tisyn": "quote",
            "expr": {
              "name": "__loop_0",
              "value": {
                "tisyn": "fn",
                "params": [],
                "body": {
                  "tisyn": "eval",
                  "id": "let",
                  "data": {
                    "tisyn": "quote",
                    "expr": {
                      "name": "status",
                      "value": {
                        "tisyn": "eval",
                        "id": "job-service.checkStatus",
                        "data": [{ "tisyn": "ref", "name": "jobId" }]
                      },
                      "body": {
                        "tisyn": "eval",
                        "id": "if",
                        "data": {
                          "tisyn": "quote",
                          "expr": {
                            "condition": {
                              "tisyn": "eval",
                              "id": "eq",
                              "data": {
                                "tisyn": "quote",
                                "expr": {
                                  "a": {
                                    "tisyn": "eval",
                                    "id": "get",
                                    "data": {
                                      "tisyn": "quote",
                                      "expr": {
                                        "obj": { "tisyn": "ref", "name": "status" },
                                        "key": "state"
                                      }
                                    }
                                  },
                                  "b": "complete"
                                }
                              }
                            },
                            "then": {
                              "tisyn": "eval",
                              "id": "job-service.getResult",
                              "data": [{ "tisyn": "ref", "name": "jobId" }]
                            },
                            "else": {
                              "tisyn": "eval",
                              "id": "if",
                              "data": {
                                "tisyn": "quote",
                                "expr": {
                                  "condition": {
                                    "tisyn": "eval",
                                    "id": "eq",
                                    "data": {
                                      "tisyn": "quote",
                                      "expr": {
                                        "a": {
                                          "tisyn": "eval",
                                          "id": "get",
                                          "data": {
                                            "tisyn": "quote",
                                            "expr": {
                                              "obj": { "tisyn": "ref", "name": "status" },
                                              "key": "state"
                                            }
                                          }
                                        },
                                        "b": "failed"
                                      }
                                    }
                                  },
                                  "then": {
                                    "tisyn": "eval",
                                    "id": "throw",
                                    "data": {
                                      "tisyn": "quote",
                                      "expr": {
                                        "message": "Job failed"
                                      }
                                    }
                                  },
                                  "else": {
                                    "tisyn": "eval",
                                    "id": "let",
                                    "data": {
                                      "tisyn": "quote",
                                      "expr": {
                                        "name": "__discard_0",
                                        "value": {
                                          "tisyn": "eval",
                                          "id": "sleep",
                                          "data": [
                                            {
                                              "tisyn": "eval",
                                              "id": "get",
                                              "data": {
                                                "tisyn": "quote",
                                                "expr": {
                                                  "obj": { "tisyn": "ref", "name": "config" },
                                                  "key": "intervalMs"
                                                }
                                              }
                                            }
                                          ]
                                        },
                                        "body": {
                                          "tisyn": "eval",
                                          "id": "call",
                                          "data": {
                                            "tisyn": "quote",
                                            "expr": {
                                              "fn": { "tisyn": "ref", "name": "__loop_0" },
                                              "args": []
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              "body": {
                "tisyn": "eval",
                "id": "call",
                "data": {
                  "tisyn": "quote",
                  "expr": {
                    "fn": { "tisyn": "ref", "name": "__loop_0" },
                    "args": []
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

**How the recursion works:**

1. `__loop_0` is bound to a nullary Fn.
2. Outer `Call(Ref("__loop_0"))` starts the first iteration.
3. Each iteration: checks status, returns on complete, throws on failed, or sleeps and calls `__loop_0` again.
4. `Ref("__loop_0")` resolves via call-site resolution — the caller's env contains the binding.
5. `Ref("jobId")` and `Ref("config")` resolve in the caller's env, which includes the outer Let chain.
6. When the "complete" branch fires, the getResult value propagates out through the Call → Let → Fn return chain.

**Journal** (assuming checkStatus returns "pending", "pending", "complete"):

```
[0] yield root config-service.getRetryConfig ok {intervalMs:1000}
[1] yield root job-service.checkStatus ok {state:"pending"}
[2] yield root sleep ok null
[3] yield root job-service.checkStatus ok {state:"pending"}
[4] yield root sleep ok null
[5] yield root job-service.checkStatus ok {state:"complete"}
[6] yield root job-service.getResult ok {data:"result-data"}
[7] close root ok {data:"result-data"}
```

### 12.3 Concurrency with `all`

**Source:**

```typescript
function* parallelProcess(id1: string, id2: string): Workflow<string> {
  const orderA = yield* OrderService().fetchOrder(id1);
  const orderB = yield* OrderService().fetchOrder(id2);

  const results = yield* all([
    () => Processor().process(orderA),
    () => Processor().process(orderB),
  ]);

  return yield* Aggregator().combine(results);
}
```

**IR:**

```json
{
  "tisyn": "fn",
  "params": ["id1", "id2"],
  "body": {
    "tisyn": "eval",
    "id": "let",
    "data": {
      "tisyn": "quote",
      "expr": {
        "name": "orderA",
        "value": {
          "tisyn": "eval",
          "id": "order-service.fetchOrder",
          "data": [{ "tisyn": "ref", "name": "id1" }]
        },
        "body": {
          "tisyn": "eval",
          "id": "let",
          "data": {
            "tisyn": "quote",
            "expr": {
              "name": "orderB",
              "value": {
                "tisyn": "eval",
                "id": "order-service.fetchOrder",
                "data": [{ "tisyn": "ref", "name": "id2" }]
              },
              "body": {
                "tisyn": "eval",
                "id": "let",
                "data": {
                  "tisyn": "quote",
                  "expr": {
                    "name": "results",
                    "value": {
                      "tisyn": "eval",
                      "id": "all",
                      "data": {
                        "tisyn": "quote",
                        "expr": {
                          "exprs": [
                            {
                              "tisyn": "eval",
                              "id": "processor.process",
                              "data": [{ "tisyn": "ref", "name": "orderA" }]
                            },
                            {
                              "tisyn": "eval",
                              "id": "processor.process",
                              "data": [{ "tisyn": "ref", "name": "orderB" }]
                            }
                          ]
                        }
                      }
                    },
                    "body": {
                      "tisyn": "eval",
                      "id": "aggregator.combine",
                      "data": [{ "tisyn": "ref", "name": "results" }]
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

**Key observations:**

- `all` data is **quoted** — children stay unevaluated for execution layer.
- Arrow functions unwrapped — body expressions in `exprs`.
- `Ref("orderA")` and `Ref("orderB")` inside children are free variables resolved in parent's env at child task spawn time.
- `processor.process` data arrays are unquoted — `resolve()` handles them per-child.
- `all` result bound to `results`, passed directly to `aggregator.combine`.

**Journal:**

```
[0] yield root order-service.fetchOrder ok {id:"1",...}
[1] yield root order-service.fetchOrder ok {id:"2",...}
[2] yield root.0 processor.process ok "processed-1"
[3] yield root.1 processor.process ok "processed-2"
[4] close root.0 ok "processed-1"
[5] close root.1 ok "processed-2"
[6] yield root aggregator.combine ok "final-result"
[7] close root ok "final-result"
```

Note child task IDs `root.0` and `root.1` for the `all` children.

### 12.4 Validation Checklist

Every compiled IR MUST:

1. Pass Tisyn grammar validation (§10 of Spec).
2. Use exactly one Quote per structural operation data.
3. Have no Quote at any evaluation position (positions table).
4. Have all Refs bound by enclosing Let or Fn.
5. Use unquoted data for standard external Evals.
6. Use quoted data for `all`/`race`/`spawn`.
7. Produce the same journal as the source generator.

---

## 13. Compiler Interface

### 13.1 `compileGraph`

Primary compilation entry point. The compiler owns graph
construction, module classification, symbol extraction,
reachability analysis, compilation, and emission.

```typescript
interface CompileGraphOptions {
  roots: string[];
  readFile?: (path: string) => string;
  validate?: boolean;
  format?: "printed" | "json";
  generatedModulePaths?: string[];
}

interface CompileGraphResult {
  source: string;
  contracts: DiscoveredContract[];
  workflows: Record<string, Expr>;
  helpers: Record<string, Expr>;
  graph: {
    modules: Record<string, {
      category: ModuleCategory;
      participation?: ("implementation" | "declaration")[];
    }>;
    traversed: string[];
    compiled: string[];
  };
  warnings?: string[];
}

type ModuleCategory =
  | "workflow-implementation"
  | "contract-declaration"
  | "generated"
  | "type-only"
  | "external";

function compileGraph(
  options: CompileGraphOptions,
): CompileGraphResult;
```

CG1. `roots` MUST contain at least one path.

CG2. `readFile` defaults to synchronous filesystem reads.
The compiler MUST use only this callback for file access.

CG3. `format` defaults to `"printed"`. `"printed"` emits IR
using constructor-function notation. `"json"` emits
serialized IR data.

CG4. `generatedModulePaths` lists paths known to be outputs
of prior compilation passes.

### 13.2 `generateWorkflowModule` (Compatibility)

`generateWorkflowModule(source: string, options?)` is
preserved as a convenience wrapper. It creates a single
in-memory root via `readFile` and delegates to
`compileGraph`.

### 13.3 Exit Conditions

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Compilation error |
| 2 | Validation error |
| 3 | Internal error |

### 13.4 `compileGraphForRuntime()` — Runtime Compilation for Direct Execution

`compileGraphForRuntime(options: CompileForExecutionOptions): RuntimeCompilationResult`

Compiles authored TypeScript source for direct execution by `tsn run`
without writing a generated artifact file. Accepts a
`CompileForExecutionOptions` (extends `CompileGraphOptions` with
`exportName: string`) and returns a `RuntimeCompilationResult`:

```typescript
interface RuntimeCompilationResult {
  ir: Expr;
  inputSchema: InputSchema;
  runtimeBindings: Record<string, Expr>;
}
```

**Per-export scoping.** The `runtimeBindings` map contains only
symbols reachable from the selected export's transitive closure,
not the full module graph. Unreachable workflows and their helpers
are excluded.

**Emitted-name rewriting.** All `Ref()` nodes in the returned `ir`
and in binding values are rewritten to use globally unique runtime
names. This ensures module-local identity is preserved when multiple
modules define helpers with the same source-local name.

**Synthetic runtime names.** All exported symbols in the per-export
closure use `__rtexport_{emittedName}` as their binding key, not
their raw export name. This prevents collisions between any exported
symbol's binding and its own parameter names in the execution
environment. Non-exported symbols already use collision-safe mangled
names (`__m{idx}_{localName}`). All runtime binding keys start with
`__`.

**Name-resolution process:**
1. Compute per-export reachability from the selected export via
   IR free-variable analysis.
2. Build per-module name maps: source-local identifiers → runtime names.
3. Rewrite all IR in the closure using per-module name maps.
4. Build the binding map keyed by runtime names.

**Cross-module import-alias handling.** An import's `localName` in
the importing module is mapped to the target symbol's runtime name,
so aliased imports resolve correctly after rewriting.

## 14. Module Graph Construction

Starting from the supplied roots, the compiler constructs a
static import graph.

G1. Roots are parsed and recorded.

G2. Relative value imports recurse into the target module.

G3. Type-only imports are recorded as boundaries and do not
seed traversal.

G4. Bare specifiers and `node:` imports are recorded as
external boundaries and do not seed traversal.

G5. Generated modules are recorded as boundaries and MUST
NOT have their own imports followed.

G6. Traversal MUST use a visited set so cyclic imports do
not cause re-entry.

## 15. Module Classification

Every discovered module is classified as exactly one of:

- `workflow-implementation`
- `contract-declaration`
- `generated`
- `type-only`
- `external`

Modules may also report participation profiles:

- `implementation`
- `declaration`

Classification starts as a structural pass and may be
refined after helper qualification. Modules with only
non-generator functions that fail helper compilation are
treated as `external`. Contract-only modules with
qualifying helpers are reclassified to
`workflow-implementation`.

## 16. Symbol Extraction and Reachability

### 16.1 Extraction

The compiler records:

- exported generators
- non-generator helper candidates
- discovered contracts
- import/export bindings

Generated modules contribute exported names, type
annotations, placeholder symbol entries, and placeholder
contract entries, but are not compiled.

### 16.2 Reachability

ER1. Exported generator workflows are entrypoints.

ER2. Reachability follows direct calls and imported helper
calls recursively.

ER3. Cross-module resolution uses the recorded import/export
bindings.

ER4. Extracted symbols not in the closure MUST NOT be
compiled. The compiler MAY emit `W-GRAPH-001` for exported
symbols left unreachable.

ER5. If the graph contains no exported generator
entrypoints, the compiler MUST reject with `E-GRAPH-001`.

### 16.3 Emission Ordering

Compiled bindings MUST be emitted in an order such that
every referenced `Ref` target is bound before evaluation.
Strongly connected components use letrec-style binding
semantics.

## 17. Helper Compilation Semantics

All helpers compile to callable `Fn` bindings invoked via
`Call`.

HC1. Generator helpers compile through the generator
pipeline.

HC2. Non-generator helpers compile through
`emitBlock`/`emitExpression`. When successful, the helper is
workflow-relevant and emits as `Fn(params, body)`.

HC3. If compilation of a reachable non-generator helper
fails, the compiler MUST reject with `E-HELPER-001`.

Cross-module helpers resolve through import/export bindings.
Cross-module helpers MUST NOT be inlined.

The closure restriction applies to helpers exactly as it
does to any other emitted `Fn`: free references must be
valid at every call site.

## 18. Contract Visibility

Contracts are import-scoped.

CV1. A contract declared in a module is visible in that
module.

CV2. A contract imported from another module is visible only
in the importing module.

CV3. There is no ambient global contract map. A workflow or
helper that uses a contract it did not import MUST be
rejected.

Contract-only modules do not emit callable `Fn` bindings by
virtue of declaring contracts alone.

## 19. Name Conflict Resolution

NC1. Two reachable exported symbols with the same name from
different modules MUST be rejected with `E-NAME-001`.

NC2. The diagnostic MUST identify both conflicting module
paths and both source locations.

NC3. The compiler MUST NOT silently rename reachable
exported conflicts to make the program compile.

Non-exported helpers may use compiler-generated names as
long as the naming rules in §21 are preserved.

## 20. Generated Module Boundaries

A generated module is a declared compilation boundary.

GM1. Paths supplied in `generatedModulePaths` take
precedence for generated-module classification.

GM2. The compiler MAY also classify a module as generated by
content-based heuristics such as an auto-generated banner.

For each generated module, the compiler MUST:

GM3. Extract exported names and type annotations from
top-level declarations.

GM4. Create a placeholder symbol-table entry for each
exported binding.

GM5. Create a placeholder contract entry for each exported
contract factory.

GM6. Emit runtime `import { ... } from "<path>"` statements
for generated-module imports actually referenced across the
compilation boundary.

GM7. NOT follow the generated module's own imports.

GM8. NOT compile any of the generated module's content.

## 21. Emitted Naming

EN1. Exported symbols keep their source names.

EN2. Non-exported symbols receive deterministic,
collision-free compiler-generated names.

EN3. Synthetic naming is module-scoped and stable for the
same compilation graph.

EN4. Tests and conformance requirements apply to naming
properties, not exact synthetic spellings.

## 22. Compiled Artifact Identity

### 22.1 Replay Boundary

Replay compatibility is tied to the specific compiled
artifact that produced a journal. Different artifacts are
not replay-compatible merely because they originated from
similar source.

### 22.2 Same Inputs → Same Artifact

Same roots, source contents, options, and generated-module
boundaries MUST produce byte-identical emitted output.

### 22.3 Changed Relevant Input → Different Artifact

Changes to reachable helpers, reachable imported modules,
or generated-module boundary inputs MUST produce a different
artifact.

## 23. Preservation Note

Sections 4 through 12 remain normative for authored-source
lowering of the supported subset. Sections 14 through 22
extend that model to rooted import-graph compilation and
replace any older single-source interface assumptions where
they would otherwise conflict.

## 24. Diagnostics

### 24.1 Error Codes

| Code | Trigger |
| --- | --- |
| `E-IMPORT-001` | Referenced value import from bare specifier or `node:` boundary |
| `E-IMPORT-002` | Import specifier missing file extension |
| `E-IMPORT-003` | Resolved import path cannot be read |
| `E-IMPORT-004` | Referenced value import from a traversed relative module with no workflow-relevant symbols |
| `E-IMPORT-005` | Named import references a symbol not exported by the target module |
| `E-IMPORT-006` | Dynamic import expression in workflow code |
| `E-IMPORT-007` | Unsupported import form |
| `E-HELPER-001` | Reachable non-generator helper contains unsupported authored construct |
| `E-NAME-001` | Duplicate reachable exported symbol names across modules |
| `E-GRAPH-001` | No exported generator workflows found in the graph |

### 24.2 Warning Codes

| Code | Trigger |
| --- | --- |
| `W-GRAPH-001` | Exported symbol in a workflow-implementation module is not reachable from any entrypoint |

### 24.3 Diagnostic Content Requirements

DQ1. Every error diagnostic MUST include the symbol name
that triggered the error when a symbol is involved.

DQ2. Every error diagnostic MUST include the relevant module
path.

DQ3. Every error diagnostic MUST include the specific reason
the symbol is unavailable or invalid.

DQ4. `E-HELPER-001` MUST identify the unsupported construct
and its source location within the helper body.

DQ5. `E-IMPORT-004` SHOULD explain that the target module
contains no workflow-relevant declarations and why it was
classified as external.

DQ6. `E-NAME-001` MUST list both conflicting module paths
and the source location of each conflicting export.
