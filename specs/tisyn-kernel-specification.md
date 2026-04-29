# Tisyn Kernel Specification

**Implements:** Tisyn System Specification

---

## 1. Evaluation Model

### 1.1 The Kernel's Job

The kernel accepts a Tisyn IR tree and evaluates it. During
evaluation, it encounters external operations that require I/O
with remote agents. Each such operation is recorded in a journal.
On crash, the kernel replays the journal into a fresh evaluation,
reconstructing the same execution state without re-executing
effects.

### 1.2 Signature

```
eval : (Expr, Env) → Val | Error | Suspend(EffectDescriptor)
```

The kernel's evaluation function takes an expression and an
environment and produces one of three outcomes:

- **Val** — a JSON-serializable value. Evaluation complete.
- **Error** — an exception. Propagates upward.
- **Suspend** — an effect descriptor yielded to the execution
  layer. The kernel pauses; the execution layer provides a result;
  the kernel resumes.

### 1.3 Values vs Expressions

An **Expr** is any Tisyn IR node — a JSON document that
describes a computation. Five types: Literal, Eval, Quote, Ref, Fn.

A **Val** is the result of evaluating an expression:

```
Val = JsonPrimitive | JsonArray | JsonObject | FnVal
```

Every Val is also a valid Expr. Eval, Quote, and Ref are
expressions when encountered during IR tree traversal. The same
JSON objects are values when they appear as opaque data by
origin/context — returned by `lookup()`, returned by `eval()`,
or obtained from a quoted payload position after `resolve()`
strips one quote layer.

Context determines classification. A JSON object with
`tisyn: "eval"` is an Expr when the evaluator or `resolve()`
encounters it during tree traversal, and a Val when it appears
as opaque data by origin/context.

### 1.4 Evaluation Rules

**LITERAL.** A value without a matching `tisyn` field evaluates
to itself.

```
eval(literal, E) = literal
```

**REF.** A reference resolves in the environment.

```
eval({ tisyn: "ref", name: N }, E) = lookup(N, E)
```

**QUOTE.** Returns the inner expression without evaluating it.

```
eval({ tisyn: "quote", expr: X }, E) = X
```

This is the ONLY rule that may return a non-Val. Its output is
consumed exclusively by `unquote` and `resolve`, never by
application code.

**FN.** A function evaluates to itself. No environment is captured.

```
eval({ tisyn: "fn", params: P, body: B }, E) =
  { tisyn: "fn", params: P, body: B }
```

**EVAL.** A computation node. Classified and dispatched.

```
eval({ tisyn: "eval", id: ID, data: D }, E):
  if classify(ID) = STRUCTURAL:
    return eval_structural(ID, D, E)
  if classify(ID) = EXTERNAL:
    return eval_external(ID, D, E)
```

### 1.5 Classification

```
classify : string → STRUCTURAL | EXTERNAL
```

The structural set:

```
STRUCTURAL = {
  "let", "seq", "if", "while", "call", "get",
  "gt", "gte", "lt", "lte", "eq", "neq",
  "add", "sub", "mul", "div", "mod",
  "and", "or", "not", "neg",
  "construct", "array", "concat", "throw"
}

classify(id) = STRUCTURAL  if id ∈ STRUCTURAL
classify(id) = EXTERNAL    otherwise
```

Reserved stream-iteration effect IDs such as `stream.subscribe`
and `stream.next` therefore classify as EXTERNAL. They are
standard external effects, not structural operations and not
compound external forms.

Classification MUST be fixed at kernel initialization and MUST
NOT change during execution. It MUST be identical between
original execution and any replay.

---

## 2. Environment Model

### 2.1 Structure

An environment is a linked list of frames:

```
Env   = (Frame, Env) | ∅
Frame = Map<string, Val>
```

### 2.2 Operations

**Lookup:**

```
lookup(name, ∅)             = ERROR UnboundVariable(name)
lookup(name, (frame, rest)) = frame[name]           if name ∈ frame
                            = lookup(name, rest)     otherwise
```

**Extend:**

```
extend(E, name, val) = ({ name → val }, E)
extend(E, names[], vals[]) = ({ n₁→v₁, ..., nₖ→vₖ }, E)
  REQUIRES |names| = |vals|, else ArityMismatch
```

### 2.3 Invariants

**I1.** Only Val may be stored in an environment. The kernel MUST
fully evaluate an expression before placing its result in a binding.

**I2.** Environments are immutable. No mutation operation exists.
A binding set at frame creation never changes.

**I3.** Environments do NOT cross process boundaries. They are
kernel-internal state — not serialized, not journaled, not sent
to agents.

**I4.** Inner bindings shadow outer bindings with the same name.
The outer binding is not modified.

### 2.4 Unbound Reference

If `lookup` reaches `∅` without finding the name, the kernel
raises `UnboundVariable(name)`. This error propagates per §8.

---

## 3. The `resolve` Function

### 3.1 Purpose

`resolve(node, E)` produces a fully resolved Val from an Expr by
recursively resolving Ref, Eval, and Quote nodes within arrays
and objects. It is used exclusively when preparing external effect
descriptors (§4.3).

### 3.2 The Opaque Value Rule

> `resolve()` MUST NOT recurse into any value returned by
> `lookup()` or `eval()`. Such values are **terminal** —
> returned without inspection, traversal, or re-evaluation,
> regardless of their structure.

This holds even if the returned value contains a `tisyn` field
or structurally resembles an IR node.

### 3.3 Algorithm

```
resolve(node, E):
  if node.tisyn = "ref":
    return lookup(node.name, E)          // TERMINAL

  if node.tisyn = "eval":
    return eval(node, E)                 // TERMINAL

  if node.tisyn = "fn":
    return node                          // TERMINAL

  if node.tisyn = "quote":
    return node.expr                     // unwrap, return as opaque data

  if node is array:
    return [resolve(item, E) for item in node]   // TRAVERSABLE

  if node is object:
    result = {}
    for (key, child) in node:
      result[key] = resolve(child, E)
    return result                        // TRAVERSABLE

  return node                            // primitive, TERMINAL
```

### 3.4 Categories

| Category        | Behavior                                                                               |
| --------------- | -------------------------------------------------------------------------------------- |
| **Terminal**    | Return as-is. No further traversal. Results of `lookup`, `eval`; Fn nodes; primitives. |
| **Unwrap**      | Strip Quote, return contents as opaque data. No further traversal.                      |
| **Traversable** | Recurse into children. Plain arrays; plain objects without matching `tisyn`.           |

### 3.5 Postcondition

After `resolve(data, E)`, unquoted positions contain no Ref,
Eval, or Quote nodes. Quoted positions are returned as opaque
data and may structurally contain IR nodes, but these are values
by origin/context at the external boundary.

### 3.6 Where `resolve` Is Applied

`resolve` is called in exactly one place: Step 1 of the standard
external effect boundary (§4.3). It is NOT called for structural
operations (they use `unquote`), and NOT called for compound
external operations (they use `unquote` to preserve child
expressions).

---

## 4. Eval Node Execution

### 4.1 The `unquote` Operation

```
unquote(node, E):
  if node.tisyn = "quote":
    return node.expr
  else:
    return eval(node, E)
```

Returns raw Expr fields from a Quote without evaluation. Used by
structural operations to destructure their data. The result is an
Expr, not necessarily a Val.

### 4.2 Structural Execution

When `classify(ID) = STRUCTURAL`:

```
eval_structural(ID, D, E):
  fields = unquote(D, E)     // destructure quoted data
  // ... operation-specific logic using fields
  // eval() individual sub-expressions as needed
  return Val
```

Structural operations evaluate locally, synchronously, with no
journal events. See §5 for each operation.

### 4.3 External Execution — Standard

When `classify(ID) = EXTERNAL` and `ID ∉ COMPOUND_EXTERNAL`:

```
eval_external(ID, D, E):
  resolved = resolve(D, E)              // Step 1: resolve all data
  descriptor = {
    id: ID,
    data: resolved
  }
  result = SUSPEND(descriptor)           // Step 2: yield to execution layer
  return result                          // Step 3: resume with result
```

**Step 1 — Resolve.** Call `resolve(D, E)` to produce resolved
data. Unquoted positions are fully resolved. Quoted positions
are preserved as opaque data.

**Step 2 — Suspend.** Hand the descriptor to the execution layer.
The kernel pauses. The task enters SUSPENDED state.

**Step 3 — Resume.** The execution layer provides a Val or Error.
The kernel resumes and returns the result.

### 4.4 External Execution — Compound

When `ID ∈ COMPOUND_EXTERNAL = { "all", "race", "scope" }` or `ID = "spawn"`:

```
eval_external(ID, D, E):
  inner = unquote(D, E)                 // strip Quote, preserve children
  descriptor = { id: ID, data: inner }
  result = SUSPEND(descriptor)
  return result
```

**Critical difference:** `unquote` is used instead of `resolve`.
The child expressions inside `inner.exprs` remain unevaluated.
The execution layer evaluates each child in a separate task.

### 4.5 Effect Descriptor Shape

For standard external:

```
{ id: "agent-id.methodName", data: Val }
```

For compound external:

```
{ id: "all", data: { exprs: [Expr, Expr, ...] } }
{ id: "race", data: { exprs: [Expr, Expr, ...] } }
{ id: "scope", data: { handler, bindings, body } }
{ id: "spawn", data: Expr }
```

### 4.6 Effect ID Parsing

The execution layer parses dotted IDs:

```
parseEffectId("fraud-detector.fraudCheck")
  → { type: "fraud-detector", name: "fraudCheck" }

parseEffectId("sleep")
  → { type: "sleep", name: "sleep" }
```

Split on first dot. Undotted IDs: type and name are the same.

---

## 5. Built-in Structural Operations

Each operation: input shape, evaluation procedure, return value.

### 5.1 `let`

**Shape:** `data: Q({ name: string, value: Expr, body: Expr })`

```
eval_structural("let", D, E):
  { name, value, body } = unquote(D, E)
  V = eval(value, E)
  E' = extend(E, name, V)
  return eval(body, E')
```

The binding is visible only within `body`. Not visible in `value`.
No self-reference. Immutable.

### 5.2 `seq`

**Shape:** `data: Q({ exprs: [Expr, ...] })`

```
eval_structural("seq", D, E):
  { exprs } = unquote(D, E)
  result = null
  for expr in exprs:
    result = eval(expr, E)
  return result
```

All elements evaluate in the same environment E. Bindings from
`let` inside one element are NOT visible in subsequent elements.

### 5.3 `if`

**Shape:** `data: Q({ condition: Expr, then: Expr, else?: Expr })`

```
eval_structural("if", D, E):
  { condition, then, else } = unquote(D, E)
  C = eval(condition, E)
  if truthy(C): return eval(then, E)
  if "else" present: return eval(else, E)
  return null
```

Truthiness: `false`, `null`, `0`, `""` are falsy. All else truthy.

### 5.4 `while`

**Shape:** `data: Q({ condition: Expr, exprs: [Expr, ...] })`

```
eval_structural("while", D, E):
  { condition, exprs } = unquote(D, E)
  result = null
  loop:
    C = eval(condition, E)
    if not truthy(C): return result
    for expr in exprs:
      result = eval(expr, E)
    goto loop
```

Condition and body are re-evaluated each iteration from the
unquoted Expr nodes. Environment E does not change between
iterations — bindings inside the body are scoped to each
iteration and discarded.

There is no break mechanism. Loops terminate when the condition
is falsy, or via error/cancellation.

### 5.5 `call`

**Shape:** `data: Q({ fn: Expr, args: [Expr, ...] })`

```
eval_structural("call", D, E):
  { fn, args } = unquote(D, E)
  F = eval(fn, E)
  if F.tisyn ≠ "fn": raise NotCallable(F)
  Vs = [eval(a, E) for a in args]
  if |F.params| ≠ |Vs|: raise ArityMismatch
  E' = extend(E, F.params, Vs)
  return eval(F.body, E')
```

Arguments evaluated left-to-right. Body evaluates in caller's
environment extended with parameter bindings (call-site
resolution). The body MAY contain external Evals — the kernel
handles suspension/resumption normally.

### 5.6 `get`

**Shape:** `data: Q({ obj: Expr, key: string })`

```
eval_structural("get", D, E):
  { obj, key } = unquote(D, E)
  O = eval(obj, E)
  if O is object and key ∈ O: return O[key]
  return null
```

`key` is a string literal, not evaluated.

### 5.7 Arithmetic (`add`, `sub`, `mul`, `div`, `mod`)

**Shape:** `data: Q({ a: Expr, b: Expr })`

```
eval_structural(op, D, E):
  { a, b } = unquote(D, E)
  A = eval(a, E)
  B = eval(b, E)
  if typeof A ≠ number: raise TypeError(op, "left", A)
  if typeof B ≠ number: raise TypeError(op, "right", B)
  if op ∈ {"div","mod"} and B = 0: raise DivisionByZero
  return apply(op, A, B)
```

Numeric-only. TypeError on non-number. DivisionByZero on `÷ 0`.

### 5.8 Comparison (`gt`, `gte`, `lt`, `lte`)

Same shape and type constraint as arithmetic. Returns boolean.

### 5.9 Equality (`eq`, `neq`)

**Shape:** `data: Q({ a: Expr, b: Expr })`

Accept any Val types. Comparison via canonical encoding:

```
eq(A, B) = canonical(A) === canonical(B)
```

Returns boolean.

### 5.10 Short-Circuit (`and`, `or`)

**Shape:** `data: Q({ a: Expr, b: Expr })`

```
eval_structural("and", D, E):
  { a, b } = unquote(D, E)
  A = eval(a, E)
  if not truthy(A): return A
  return eval(b, E)

eval_structural("or", D, E):
  { a, b } = unquote(D, E)
  A = eval(a, E)
  if truthy(A): return A
  return eval(b, E)
```

Return **operand values**, not booleans. `And(0, X)` → `0`.
`Or(42, X)` → `42`.

### 5.11 Unary (`not`, `neg`)

**Shape:** `data: Q({ a: Expr })`

`not`: accepts any Val, returns boolean.
`neg`: numeric-only, TypeError on non-number.

### 5.12 `construct`

**Shape:** `data: Q({ key₁: Expr, key₂: Expr, ... })`

```
eval_structural("construct", D, E):
  fields = unquote(D, E)
  keys = Object.keys(fields).sort()     // lexicographic
  result = {}
  for key in keys:
    result[key] = eval(fields[key], E)
  return result
```

Fields evaluated in **lexicographic key order**. This ensures
deterministic effect ordering across languages.

### 5.13 `array`

**Shape:** `data: Q({ items: [Expr, ...] })`

Evaluate each item left-to-right. Return the array.

### 5.14 `concat`

**Shape:** `data: Q({ parts: [Expr, ...] })`

Evaluate each part, coerce to string, concatenate, return.

### 5.15 `throw`

**Shape:** `data: Q({ message: Expr })`

```
eval_structural("throw", D, E):
  { message } = unquote(D, E)
  M = eval(message, E)
  raise ExplicitThrow(M)
```

### 5.16 `try`

**Shape:** `data: Q({ body: Expr, catchParam?: string, catchBody?: Expr, finally?: Expr, finallyPayload?: string })`

Constraints: at least one of `catchBody` or `finally` must be present.
If `catchParam` is present, `catchBody` must be present.
`catchParam` must be a non-empty string when present.
`finallyPayload` must be a non-empty string when present.
`finally` must be present when `finallyPayload` is present.
Absent fields are omitted (not null).

```
eval_structural("try", D, E):
  { body, catchParam, catchBody } = unquote(D, E)
  finallyBody = fields["finally"]
  fp = fields["finallyPayload"]   // optional binding name

  type Outcome = { ok: true, value: Val } | { ok: false, error: unknown }
  let outcome: Outcome

  // Phase 1: body
  try:
    outcome = { ok: true, value: eval(body, E) }
  catch e:
    if not isCatchable(e):
      // Non-catchable (halt, divergence, etc.)
      if finallyBody present: eval(finallyBody, E)   // if this throws, that propagates
      re-raise e
    outcome = { ok: false, error: e }

  // Phase 2: catch clause
  if outcome.ok = false AND catchBody present:
    errorVal = errorToValue(outcome.error)
    E' = catchParam present ? extend(E, catchParam, errorVal) : E
    try:
      outcome = { ok: true, value: eval(catchBody, E') }
    catch e:
      outcome = { ok: false, error: e }

  // Phase 3: finally — result DISCARDED; error replaces prior outcome
  if finallyBody present:
    E_finally = (fp present AND outcome.ok) ? extend(E, fp, outcome.value) : E
    eval(finallyBody, E_finally)   // natural throw propagation; result discarded

  if outcome.ok: return outcome.value
  raise outcome.error
```

`isCatchable(e)` returns true for: `ExplicitThrow`, `TypeError`,
`NotCallable`, `ArityMismatch`, `UnboundVariable`, `DivisionByZero`,
`EffectError`. All other signals (halt/cancellation, `DivergenceError`,
`RuntimeBugError`) are non-catchable.

`errorToValue(e)` returns `e.message` for `Error` instances; `String(e)` otherwise.

**Halt/cancellation:** skips the catch phase; `finally` still runs
in the original environment `E`. A parent's catch does NOT catch
cancellation.

**yieldIndex:** monotonic across phase boundaries. Does NOT reset
between body, catch, and finally phases.

---

## 6. Quote Semantics

### 6.1 Quote as Evaluation Boundary

A Quote node prevents evaluation of its contents. When the
kernel encounters a Quote during evaluation:

```
eval(Quote(X), E) = X
```

The inner expression X is returned as-is — an Expr, not a Val.

### 6.2 How Quoted Data Is Later Evaluated

Structural operations receive their data wrapped in a single
Quote. The operation calls `unquote(data, E)` to strip the
Quote layer, obtaining the raw fields (which are Expr nodes).
The operation then selectively evaluates individual fields:

```
eval_structural("if", D, E):
  { condition, then, else } = unquote(D, E)     // strip Quote
  C = eval(condition, E)                          // evaluate condition
  if truthy(C): return eval(then, E)              // evaluate chosen branch
```

The condition and branches are Expr nodes that the `if` operation
evaluates on demand. The unchosen branch is never evaluated.

### 6.3 Quote and Concurrency

Compound external nodes (`all`, `race`, `scope`) use Quote to preserve child
expressions:

```json
{ "tisyn": "eval", "id": "all",
  "data": { "tisyn": "quote", "expr": {
    "exprs": [child₁, child₂, ...] }}}
```

`unquote` strips the outer Quote. The execution layer receives
`{ exprs: [child₁, child₂] }` where each child is an unevaluated
Expr. The execution layer spawns each as a separate task.

### 6.4 The Single-Quote Invariant

Structural operation data uses exactly one Quote layer. The
sub-expressions inside that Quote MUST NOT themselves be Quotes
at positions the operation evaluates (see §10.4). This ensures
`eval` on any sub-expression always produces a Val.

### 6.5 Quote in External Effect Data

External effect data is NOT wrapped in Quote (standard effects
use `resolve`, not `unquote`). Exception: compound external
operations (`all`, `race`, `scope`, `spawn`) use Quote because they need
`unquote` to preserve child expressions.

---

## 7. Concurrency Model

### 7.1 No Concurrency in the IR

The IR is sequential. Concurrency is introduced by the execution
layer when it encounters `all`, `race`, `scope`, or `spawn` effect
descriptors.

### 7.2 `all` Execution

When the execution layer receives `{ id: "all", data: { exprs } }`:

```
execute_all(exprs, parentEnv, parentTask):
  children = []
  for i in 0..exprs.length-1:
    childId = parentTask.taskId + "." + parentTask.childCounter++
    child = createTask(childId, exprs[i], parentEnv)
    children.append(child)

  startAll(children)        // begin concurrent evaluation
  results = awaitAll(children)
  return results            // Val[] in exprs order
```

**Rules:**

1. Each child evaluates in a **snapshot** of the parent's
   environment at spawn time. The snapshot is a reference to the
   same immutable frame chain — no copying needed because
   environments are immutable.
2. Children run concurrently. The execution layer determines
   actual parallelism.
3. Results returned in `exprs` order, not completion order.
4. If any child fails: remaining cancelled, error propagates.
5. If parent cancelled: all children cancelled.
6. Empty `exprs`: return `[]` immediately.

### 7.3 `race` Execution

```
execute_race(exprs, parentEnv, parentTask):
  children = []
  for i in 0..exprs.length-1:
    childId = parentTask.taskId + "." + parentTask.childCounter++
    child = createTask(childId, exprs[i], parentEnv)
    children.append(child)

  startAll(children)
  winner = awaitFirst(children)    // first to COMPLETE
  cancelRest(children, winner)
  return winner.result             // single Val, not array
```

**Rules:**

1. First child to complete successfully wins.
2. All other children cancelled.
3. A child that fails does NOT win — race continues with rest.
4. If ALL children fail, the last error propagates.
5. Return value is the winner's result (not wrapped in array).

### 7.4 Environment Snapshot

Children receive the parent's environment at spawn time. Since
environments are immutable linked lists, this is a pointer copy.
Children cannot modify the parent's environment. The parent
cannot modify the children's environment. No synchronization
is needed.

### 7.5 Determinism Under Concurrency

Children produce effects independently. Their journals interleave
nondeterministically (network timing). But replay is deterministic
because:

- Each child has its own coroutine ID.
- The ReplayIndex is per-coroutine.
- Each child's cursor advances independently.
- The parent waits for all/first — the journal records which
  children completed and in what order.

### 7.6 Child Task Identity

```
taskId = parentTask.taskId + "." + parentTask.childCounter
```

Counter starts at 0, increments per spawn. Task IDs match
`^root(\.\d+)*$`. Generated deterministically from spawn order.

---

## 8. Error Handling

### 8.1 Error Types

| Error             | Cause                  |
| ----------------- | ---------------------- |
| `UnboundVariable` | Ref resolution failed  |
| `NotCallable`     | Call on non-Fn value   |
| `ArityMismatch`   | Wrong argument count   |
| `TypeError`       | Invalid operand type   |
| `DivisionByZero`  | div/mod by zero        |
| `ExplicitThrow`   | `throw` node evaluated |
| `EffectError`     | Agent returned error   |
| `DivergenceError` | Replay mismatch        |
| `MalformedIR`     | Invalid IR structure   |

### 8.2 Propagation

When a sub-expression raises an error, the enclosing operation
stops and propagates. No further sub-expressions are evaluated.

**Per operation:**

- `let`: error in value → propagate (body not evaluated).
  Error in body → propagate.
- `seq`: first error stops the sequence.
- `if`: error in condition → propagate (no branch). Error in
  branch → propagate.
- `while`: error in condition or body → propagate, loop ends.
- `call`: error in fn → propagate. Error in arg → propagate
  (left-to-right, remaining skipped). Error in body → propagate.
- Binary ops: error in left → propagate (right not evaluated).
- Short-circuit: error in `a` → propagate. If `a` short-circuits,
  `b` is not evaluated (no error possible from `b`).

### 8.3 Errors at the Task Boundary

When an error propagates to the top of a task's expression tree:

1. Kernel raises to the execution layer.
2. Close(err) written.
3. Task → FAILED.
4. Parent notified (all: siblings cancelled; race: this child
   lost, race continues).

### 8.4 Effect Errors

When an agent returns `{ ok: false, error }`:

1. Yield(err) written, acknowledged.
2. Error delivered to kernel via the resume path.
3. Kernel raises the error — propagation per §8.2.

On replay, the same error is stored in the journal and
re-delivered identically.

### 8.5 Cancellation Is Not an Error

Cancellation propagates downward (parent → children), not
upward. It is delivered via a separate signal, not through the
error path. A parent's catch does NOT catch cancellation.

```
cancel(task):
  if task is terminal: return
  task.cancelling = true              // point of no return
  for child in task.children.reverse():
    cancel(child)
  destroy task's evaluation scope
  write Close(cancelled)
  task → CANCELLED
```

Once `cancelling` is true, any agent result for the task's
pending effect is discarded. No Yield written. Irrevocable.

---

## 9. Journaling Model

### 9.1 What Is Recorded

Two event types. Nothing else.

**Yield** — records one external effect's description and result:

```json
{
  "type": "yield",
  "coroutineId": "root.0",
  "description": {
    "type": "fraud-detector",
    "name": "fraudCheck",
    "input": { "userId": "u-123", "amount": 4200 },
    "sha": "9f3a…e8b1"
  },
  "result": { "status": "ok", "value": true }
}
```

`description` carries `input` and `sha` for all payload-sensitive
effects (see "Effect Description Shape" below). Two effects —
`stream.subscribe` and `__config` — omit both fields because
neither has a canonicalizable input distinct from runtime-owned
state. See §3.1.1 of `tisyn-scoped-effects-specification.md` for
the classification rationale. The durable event algebra is
unchanged: `DurableEvent = YieldEvent | CloseEvent`.

**Effect Description Shape.** `YieldEvent.description` has two
valid shapes.

*Payload-sensitive effects* — all effects except
`stream.subscribe` and `__config`:

```
{
  type: string,
  name: string,
  input: <durable canonicalizable JSON value>,
  sha: string
}
```

Both `input` and `sha` are REQUIRED. A `YieldEvent` for a
payload-sensitive effect that lacks either field is
**nonconforming**.

*Non-canonicalizable runtime-direct effects (`stream.subscribe`,
`__config`)*:

```
{ type: "stream",   name: "subscribe" }
{ type: "__config", name: "__config"  }
```

The `type`/`name` fields for each effect are derived from
`parseEffectId(effectId)` (§4.6). The `__config` shape above
follows the undotted-ID rule: `parseEffectId("__config")`
returns `{ type: "__config", name: "__config" }` because the ID
contains no dot.

`input` and `sha` MUST NOT be present on either. Replay
comparison for these effects compares only `type` and `name`;
missing `sha` on a stored entry is expected and correct.

A TypeScript representation marks both fields optional at the
type level so the same type fits both non-canonicalizable
shapes:

```typescript
interface EffectDescription {
  type: string;
  name: string;
  input?: Val;
  sha?: string;
}
```

The TS optionality is purely so the type also fits
`stream.subscribe` and `__config`. The normative requirement
remains: `input` and `sha` MUST be present for every
payload-sensitive effect.

**`payloadSha`.** Payload identity is computed by:

```
payloadSha(v) = bytesToHex(sha256(utf8(canonical(v))))
```

`canonical` is the canonical JSON encoding defined in §11.5.
The hash function is SHA-256 from `@noble/hashes` (isomorphic
across Node and browser builds). `payloadSha` is exported from
`@tisyn/kernel`.

**`input` semantics.** `input` is the durable canonicalizable
JSON value from which `sha` is computed. The runtime MUST
canonicalize `input` before hashing. Implementations MAY emit
`input` with canonical key ordering. **Replay comparison uses
`sha` only**; `input` is recorded for journal introspection
and post-hoc auditability.

**Close** — records a task's terminal state:

```json
{
  "type": "close",
  "coroutineId": "root.0",
  "result": { "status": "ok", "value": { "receiptId": "r-456" } }
}
```

### 9.2 Event Result Shape

```
EventResult =
  | { status: "ok",   value?: Val }
  | { status: "error",  error: { message: string, name?: string } }
  | { status: "cancelled" }
```

### 9.3 When Events Are Written

**Yield:** Written when the execution layer receives an agent
result (or replays a stored result) and BEFORE the kernel resumes.
This is the persist-before-resume invariant.

```
1. Agent responds with result.
2. Execution layer constructs Yield event.
3. Execution layer appends to journal.
4. Execution layer awaits durable acknowledgment.
5. ONLY THEN: kernel resumes with the result.
```

If the host crashes between steps 3 and 5: the Yield is in the
journal, the kernel was never resumed. On restart, replay feeds
the stored result.

If the host crashes between steps 1 and 3: the Yield is NOT in
the journal. On restart, the effect is re-dispatched.

**Close:** Written when a task reaches a terminal state
(COMPLETED, FAILED, CANCELLED). Written after all children's
Closes.

### 9.4 Journal Structure

The journal is an append-only sequence of events:

```
Journal = [Event₀, Event₁, Event₂, ...]
```

Events are totally ordered by append position. The journal is
backed by a Durable Stream with epoch fencing (single writer).

### 9.5 Ordering Guarantees

**O1.** Events within the stream are totally ordered.

**O2.** A child's Close precedes the parent's Yield that
consumes it (causal ordering).

**O3.** Yields for a given coroutine appear in the order the
kernel yielded them.

**O4.** A coroutine's Close appears after all its Yields.

**O5.** A parent's Close appears after all children's Closes.

### 9.6 Correlation IDs

Each effect dispatch uses a correlation ID:

```
correlationId = taskId + ":" + yieldIndex
```

Where `yieldIndex` is the 0-based count of Yield events already
written for this task. Deterministic. Unique within an execution.

Cleanup effects (in finally blocks) continue the same yield index
sequence. The index does NOT reset.

### 9.7 What Is NOT Recorded

- Structural operation evaluations (if, let, add, etc.)
- Environment bindings
- Internal control flow decisions
- Progress notifications (ephemeral, separate channel)

---

## 10. Replay Semantics

### 10.1 The Replay Index

On startup, the kernel reads the journal and builds:

```
ReplayIndex:
  yields:  Map<CoroutineId, Array<{ description, result }>>
  cursors: Map<CoroutineId, number>
  closes:  Map<CoroutineId, CloseEvent>
```

```
buildIndex(events):
  for event in events:
    if event.type = "yield":
      yields[event.coroutineId].append(event)
    if event.type = "close":
      closes[event.coroutineId] = event
  for each coroutineId: cursors[id] = 0
```

### 10.2 The Matching Algorithm

The kernel specifies the **comparison primitive**: given a
stored description and a current description, what counts as a
match. The kernel does NOT specify which description plays the
`current` role; that ownership lives in
`tisyn-scoped-effects-specification.md` and varies by dispatch
path.

```
compare(stored, current):
  if stored.type ≠ current.type: → DIVERGENCE (type/name mismatch)
  if stored.name ≠ current.name: → DIVERGENCE (type/name mismatch)
  if effect is payload-sensitive
        (i.e., stored.type/name is not in the
         non-canonicalizable set { stream.subscribe, __config }):
    if stored.sha is absent:
      → DIVERGENCE (nonconforming journal — missing required sha)
    if stored.sha ≠ current.sha:
      → DIVERGENCE (payload mismatch)
  → MATCH
```

When the kernel suspends, the matching procedure is:

```
match(coroutineId, current):
  entry = peekYield(coroutineId)

  CASE 1: entry exists
    compare(entry.description, current)
    consumeYield(coroutineId)    // cursor++
    return entry.result          // REPLAY path

  CASE 2: entry absent, close exists for coroutineId
    → DIVERGENCE (continue-past-close)

  CASE 3: entry absent, no close
    → LIVE path (dispatch to agent)
```

The construction of `current` is dispatch-path-specific and is
specified by `tisyn-scoped-effects-specification.md`:

- **Runtime-direct effects** (`__config`, `stream.subscribe`,
  `stream.next`): source descriptor, per scoped-effects §9.5.8.
- **Chain-dispatched delegated effects** (max calls `next`):
  boundary descriptor, per scoped-effects §9.5.3.
- **Chain-dispatched short-circuit effects** (max returns
  without `next`): source descriptor, per scoped-effects
  §9.5.5.

The kernel does not restate the boundary-vs-source rule; it
specifies only how two descriptions compare.

### 10.3 Description Matching

Three fields participate in the matching algorithm for
payload-sensitive effects: `type`, `name`, and `sha`. For the
non-canonicalizable runtime-direct effects (`stream.subscribe`,
`__config`; see §9.1 "Effect Description Shape"), only `type`
and `name` participate; `sha` is neither expected nor compared.

`sha` is part of durable identity for payload-sensitive
effects. A stored entry that omits `sha` for a payload-
sensitive effect is nonconforming and MUST raise
`DivergenceError` (§10.4); it MUST NOT replay successfully. A
stored entry that omits `sha` for a non-canonicalizable
runtime-direct effect is expected and MUST replay successfully.

### 10.4 Divergence

A divergence is fatal. The kernel MUST halt and surface
`DivergenceError`. The error MUST carry enough information to
diagnose the cause; the following message templates are
normative for the three cases:

**Type/name mismatch:**

```
Divergence at {coroutineId}[{cursor}]: expected
{storedType}.{storedName}, got {currentType}.{currentName}
```

**Payload mismatch (SHA differs):**

```
Divergence at {coroutineId}[{cursor}]: payload mismatch for
{type}.{name}:
  stored sha: {storedSha}
  current sha: {currentSha}
```

**Missing required SHA (nonconforming journal):**

```
Divergence at {coroutineId}[{cursor}]: stored entry for
{type}.{name} missing required sha — nonconforming journal
```

`DivergenceError` is the single error type for all three
cases. No specialized payload-divergence error class is
introduced. Implementations SHOULD include both the stored
and current SHA hex strings in the payload-mismatch message
to aid diagnosis.

```
DivergenceError {
  coroutineId: string,
  position: number,
  message: string,            // formatted per templates above
  expected?: { type, name, sha? },
  actual?:   { type, name, sha? }
}
```

No further effects are replayed or dispatched.

### 10.5 Replay vs Live

During replay, the kernel executes identically to a live run. The
only difference: at Step 2 of eval_external (§4.3), instead of
dispatching to an agent and waiting, the execution layer feeds the
stored result synchronously.

Replay is synchronous. Every stored effect resolves in the same
tick. A workflow with 1000 Yield events replays in one tick.

### 10.6 Transition from Replay to Live

After consuming all stored Yields for a coroutine, the next
effect reaches CASE 3 (no entry, no close). This is the
transition to live execution. The effect is dispatched to an
agent. The task suspends. Execution continues normally.

### 10.7 Crash Recovery Sequence

```
1. New kernel starts.
2. Reads journal from Durable Stream.
3. Builds ReplayIndex.
4. Creates fresh evaluation from the IR tree.
5. Kernel evaluates, hitting effects in order.
6. Each effect matches a stored Yield → replayed synchronously.
7. After all stored Yields consumed → live path.
8. Kernel suspends, awaits agent response.
9. Execution continues from the crash point.
```

The kernel is in the same state as before the crash because:
same tree + same stored results → same branches → same bindings
→ same environment → same next effect.

---

## 11. Determinism Guarantees

### 11.1 The Determinism Theorem

For a given IR tree T, initial environment E₀, effect result
sequence R, and classification function C:

The kernel produces a unique sequence of effect descriptors, a
unique final value, and a unique task tree.

### 11.2 What Must Be Deterministic

| Component                      | Guarantee                      |
| ------------------------------ | ------------------------------ |
| Structural operations          | Pure functions of inputs       |
| Effect descriptor construction | Deterministic from tree + env  |
| Effect ordering within a task  | Single-threaded, sequential    |
| Task spawn ordering            | Synchronous counter per parent |
| Branching decisions            | Same results → same conditions |
| `construct` field order        | Lexicographic key sorting      |
| `call` argument order          | Left-to-right                  |
| `seq` element order            | Left-to-right                  |

### 11.3 What Is Explicitly Non-Deterministic

| Component                         | How handled           |
| --------------------------------- | --------------------- |
| Effect result values              | Journal stores them   |
| Wall-clock timing                 | Time is an effect     |
| Concurrent child completion order | Per-coroutine cursors |

### 11.4 Structural Determinism

The IR provides determinism structurally. Non-determinism sources
present in JavaScript are absent from the IR:

- No `Math.random()` (no random primitive)
- No `Date.now()` (no time primitive)
- No `Map`/`Set` iteration (no Map/Set type)
- No `for...in` (no property enumeration)
- No `Symbol` (no non-string keys)
- No async scheduling (kernel is synchronous between effects)

### 11.5 Canonical Encoding

For byte-equal comparison of IR trees, journal events, and
values:

```
canonical(value):
  if primitive: JSON.stringify(value)
  if array: "[" + join([canonical(item)], ",") + "]"
  if object:
    keys = sort(Object.keys(value))
    return "{" + join(['"'+k+'":'+canonical(v) for (k,v)], ",") + "}"
```

Lexicographic key sorting at every level. No whitespace. Numbers
in shortest round-trip form. All implementations MUST use IEEE 754
binary64 for numeric computation.

---

## 12. Validation

### 12.1 Node Classification

Determined by `tisyn` field alone:

- `tisyn` absent or unrecognized → Literal
- `tisyn` matches discriminant → check required fields
- Matching discriminant + missing fields → **Malformed** (error)

Malformed nodes are NEVER treated as Literals.

### 12.2 Single-Quote Validation

For every structural Eval in the IR:

1. `data` MUST be a Quote node.
2. Let `P = positions(id, data.expr)`.
3. No node in P may be a Quote.

The `positions` function returns the set of Expr nodes that the
operation will `eval()`:

| Operation   | Positions                                |
| ----------- | ---------------------------------------- |
| `let`       | `value`, `body`                          |
| `seq`       | each element of `exprs`                  |
| `if`        | `condition`, `then`, `else` (if present) |
| `while`     | `condition`, each element of `exprs`     |
| `call`      | `fn`, each element of `args`             |
| `get`       | `obj`                                    |
| binary ops  | `a`, `b`                                 |
| unary ops   | `a`                                      |
| `construct` | each value                               |
| `array`     | each element of `items`                  |
| `concat`    | each element of `parts`                  |
| `throw`     | `message`                                |

### 12.3 When Validation Runs

MUST validate when: parsing IR from JSON, receiving IR over the
wire, loading from storage. MAY validate during evaluation.

---

## 13. Execution Lifecycle

### 13.1 Initialization

```
1. Kernel receives: IR tree, initial arguments, journal stream.
2. Build ReplayIndex from journal.
3. Create root task with ID "root".
4. Construct initial environment from arguments:
   E₀ = extend(∅, paramNames, argValues)
5. Begin evaluation: eval(IR.body, E₀)
```

### 13.2 Task States

```
CREATED → RUNNING ⇄ SUSPENDED → COMPLETED | FAILED | CANCELLED
```

| Transition          | Trigger          | Journal event          |
| ------------------- | ---------------- | ---------------------- |
| CREATED → RUNNING   | Task started     | (none)                 |
| RUNNING → SUSPENDED | External Eval    | (none)                 |
| SUSPENDED → RUNNING | Result received  | Yield (before resume)  |
| RUNNING → COMPLETED | Body returns Val | Close(ok)              |
| RUNNING → FAILED    | Unhandled error  | Close(err)             |
| SUSPENDED → FAILED  | Effect error     | Yield(err), Close(err) |
| \* → CANCELLED      | Cancel signal    | Close(cancelled)       |

### 13.3 The Execution Loop

Conceptually, per task:

```
loop:
  result = eval(currentExpr, currentEnv)

  if result is Val:
    write Close(ok, result)
    task → COMPLETED
    return

  if result is Error:
    write Close(err, error)
    task → FAILED
    return

  if result is Suspend(descriptor):
    task → SUSPENDED
    outcome = executionLayer.dispatch(descriptor)
    // dispatch handles: replay check, agent dispatch,
    //                   journal write, ack wait
    if outcome is Val:
      resume evaluation with outcome
      goto loop
    if outcome is Error:
      deliver error to kernel
      goto loop
    if outcome is Cancelled:
      write Close(cancelled)
      task → CANCELLED
      return
```

### 13.4 Completion

Execution is complete when the root task reaches a terminal state
(COMPLETED, FAILED, or CANCELLED). The final Close event for the
root task is the last event in the journal.

### 13.5 Invariants

**P1 — Persist-before-resume.** Every Yield event MUST be durably
acknowledged before the kernel resumes.

**P2 — Close-after-children.** A parent's Close appears after all
children's Closes in the journal.

**P3 — Single writer.** Epoch fencing ensures at most one kernel
writes to a stream at any time.

**P4 — Classification stability.** The classification function
does not change during execution or between replays.

**P5 — Immutable IR.** The IR tree does not change during
execution. It is read-only data.

**P6 — Immutable environment.** Environment frames are
append-only (new frames prepended, never modified).

---

## Appendix A: Kernel API Summary

```
// Core evaluation
eval(expr: Expr, env: Env): Val | Error | Suspend

// Data preparation
unquote(node: Expr, env: Env): Expr | Val
resolve(node: Expr, env: Env): Val

// Environment
lookup(name: string, env: Env): Val | Error
extend(env: Env, name: string, val: Val): Env
extend(env: Env, names: string[], vals: Val[]): Env

// Classification
classify(id: string): STRUCTURAL | EXTERNAL

// Replay
buildIndex(events: Event[]): ReplayIndex
match(coroutineId: string, descriptor: EffectDescriptor): ReplayResult

// Task management
createTask(id: string, expr: Expr, env: Env): Task
cancel(task: Task): void
```

---

## Appendix B: Execution Trace Example

IR:

```
Fn(["orderId"],
  Let("order", Eval("order-service.fetchOrder", [Ref("orderId")]),
    Let("receipt", Eval("payment-service.chargeCard",
          [Get(Ref("order"), "payment")]),
      Ref("receipt"))))
```

Invocation: `Call(workflow, "order-123")`.

```
Step  Kernel action                       Env              Journal
────  ─────────────                       ───              ───────
 1    eval Fn → Fn (value)                ∅
 2    eval Call(Fn, "order-123")          ∅
 3    extend: orderId → "order-123"       {orderId}
 4    eval Let(order, fetchOrder, ...)    {orderId}
 5    eval fetchOrder Eval                {orderId}
 6    resolve data: [Ref(orderId)] → ["order-123"]
 7    SUSPEND {id:"order-service.fetchOrder", data:["order-123"]}
 8    match("root", desc) → LIVE
 9    dispatch to agent                                    Execute→Agent
10    agent returns {id:"123",total:150,payment:{card:"visa"}}
11    Yield written                                        [0] yield root
12    kernel resumes with order value     {orderId}
13    extend: order → {id,total,payment}  {orderId,order}
14    eval Let(receipt, chargeCard, ...)   {orderId,order}
15    eval chargeCard Eval                {orderId,order}
16    resolve data: [Get(Ref(order),"payment")]
      → eval Get → {card:"visa"}
      → [{card:"visa"}]
17    SUSPEND {id:"payment-service.chargeCard", data:[{card:"visa"}]}
18    match("root", desc) → LIVE
19    dispatch to agent                                    Execute→Agent
20    agent returns {receiptId:"r-789"}
21    Yield written                                        [1] yield root
22    kernel resumes with receipt value    {orderId,order}
23    extend: receipt → {receiptId:"r-789"} {orderId,order,receipt}
24    eval Ref("receipt") → {receiptId:"r-789"}
25    Close written                                        [2] close root ok
```

**Replay of same trace after crash at step 17:**

```
Step  Kernel action                       ReplayIndex
────  ─────────────                       ───────────
 1-6  (same as above)                     cursor=0
 7    SUSPEND fetchOrder
 8    match("root") → entry[0] MATCH      cursor→1
 9    feed stored result synchronously     (no dispatch)
10-16 (same as above)
17    SUSPEND chargeCard
18    match("root") → CASE 3 (no entry)   → LIVE
19    dispatch to agent                    (normal execution)
```

Replay consumed one stored Yield synchronously. The second
effect transitioned to live. Journal after completion:

```
[0] yield root order-service.fetchOrder ok {id,total,payment}
[1] yield root payment-service.chargeCard ok {receiptId:"r-789"}
[2] close root ok {receiptId:"r-789"}
```
