# Tisyn System Specification

**Version:** 1.0.0
**Status:** Normative

---

## 1. Overview

Tisyn is a minimal, serializable expression language designed for
durable distributed execution. Programs are JSON documents. They
are evaluated by a host interpreter that dispatches external
operations to remote agents, records results in an append-only
journal, and reconstructs execution state after crashes by
replaying the journal into a fresh interpreter.

The system has three layers:

**Tisyn Core IR.** A JSON-serializable expression language with
five node types. Contains no closures, no prototypes, no Symbols,
no runtime references, and no language-specific constructs. It is
the canonical interface between all layers.

**Authoring Layer.** A TypeScript-specific API of types and
constructor functions that produce IR nodes. Provides phantom type
parameters for IDE inference. Does not exist in the IR.

**Execution Layer.** The runtime that interprets IR trees, manages
task lifecycles, and records durable events. The IR defines what
the execution layer consumes; the execution layer defines what it
does with it.

### 1.1 Layer Boundaries

1. The IR is the interface between all layers.
2. No authoring-layer type appears in the IR.
3. No execution-layer concept (tasks, journals, agents) appears
   in the IR.
4. Serialization is defined on the IR, not on authoring types.

---

## 2. Core Concepts

### 2.1 Expr (Expression)

An expression is a Tisyn IR node — a JSON document that describes
a computation. Expressions are evaluated to produce values.

```
Expr = Literal | Eval | Quote | Ref | Fn
```

An expression is NOT a value until it has been evaluated. A `Ref`
is an instruction to look up a value. An `Eval` is an instruction
to perform a computation. A `Quote` is a container holding an
unevaluated expression.

### 2.2 Val (Value)

A value is the result of evaluating an expression. Values inhabit
environments, cross the execution boundary, and appear in journal
events.

```
Val = JsonPrimitive | JsonArray | JsonObject | FnVal

JsonPrimitive = string | number | boolean | null
JsonArray     = Val[]
JsonObject    = { [key: string]: Val }
FnVal         = { "tisyn": "fn", "params": string[], "body": Expr }
```

A `FnVal` is both a Val and an Expr. It is the only type that
inhabits both sets. When encountered during evaluation, a `Fn`
node evaluates to itself.

The `JsonObject` production has no exclusion clause. Any JSON
object is a valid `JsonObject`, including objects whose `tisyn`
field is `"eval"`, `"quote"`, or `"ref"`.

### 2.3 Context-Based Classification

Whether a JSON object is an Expr or a Val is determined by the
context in which it appears, not by its structure.

The same JSON object `{ "tisyn": "ref", "name": "x" }` is:

- An **Expr** (Ref node) when encountered by the evaluator or
  `resolve()` during IR tree traversal
- A **Val** (opaque data) when returned by `lookup()`, returned
  by `eval()`, received from an agent, or loaded from the journal

Implementations MUST NOT inspect `tisyn` fields to determine
whether a value is "really" an IR node. The origin determines
classification.

| Origin                                        | Classification |
| --------------------------------------------- | -------------- |
| Node in IR tree being walked                  | Expr           |
| Result of `lookup(name, E)`                   | Val            |
| Result of `eval(expr, E)` (except Rule QUOTE) | Val            |
| Agent response `result.value`                 | Val            |
| Journal `result.value`                        | Val            |

There is no `is_val` predicate. Implementations do not need a
function that inspects a value's structure to determine if it is
a Val. The code paths guarantee it: `lookup` returns Val (by
environment invariant), `eval` returns Val (by evaluation rules),
agent responses are Val (by protocol), `resolve` returns Val for
terminal positions (by the opaque value rule).

### 2.4 Serialization Guarantee

For every Val `v`:

```
JSON.parse(JSON.stringify(v)) ≡ v
```

For every Expr `e`:

```
JSON.parse(JSON.stringify(e)) ≡ e
```

All IR nodes and all values are JSON round-trip safe.

### 2.5 Prohibited Values

The following MUST NOT appear anywhere in an IR tree or value:

`undefined`, `Infinity`, `-Infinity`, `NaN`, `BigInt`, `Symbol`,
`Date`, `RegExp`, `Map`, `Set`, `WeakMap`, `WeakSet`,
`ArrayBuffer`, `TypedArray`, functions (JS), class instances,
circular references.

---

## 3. Node Definitions

### 3.1 Eval

```json
{ "tisyn": "eval", "id": "<string>", "data": "<Expr>" }
```

A computation. `id` names the operation (non-empty string).
`data` carries the input (any Expr).

### 3.2 Quote

```json
{ "tisyn": "quote", "expr": "<Expr>" }
```

A delayed node. Inert until explicitly unquoted.

### 3.3 Ref

```json
{ "tisyn": "ref", "name": "<string>" }
```

A reference to a value in the environment (non-empty string).

### 3.4 Fn

```json
{ "tisyn": "fn", "params": ["<string>", ...], "body": "<Expr>" }
```

A function value. `params` is an ordered list of non-empty strings
with no duplicates. `body` is any Expr. No captured environment.

A `Fn` node is a value — it does not execute when encountered.
It becomes executable only via `call`.

### 3.5 Literal

Any JSON value that either lacks a `tisyn` field or has a `tisyn`
field not equal to `"eval"`, `"quote"`, `"ref"`, or `"fn"`.

### 3.6 Grammar

```
Expr     = Literal | Eval | Quote | Ref | Fn
Literal  = <JSON value not matching Eval | Quote | Ref | Fn>
Eval     = { "tisyn": "eval", "id": string, "data": Expr }
Quote    = { "tisyn": "quote", "expr": Expr }
Ref      = { "tisyn": "ref", "name": string }
Fn       = { "tisyn": "fn", "params": string[], "body": Expr }
```

The grammar is closed. No extensions without new discriminant
values.

### 3.7 Discriminant Table

| `tisyn` value       | Node type | Required fields                   |
| ------------------- | --------- | --------------------------------- |
| `"eval"`            | Eval      | `id` (string), `data` (any)       |
| `"quote"`           | Quote     | `expr` (any)                      |
| `"ref"`             | Ref       | `name` (string)                   |
| `"fn"`              | Fn        | `params` (string[]), `body` (any) |
| _(absent or other)_ | Literal   | _(the value itself)_              |

---

## 4. Environment

### 4.1 Definition

An environment is an ordered chain of frames:

```
Env   = (Frame, Env) | ∅
Frame = { name → Val }     (finite map, string keys, Val values)
```

### 4.2 Lookup

```
lookup(name, ∅)             = ERROR UnboundVariable(name)
lookup(name, (frame, rest)) = frame[name]           if name ∈ frame
                            = lookup(name, rest)     otherwise
```

### 4.3 Extension

```
extend(E, name, val)                  = ({ name → val }, E)
extend(E, [n₁...nₖ], [v₁...vₖ])     = ({ n₁→v₁, ..., nₖ→vₖ }, E)
extend(E, [n₁...nₖ], [v₁...vⱼ])     = ERROR ArityMismatch   when k ≠ j
```

### 4.4 Environment Contains Only Values

No Expr that is not also a Val may appear in an environment
binding. The evaluator MUST fully evaluate an expression before
placing its result in the environment.

### 4.5 Environments Do NOT Cross Transport Boundaries

Environments are interpreter-internal state. They are NOT
serialized, NOT journaled, NOT sent over the wire, and NOT
shared between host and agent. On crash recovery, the
environment is reconstructed by replaying the journal.

### 4.6 Shadowing and Immutability

A binding in an inner frame shadows one with the same name in
an outer frame. There is no mutation operation. Bindings are set
at frame creation and never change.

---

## 5. Evaluation Model

### 5.1 The `eval` Function

```
eval : Expr × Env → Val | Error
```

Evaluation is deterministic: the same expression in the same
environment always produces the same result.

### 5.2 The `unquote` Operation

```
unquote(node, E):
  if node.tisyn = "quote":
    return node.expr
  else:
    return eval(node, E)
```

`unquote` returns the raw contents of a Quote node without
evaluating them. The result is an Expr, NOT necessarily a Val.
`unquote` is used exclusively by structural operations to
destructure their quoted data.

### 5.3 Evaluation Rules

**Rule LITERAL:**

```
eval(literal, E) = literal
```

**Rule REF:**

```
eval({ tisyn: "ref", name: N }, E) = lookup(N, E)
```

**Rule QUOTE:**

```
eval({ tisyn: "quote", expr: X }, E) = X
```

Returns the contained expression without evaluating it. This is
the only rule that may return a non-Val. It is used exclusively
by `unquote` and `resolve`.

**Rule FN:**

```
eval({ tisyn: "fn", params: P, body: B }, E) =
  { tisyn: "fn", params: P, body: B }
```

A Fn node evaluates to itself. No environment is captured.

**Rule EVAL:**

```
eval({ tisyn: "eval", id: ID, data: D }, E):
  if classify(ID) = STRUCTURAL → eval_structural(ID, D, E)
  if classify(ID) = EXTERNAL   → eval_external(ID, D, E)
```

### 5.4 Truthy and Falsy

```
truthy(v) = v ∉ { false, null, 0, "" }
```

All other JSON values (including `[]` and `{}`) are truthy.
`undefined` does not exist in the IR.

### 5.5 Function Scoping

When a function is called, its body evaluates in the **caller's
environment** extended with parameter bindings. There is no
captured environment. This is call-site resolution.

```
eval(Call { fn, args }, E):
  F = eval(fn, E)
  Vs = [eval(a, E) for a in args]
  E_call = extend(E, F.params, Vs)
  return eval(F.body, E_call)
```

Free Refs in the body resolve at the call site. The compiler
MUST ensure every Fn it produces either has no free variables
or has all free variables guaranteed in scope at every call site.

## 6. Structural Operations

Structural operations are `Eval` nodes whose `id` is in the
structural set. The evaluator handles them locally. They produce
no journal events and cause no task suspension.

Each operation's `data` is a Quote node containing the operation's
fields. The evaluator calls `unquote(data, E)` to obtain the raw
fields, then selectively `eval`s sub-expressions.

### 6.1 let

```json
{
  "tisyn": "eval",
  "id": "let",
  "data": {
    "tisyn": "quote",
    "expr": {
      "name": "<string>",
      "value": "<Expr>",
      "body": "<Expr>"
    }
  }
}
```

```
eval_structural("let", D, E):
  { name, value, body } = unquote(D, E)
  V = eval(value, E)
  E' = extend(E, name, V)
  return eval(body, E')
```

The binding is visible only within `body`. It is not visible in
`value`. There is no self-reference. Bindings are immutable.

### 6.2 seq

```json
{ "tisyn": "eval", "id": "seq",
  "data": { "tisyn": "quote", "expr": {
    "exprs": ["<Expr>", ...] }}}
```

```
eval_structural("seq", D, E):
  { exprs } = unquote(D, E)
  result = null
  for expr in exprs:
    result = eval(expr, E)
  return result
```

Seq does NOT create a new scope. All elements evaluate in the
same environment. Bindings from `let` inside one element are NOT
visible in subsequent elements.

### 6.3 if

```json
{
  "tisyn": "eval",
  "id": "if",
  "data": {
    "tisyn": "quote",
    "expr": {
      "condition": "<Expr>",
      "then": "<Expr>",
      "else": "<Expr | absent>"
    }
  }
}
```

```
eval_structural("if", D, E):
  { condition, then, else } = unquote(D, E)
  C = eval(condition, E)
  if truthy(C): return eval(then, E)
  if "else" present: return eval(else, E)
  return null
```

### 6.4 while

```json
{ "tisyn": "eval", "id": "while",
  "data": { "tisyn": "quote", "expr": {
    "condition": "<Expr>", "exprs": ["<Expr>", ...] }}}
```

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

The condition and body expressions are re-evaluated each
iteration from the unquoted Expr nodes.

### 6.5 call

```json
{ "tisyn": "eval", "id": "call",
  "data": { "tisyn": "quote", "expr": {
    "fn": "<Expr>", "args": ["<Expr>", ...] }}}
```

```
eval_structural("call", D, E):
  { fn, args } = unquote(D, E)
  F = eval(fn, E)
  assert F.tisyn = "fn", else ERROR NotCallable(F)
  Vs = [eval(a, E) for a in args]
  E' = extend(E, F.params, Vs)
  return eval(F.body, E')
```

Arguments are evaluated left-to-right. The body evaluates in the
caller's environment extended with parameter bindings.

### 6.6 get

```json
{
  "tisyn": "eval",
  "id": "get",
  "data": {
    "tisyn": "quote",
    "expr": {
      "obj": "<Expr>",
      "key": "<string>"
    }
  }
}
```

```
eval_structural("get", D, E):
  { obj, key } = unquote(D, E)
  O = eval(obj, E)
  if O is object and key ∈ O: return O[key]
  return null
```

`key` is a string literal, not an expression. It is not evaluated.

### 6.7 Binary Operators

Shape: `data: Q({ a: Expr, b: Expr })`.

**Arithmetic** (`add`, `sub`, `mul`, `div`, `mod`):

```
eval_structural(op, D, E):
  { a, b } = unquote(D, E)
  A = eval(a, E)
  B = eval(b, E)
  if typeof A ≠ number: raise TypeError(op + ": left operand")
  if typeof B ≠ number: raise TypeError(op + ": right operand")
  if op ∈ {"div","mod"} and B = 0: raise DivisionByZero
  return apply_binop(op, A, B)
```

Arithmetic and comparison operators are **numeric-only**. Non-
numeric operands raise TypeError. String concatenation belongs
only to `concat`.

**Comparison** (`gt`, `gte`, `lt`, `lte`):

Same as arithmetic: numeric operands only, TypeError otherwise.
Returns boolean.

**Equality** (`eq`, `neq`):

Accept ANY Val types. Comparison uses canonical encoding:

```
eq(A, B) = canonical(A) === canonical(B)
```

Returns boolean.

**Short-circuit** (`and`, `or`):

Accept ANY Val types. Return **operand values**, not booleans:

```
eval_structural("and", D, E):
  { a, b } = unquote(D, E)
  A = eval(a, E)
  if not truthy(A): return A          // return A, not false
  return eval(b, E)                   // return B, not true

eval_structural("or", D, E):
  { a, b } = unquote(D, E)
  A = eval(a, E)
  if truthy(A): return A              // return A, not true
  return eval(b, E)                   // return B, not false
```

Examples:

```
And(0, "hello")    → 0        (0 is falsy, returned as-is)
And("ok", "hello") → "hello"  ("ok" truthy, B returned)
Or(42, "hello")    → 42       (42 truthy, returned as-is)
Or(false, null)    → null     (false falsy, B returned)
```

### 6.8 Unary Operators

Shape: `data: Q({ a: Expr })`.

`not`: Accepts any Val. Always returns boolean.

```
Not(42)   → false
Not(0)    → true
Not(null) → true
```

`neg`: Numeric only. TypeError on non-number.

### 6.9 Operator Summary

| Operator                          | Accepts        | Returns       | Error on                    |
| --------------------------------- | -------------- | ------------- | --------------------------- |
| `add`, `sub`, `mul`, `div`, `mod` | number, number | number        | Non-number; div/mod by zero |
| `neg`                             | number         | number        | Non-number                  |
| `gt`, `gte`, `lt`, `lte`          | number, number | boolean       | Non-number                  |
| `eq`, `neq`                       | any, any       | boolean       | (never)                     |
| `and`, `or`                       | any, any       | any (operand) | (never)                     |
| `not`                             | any            | boolean       | (never)                     |
| `concat`                          | any[]          | string        | (never — coerces to string) |

### 6.10 construct

```json
{ "tisyn": "eval", "id": "construct",
  "data": { "tisyn": "quote", "expr": {
    "<key>": "<Expr>", ... }}}
```

```
eval_structural("construct", D, E):
  fields = unquote(D, E)
  keys = Object.keys(fields).sort()    // lexicographic order
  result = {}
  for key in keys:
    result[key] = eval(fields[key], E)
  return result
```

`construct` MUST evaluate fields in **lexicographic key order**
(Unicode code point order, ascending). This ensures deterministic
effect ordering across languages with different object iteration
behavior.

### 6.11 array

```json
{ "tisyn": "eval", "id": "array",
  "data": { "tisyn": "quote", "expr": {
    "items": ["<Expr>", ...] }}}
```

Evaluate each item left-to-right. Return the array.

### 6.12 concat

Shape: `data: Q({ parts: [Expr, ...] })`.

Evaluate each part, coerce to string, concatenate, return.

### 6.13 throw

Shape: `data: Q({ message: Expr })`.

```
eval_structural("throw", D, E):
  { message } = unquote(D, E)
  M = eval(message, E)
  raise Error(M)
```

---

## 7. External Operations and the Execution Boundary

### 7.1 Classification

Every `Eval.id` is classified by the interpreter:

```
classify : string → STRUCTURAL | EXTERNAL
```

The structural set:

```
STRUCTURAL_IDS = {
  "let", "seq", "if", "while", "call", "get",
  "gt", "gte", "lt", "lte", "eq", "neq",
  "add", "sub", "mul", "div", "mod",
  "and", "or", "not", "neg",
  "construct", "array", "concat", "throw"
}

classify(id) = STRUCTURAL  if id ∈ STRUCTURAL_IDS
classify(id) = EXTERNAL    otherwise
```

An interpreter MAY override classification, but overrides MUST be
declared at initialization and MUST NOT change during execution.
Classification MUST be identical between the original execution
and any replay.

### 7.2 Classification Properties

| Property           | STRUCTURAL     | EXTERNAL                    |
| ------------------ | -------------- | --------------------------- |
| Evaluated by       | Host evaluator | Agent (via execution layer) |
| Journaled?         | No             | Yes (Yield event)           |
| Causes suspension? | No             | Yes                         |

### 7.3 The Dot Convention

By convention, external `id` values use dotted notation:

```
"fraud-detector.fraudCheck"
 └─── agent id ──┘└── method ──┘
```

The execution layer splits on the first dot. This is a convention,
not an IR rule.

### 7.4 Crossing the Boundary

When the evaluator encounters a standard external Eval:

```
eval_external(ID, D, E):
  resolved = resolve(D, E)              // Step 1: resolve
  descriptor = { id: ID, data: resolved }
  result = YIELD descriptor             // Step 2: suspend
  return result                         // Step 3: resume
```

**Step 1 — Resolve.** Call `resolve(D, E)` to produce a fully
resolved Val. See §9 for the `resolve` algorithm.

**Step 2 — Yield.** Hand the descriptor to the execution layer.
Task state → SUSPENDED.

**Step 3 — Resume.** Execution layer provides a Val (or Error).
Task state → RUNNING. Evaluator returns the result.

### 7.5 What Crosses the Boundary

| Direction             | Payload           | Type                        |
| --------------------- | ----------------- | --------------------------- |
| Evaluator → Execution | Effect descriptor | `{ id: string, data: Val }` |
| Execution → Evaluator | Success result    | Val                         |
| Execution → Evaluator | Error result      | Error                       |
| Execution → Evaluator | Cancellation      | Signal                      |

The execution layer NEVER receives unevaluated IR nodes for
standard external operations. Exception: concurrency nodes (§8).

---

## 8. Concurrency Semantics

### 8.1 The IR Has No Concurrency

The IR is a sequential expression language. There are no fork,
join, spawn, or parallel primitives. Concurrency is introduced
by the execution layer's interpretation of specific external
`Eval.id` values.

### 8.2 Compound External Operations

The compound external operation set is:

```
COMPOUND_EXTERNAL_IDS = { "all", "race" }
```

These operations carry arrays of unevaluated child Expr nodes
that the execution layer evaluates in separate tasks.

For compound external operations, `eval_external` uses `unquote`
instead of `resolve`, preserving child expressions:

```
eval_external(ID, D, E):
  if ID ∈ COMPOUND_EXTERNAL_IDS:
    inner = unquote(D, E)
    descriptor = { id: ID, data: inner }
    result = YIELD descriptor
    return result

  if ID = "spawn":
    inner = unquote(D, E)
    descriptor = { id: ID, data: inner }
    result = YIELD descriptor
    return result

  // Standard external
  resolved = resolve(D, E)
  descriptor = { id: ID, data: resolved }
  result = YIELD descriptor
  return result
```

`resolve()` MUST NOT evaluate or traverse into child expression
arrays of concurrency operations.

### 8.3 all

```json
{ "tisyn": "eval", "id": "all",
  "data": { "tisyn": "quote", "expr": {
    "exprs": ["<Expr>", ...] }}}
```

**Execution-layer semantics:**

1. For each expr in `exprs`, create a child task with the
   parent's environment.
2. Children run concurrently.
3. Parent task is SUSPENDED until all complete.
4. Results returned in `exprs` order (not completion order).
5. If any child fails: remaining children cancelled, error
   propagates to parent.
6. If parent cancelled: all children cancelled.

Empty `exprs` → return `[]` immediately.

### 8.4 race

Same shape as `all`. Execution-layer semantics:

1. First child to complete successfully wins.
2. All other children cancelled.
3. If a child fails, it does NOT win — race continues with
   remaining children.
4. If ALL children fail, the last error propagates.
5. Return value is the winner's result (not an array).

One child → equivalent to evaluating the child directly.

### 8.5 Cancellation Propagation

Cancellation propagates downward in reverse creation order:

```
cancel(task):
  if task is terminal: return
  task.cancelling = true                 // point of no return
  for child in task.children.reverse():
    cancel(child)
  task.evaluator.return()
  write Close(cancelled)
  task → CANCELLED
```

**Point-of-no-return.** Once `task.cancelling` is `true`, any
agent result received for that task's pending effect is discarded.
No Yield event is written. Cancellation is irrevocable.

**Structured concurrency invariants** (enforced by execution
layer):

1. Every child task has exactly one parent.
2. No child outlives its parent.
3. Cancelling a parent cancels all descendants.
4. A scope exits only after all children terminate.

### 8.6 Task Identity

Task IDs MUST match `^root(\.\d+)*$`.

```
root task:            "root"
child N of parent P:  P + "." + N
```

N is a non-negative integer, incrementing per parent from 0.
Task IDs are generated exclusively by this scheme — not user-
chosen, not configurable, not random.

**Correlation IDs:** `"{taskId}:{yieldIndex}"`. Since taskIds
never contain colons, the separator is unambiguous.

---

## 9. The `resolve` Function

### 9.1 Purpose

`resolve(data, E)` produces a fully resolved Val from an Expr,
recursively entering arrays and objects to resolve any nested
Expr nodes. It is used exclusively at the external effect
boundary (§7.4 Step 1) for standard (non-compound) operations.

### 9.2 The Opaque Value Rule

> `resolve()` MUST NOT recurse into any value returned by
> `lookup()` or `eval()`. Such values are **terminal** — they
> are returned without inspection, traversal, or re-evaluation,
> regardless of their structure. Implementations MUST NOT
> re-interpret or re-evaluate such values.

This holds even if the returned value contains a `tisyn` field,
structurally matches an IR node, or contains nested objects
resembling IR expressions.

### 9.3 Algorithm

```
resolve(node, E):

  // ── TERMINAL: values from lookup/eval are opaque ──

  if node.tisyn = "ref":
    return lookup(node.name, E)          // TERMINAL

  if node.tisyn = "eval":
    return eval(node, E)                 // TERMINAL

  if node.tisyn = "fn":
    return node                          // TERMINAL

  // ── UNWRAP: Quote removes one layer ──

  if node.tisyn = "quote":
    return resolve(node.expr, E)

  // ── TRAVERSABLE: plain arrays and objects ──

  if node is array:
    return [resolve(item, E) for item in node]

  if node is object:
    result = {}
    for (key, child) in node:
      result[key] = resolve(child, E)
    return result

  // ── TERMINAL: primitives ──

  return node
```

### 9.4 Categories

| Category        | Behavior                              | Examples                                          |
| --------------- | ------------------------------------- | ------------------------------------------------- |
| **Terminal**    | Return as-is. No traversal.           | Results of `lookup`, `eval`; Fn nodes; primitives |
| **Unwrap**      | Remove Quote layer, resolve contents. | Quote nodes                                       |
| **Traversable** | Recurse into children.                | Plain arrays; objects without matching `tisyn`    |

Only plain arrays and objects without a matching `tisyn`
discriminant are traversable.

### 9.5 Postcondition

After `resolve(data, E)`, the result contains no `Ref`, `Eval`,
or `Quote` nodes. Only Val (primitives, arrays, objects, Fn).

### 9.6 Enforcement Criterion

An implementation satisfies the opaque value rule if and only if:
replacing every value in every environment binding with a sentinel
does not change the output of `resolve()` beyond the expected
sentinel substitutions at terminal positions.

---

## 10. Validation Rules

### 10.1 Node Classification

Classification is determined by the `tisyn` field alone:

```
classify_node(value):
  if value is not an object: → Literal
  if value has no "tisyn" field: → Literal
  if value.tisyn = "eval":  → Eval (check required fields)
  if value.tisyn = "quote": → Quote (check required fields)
  if value.tisyn = "ref":   → Ref (check required fields)
  if value.tisyn = "fn":    → Fn (check required fields)
  otherwise:                → Literal
```

### 10.2 Malformed Node Rule

If a node has a `tisyn` field matching a discriminant but is
missing any required field or has a required field of the wrong
type, the node is **malformed**. Malformed nodes are errors.
They are NEVER treated as Literals.

### 10.3 Fn Param Validation

`params` must be an array of non-empty strings with no duplicates.

### 10.4 Single-Quote Validation Rule

For every structural Eval node `{ tisyn: "eval", id: ID, data: D }`
where `classify(ID) = STRUCTURAL`:

1. `D` MUST be a Quote node. If not → malformed.
2. Let `fields = D.expr`.
3. Let `P = positions(ID, fields)`.
4. For every node `N` in `P`: if `N.tisyn = "quote"` →
   **malformed**.

### 10.5 The `positions` Function

`positions(id, fields)` returns the set of nodes that the
structural operation will `eval()` on:

| Operation   | `fields` shape                | Evaluation positions                     |
| ----------- | ----------------------------- | ---------------------------------------- |
| `let`       | `{ name, value, body }`       | `value`, `body`                          |
| `seq`       | `{ exprs: [...] }`            | each element of `exprs`                  |
| `if`        | `{ condition, then, else? }`  | `condition`, `then`, `else` (if present) |
| `while`     | `{ condition, exprs: [...] }` | `condition`, each element of `exprs`     |
| `call`      | `{ fn, args: [...] }`         | `fn`, each element of `args`             |
| `get`       | `{ obj, key }`                | `obj` only                               |
| binary ops  | `{ a, b }`                    | `a`, `b`                                 |
| unary ops   | `{ a }`                       | `a`                                      |
| `construct` | `{ k₁: v₁, ... }`             | each value                               |
| `array`     | `{ items: [...] }`            | each element of `items`                  |
| `concat`    | `{ parts: [...] }`            | each element of `parts`                  |
| `throw`     | `{ message }`                 | `message`                                |

This table is exhaustive. The check is one level deep — it
examines only nodes at evaluation positions, not their children.

**Non-positions** (not checked): `let.name`, `get.key`, the
`fields` object itself, absent `if.else`.

### 10.6 When Validation Occurs

Implementations MUST validate when: parsing IR from JSON,
receiving IR over the wire, loading IR from storage. Implementations
MAY additionally validate during evaluation.

## 11. Runtime Model

### 11.1 Components

```
Runtime
├── Evaluator         — walks IR tree, applies evaluation rules
├── Task Tree         — parent/child task relationships
├── Durable Stream    — append-only journal of Yield/Close events
├── Replay Index      — per-coroutine cursor over stored events
├── Agent Router      — maps effect type to agent connection
└── Transport Pool    — manages connections to agents
```

### 11.2 Task Lifecycle

A task has exactly one state at any instant:

```
CREATED → RUNNING ⇄ SUSPENDED → COMPLETED
                                → FAILED
         (any non-terminal)     → CANCELLED
```

Terminal states: COMPLETED, FAILED, CANCELLED.

| From      | To        | Trigger         | Journal                |
| --------- | --------- | --------------- | ---------------------- |
| CREATED   | RUNNING   | Start           | (none)                 |
| RUNNING   | SUSPENDED | External Eval   | (none)                 |
| SUSPENDED | RUNNING   | Result received | Yield (before resume)  |
| RUNNING   | COMPLETED | Body returns    | Close(ok)              |
| RUNNING   | FAILED    | Unhandled error | Close(err)             |
| SUSPENDED | FAILED    | Effect error    | Yield(err), Close(err) |
| \*        | CANCELLED | Cancel signal   | Close(cancelled)       |

**Critical:** SUSPENDED → RUNNING writes the Yield event and
awaits durable acknowledgment BEFORE calling `generator.next()`.
This is the persist-before-resume invariant.

### 11.3 Continuation Model

Continuations are NOT serialized. There is no reified continuation
object. The JavaScript generator is suspended at a `yield`
statement — an opaque V8 heap object.

**Crash recovery:** Replay the journal into a fresh generator.
Same tree + same stored results → same branches → same state.

**Replay is synchronous.** Every stored effect resolves
synchronously inside `DurableEffect.enter()`. A workflow with
1000 Yield events replays in one tick.

### 11.4 Replay Index

```
ReplayIndex:
  yields:  Map<CoroutineId, Array<{ description, result }>>
  cursors: Map<CoroutineId, number>
  closes:  Map<CoroutineId, CloseEvent>
```

**Matching algorithm** when the evaluator yields descriptor `D`
for `coroutineId`:

```
match(coroutineId, D):
  entry = peekYield(coroutineId)

  CASE 1: entry exists
    if D.type ≠ entry.description.type → DIVERGENCE
    if D.name ≠ entry.description.name → DIVERGENCE
    consumeYield(coroutineId)
    return entry.result                    // REPLAY

  CASE 2: entry absent, close exists     → DIVERGENCE

  CASE 3: entry absent, no close         → LIVE (dispatch)
```

Description matching compares only `type` and `name`.
Divergence is fatal — execution halts.

### 11.5 Durable Events

Two event types:

**Yield:**

```json
{
  "type": "yield",
  "coroutineId": "root.0",
  "description": { "type": "fraud-detector", "name": "fraudCheck" },
  "result": { "status": "ok", "value": true }
}
```

**Close:**

```json
{
  "type": "close",
  "coroutineId": "root.0",
  "result": { "status": "ok", "value": { "receiptId": "r-456" } }
}
```

**Event result types:**

```
EventResult =
  | { status: "ok", value?: Val }
  | { status: "err", error: { message: string, name?: string } }
  | { status: "cancelled" }
```

**Ordering guarantees:**

1. Events within a stream are totally ordered.
2. A child's Close precedes the parent's Yield consuming it.
3. Yields for a coroutine appear in yield order.
4. Close appears after all Yields for that coroutine.
5. Parent's Close appears after all children's Closes.

### 11.6 Durability Guarantees

**G1.** Acknowledged events persist across crashes.
**G2.** Unacknowledged events may not persist.
**G3.** Persist-before-resume: Yield MUST be ack'd before
generator resumes.
**G4.** Close-after-children: parent's Close after all children's.
**G5.** Causal ordering in the stream.
**G6.** Single writer: epoch fencing prevents split-brain.

Durability does NOT guarantee exactly-once effect execution.
Effects may execute zero times (replay) or more than once
(crash + re-dispatch). Agents must handle at-least-once delivery.

### 11.7 Resource and Cleanup Semantics

Cleanup effects (in `finally` blocks during scope destruction)
continue the same yield index sequence as normal effects. The
yield index is NOT reset. Cleanup effects use the same
correlation ID scheme.

```
Task root.0:
  [0] yield agent.acquire ok            (id: "root.0:0")
  [1] yield agent.riskyOp err "boom"    (id: "root.0:1")
  [2] yield agent.release ok            (cleanup, id: "root.0:2")
  [3] close root.0 err "boom"
```

The ReplayIndex does not distinguish cleanup effects from normal
effects.

Cleanup effects during cancellation are best-effort. If they
complete before the parent's teardown, they are journaled.

---

## 12. Wire Protocol

### 12.1 Transport Independence

Messages are JSON objects conforming to JSON-RPC 2.0. The
protocol does not prescribe a transport. Supported bindings:
WebSocket, stdio (NDJSON), SSE + POST, in-process.

### 12.2 Message Catalog

Six message types. No others.

| Message    | Direction    | JSON-RPC Type | Response?       |
| ---------- | ------------ | ------------- | --------------- |
| Initialize | Agent → Host | Request       | Yes             |
| Execute    | Host → Agent | Request       | Yes             |
| Result     | Agent → Host | Response      | _(is response)_ |
| Progress   | Agent → Host | Notification  | No              |
| Cancel     | Host → Agent | Notification  | No              |
| Shutdown   | Host → Agent | Notification  | No              |

### 12.3 Initialize

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "1.0",
    "agentId": "fraud-detector",
    "capabilities": {
      "methods": ["fraudCheck", "riskScore"],
      "progress": true,
      "concurrency": 10
    }
  }
}
```

Response:

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "protocolVersion": "1.0", "sessionId": "sess-123" } }
```

Initialize MUST be the first message. No Execute before it
completes. Incompatible version → error `-32002`, close.

### 12.4 Execute

```json
{
  "jsonrpc": "2.0",
  "id": "root.0:2",
  "method": "execute",
  "params": {
    "executionId": "ex-abc-123",
    "taskId": "root.0",
    "operation": "fraudCheck",
    "args": [{ "id": "order-123", "total": 150 }],
    "progressToken": "root.0:2",
    "deadline": "2026-03-19T12:05:00Z"
  }
}
```

| Field           | Type   | Required | Description                            |
| --------------- | ------ | -------- | -------------------------------------- |
| `id`            | string | Yes      | Correlation: `"{taskId}:{yieldIndex}"` |
| `executionId`   | string | Yes      | Workflow execution instance            |
| `taskId`        | string | Yes      | Coroutine ID                           |
| `operation`     | string | Yes      | Method name                            |
| `args`          | Val[]  | Yes      | Resolved arguments                     |
| `progressToken` | string | No       | For progress notifications             |
| `deadline`      | string | No       | ISO 8601 absolute deadline             |

### 12.5 Result

**Success:**

```json
{ "jsonrpc": "2.0", "id": "root.0:2", "result": { "ok": true, "value": true } }
```

**Application error:**

```json
{
  "jsonrpc": "2.0",
  "id": "root.0:2",
  "result": { "ok": false, "error": { "message": "unavailable", "name": "ServiceError" } }
}
```

**Protocol error:**

```json
{ "jsonrpc": "2.0", "id": "root.0:2", "error": { "code": -32601, "message": "Method not found" } }
```

Application errors (`result.ok: false`) are journaled as
Yield(err). Protocol errors (JSON-RPC `error`) are NOT
journaled.

### 12.6 Progress

```json
{
  "jsonrpc": "2.0",
  "method": "progress",
  "params": { "token": "root.0:2", "value": { "phase": "analyzing", "percent": 45 } }
}
```

NOT journaled. NOT replayed. Best-effort. Ordered per-token.
Discarded for unknown or expired tokens.

### 12.7 Cancel

```json
{
  "jsonrpc": "2.0",
  "method": "cancel",
  "params": { "id": "root.0:2", "reason": "parent_cancelled" }
}
```

Best-effort. No response expected. The host does not wait for
acknowledgment.

### 12.8 Shutdown

```json
{ "jsonrpc": "2.0", "method": "shutdown", "params": {} }
```

Agent should complete or cancel in-flight operations, then close.

### 12.9 Connection Lifecycle

```
Agent connects → Initialize → Ready → Execute/Cancel/Progress → Shutdown → Close
```

Multiple Execute requests may be in-flight simultaneously up to
the agent's declared `concurrency` limit. Results may arrive in
any order.

### 12.10 Reconnection

A transport reconnection is a **fresh session**. There is no
protocol-level session resumption.

1. Connection drops.
2. Host marks pending effects as UNRESOLVED.
3. Agent reconnects, sends Initialize.
4. Host re-dispatches UNRESOLVED effects (same correlation IDs).

Re-dispatch may cause duplicate execution. Agents must handle
at-least-once delivery.

---

## 13. Determinism Guarantees

### 13.1 The Determinism Theorem

For a given expression tree `T`, initial environment `E₀`,
effect result sequence `R`, and classification function `C`:

Evaluation produces a unique sequence of effect descriptors, a
unique final value, and a unique task tree.

### 13.2 What Must Be Deterministic

| Requirement           | Guaranteed by                       |
| --------------------- | ----------------------------------- |
| Structural operations | All rules are pure functions        |
| Effect ordering       | Single-threaded within a task       |
| Branching decisions   | Same results → same conditions      |
| Task spawn ordering   | Synchronous reducer, priority queue |
| Construct field order | Lexicographic key sorting           |

### 13.3 What Is Non-Deterministic

| Component                         | How handled            |
| --------------------------------- | ---------------------- |
| Effect result values              | Journal stores results |
| Wall-clock timing                 | Time is an effect      |
| Concurrent child completion order | Per-coroutine cursors  |

### 13.4 Structural Determinism

The IR provides determinism structurally — no `Math.random()`,
no `Date.now()`, no `Map` iteration, no `for...in`, no `Symbol`,
no async scheduling. All non-determinism is confined to external
effects, captured by the journal.

### 13.5 Canonical JSON Encoding

The canonical encoding of a JSON value uses lexicographic key
sorting at every nesting level:

```
canonical(value):
  if primitive: JSON.stringify(value)
  if array: "[" + join([canonical(item)], ",") + "]"
  if object:
    keys = Object.keys(value).sort()
    pairs = ['"' + key + '":' + canonical(value[key]) for key in keys]
    return "{" + join(pairs, ",") + "}"
```

Properties: no whitespace, keys sorted lexicographically,
numbers in shortest round-trip form, strings per RFC 8259 §7.

Used for byte-equal comparison, hashing, interoperability
testing. Wire messages and journal storage MAY use non-canonical
encoding.

All implementations MUST use IEEE 754 binary64 for numeric
computation and JSON number parsing.

---

## 14. Error Semantics

### 14.1 Errors Are Exceptions, Not Values

The IR has no `Result<T, E>` wrapper. Evaluation either returns
a Val or raises an Error. The `{ ok, value, error }` shape exists
only on the wire and in journal events. The execution layer
translates between representations.

### 14.2 Error Types

| Type            | Cause                 |
| --------------- | --------------------- |
| UnboundVariable | Ref resolution failed |
| NotCallable     | Call on non-Fn value  |
| ArityMismatch   | Wrong argument count  |
| TypeError       | Invalid operand type  |
| DivisionByZero  | div/mod by zero       |
| ExplicitThrow   | throw node evaluated  |
| EffectError     | Agent returned error  |
| DivergenceError | Replay mismatch       |
| MalformedIR     | Invalid IR structure  |

### 14.3 Propagation Rules

When a sub-expression errors, the enclosing operation stops and
propagates. No further sub-expressions are evaluated.

**let:** Error in `value` → propagate (body not evaluated).
Error in `body` → propagate.

**seq:** First error stops the sequence.

**if:** Error in `condition` → propagate (no branch evaluated).
Error in selected branch → propagate.

**while:** Error in condition or body → propagate, loop ends.

**call:** Error in fn → propagate. Error in any arg → propagate
(remaining args skipped, left-to-right). Error in body → propagate.

**Binary ops (non-short-circuit):** Error in left → propagate
(right not evaluated). Left evaluated first.

**Short-circuit:** `and`: if `a` errors → propagate. If `a`
falsy → return A (no error, b not evaluated). Otherwise evaluate
`b` normally.

### 14.4 Propagation at the Execution Boundary

When an error reaches the top of a task's expression tree:

1. Execution layer catches it.
2. Close(err) written.
3. Task → FAILED.
4. Parent notified per structured concurrency rules.

### 14.5 Effect Errors

Agent returns `{ ok: false, error }`:

1. Yield(err) written, ack'd.
2. `generator.throw(error)` called.
3. If caught at generator level → task continues.
4. If uncaught → propagates to task boundary.

On replay, same error re-raised from journal.

### 14.6 Cancellation Is Not an Error

Cancellation propagates downward, not upward. It is a distinct
signal: `generator.return()`, not `generator.throw()`. A parent's
`catch` does NOT catch cancellation.

### 14.7 No Try/Catch in the IR

The IR has no error-handling construct. Error handling is at the
generator level using JavaScript `try/catch`. A future `try`
structural operation is deferred until journal interaction
semantics are resolved.

---

## 15. Agent Abstraction

### 15.1 Definition

`Agent()` is an authoring-layer factory. It produces IR `Eval`
nodes at call sites and provides generator implementations to
the agent runtime.

```typescript
const FraudDetector = Agent("fraud-detector", {
  *fraudCheck(order: Order): Operation<boolean> { ... },
});
```

### 15.2 Dual Nature

**Host:** `FraudDetector().fraudCheck(order)` produces an IR Eval
node wrapped in a Workflow generator via `durableCall`.

**Agent:** Runtime looks up `operations["fraudCheck"]`, runs the
generator, returns the result.

### 15.3 Method Identity

Methods are identified by `(agentId, methodName)`. In the IR:
`Eval.id = agentId + "." + methodName`. On the wire: agent
identity from Initialize, method name in Execute's `operation`.

Agent IDs: `[a-z][a-z0-9-]*`. Method names: `[a-zA-Z][a-zA-Z0-9]*`.
Neither may contain dots.

### 15.4 Method Resolution

**On the host:** Parse `Eval.id` → agentId + methodName. Look up
agent connection. Verify method in declared capabilities. Send
Execute.

**On the agent:** Look up `operation` in registry. Run generator.
Return result.

### 15.5 Invariants

1. Arguments: JSON-serializable.
2. Return values: JSON-serializable.
3. One Yield per method call (durability boundary).
4. Agent crash → full re-dispatch (retry boundary).
5. One definition, two roles.

---

## 16. Compiler Guarantees

### 16.1 Three Levels

**Level 1 — Structural validity.** Output conforms to the grammar
and passes all validation rules. Always guaranteed.

**Level 2 — Scope consistency.** Every Ref is bound by an
enclosing Let or Fn. Always guaranteed.

**Level 3 — Journal equivalence.** For all result sequences R:

```
journal(interpret(compile(G), R)) = journal(run(G, R))
```

Guaranteed for source within the authoring subset.

### 16.2 Journal Equality

Two journals are equal iff they have the same events in the same
order, where event equality compares: `type`, `coroutineId`,
`description.type`, `description.name`, `result.status`,
`result.value` (deep), `result.error.message`.

### 16.3 Allowed vs Disallowed Differences

**Allowed:** Variable names, control flow restructuring, expression
decomposition.

**Disallowed:** Effect ordering, effect descriptions, branching
behavior, task structure, final result.

### 16.4 Compilation Determinism

Same source → byte-identical output. No random IDs, no timestamps.

### 16.5 Free Variable Constraint

For every Fn produced, either the body has no free variables
(via substitution) or all free variables are guaranteed in scope
at every call site. The compiler MUST emit a diagnostic otherwise.

---

## 17. Observability

### 17.1 Two Surfaces

**Durable:** The journal. Every Yield and Close event. Read via
catch-up-then-tail.

**Ephemeral:** Progress notifications. Forwarded from agents.
Not journaled. May be lost.

### 17.2 What Observers See

| Event            | When             | Contains              |
| ---------------- | ---------------- | --------------------- |
| Yield            | Effect completed | Agent, method, result |
| Close(ok)        | Task completed   | Final value           |
| Close(err)       | Task failed      | Error                 |
| Close(cancelled) | Task cancelled   | —                     |
| Progress         | During effect    | Agent-defined payload |

Observers do NOT see structural operations, environment bindings,
internal control flow, or replay/live distinction.

---

## 18. Protocol Versioning

Three independent version axes:

| Thing                 | What changes    | Versioned by        |
| --------------------- | --------------- | ------------------- |
| IR grammar            | New node types  | IR version          |
| Structural operations | New ids in set  | Interpreter version |
| Wire protocol         | Message changes | Protocol version    |

Classification changes are breaking. In-flight executions must
complete on the old interpreter version before upgrading.

---

## Appendix A: Authoring Layer Types

```typescript
type Expr<T> = T | Eval<T> | Quote<T> | Ref<T> | TisynFn<T>;

interface Eval<T, TInput = unknown> {
  tisyn: "eval";
  id: string;
  data: TInput;
  T?: T;
}
interface Quote<T> {
  tisyn: "quote";
  expr: Expr<T>;
}
interface Ref<T> {
  tisyn: "ref";
  name: string;
  T?: T;
}
interface TisynFn<T> {
  tisyn: "fn";
  params: string[];
  body: Expr<T>;
}

type AgentOperations = Record<string, (...args: any[]) => Operation<any>>;
interface AgentDefinition<T extends AgentOperations> {
  id: string;
  operations: T;
  create(): AgentClient<T>;
}
type AgentClient<T extends AgentOperations> = {
  [K in keyof T]: T[K] extends (...a: infer A) => Operation<infer R>
    ? (...a: A) => Workflow<R>
    : never;
};
```

Phantom fields (`T?`) are stripped by `JSON.stringify`.

---

## Appendix B: Wire Protocol Types

```typescript
interface ExecuteRequest {
  jsonrpc: "2.0";
  id: string;
  method: "execute";
  params: {
    executionId: string;
    taskId: string;
    operation: string;
    args: Json[];
    progressToken?: string;
    deadline?: string;
  };
}

interface ExecuteResponse {
  jsonrpc: "2.0";
  id: string;
  result: { ok: boolean; value?: Json; error?: { message: string; name?: string } };
}

interface CancelNotification {
  jsonrpc: "2.0";
  method: "cancel";
  params: { id: string; reason?: string };
}

interface ProgressNotification {
  jsonrpc: "2.0";
  method: "progress";
  params: { token: string; value: Json };
}
```

---

## Appendix C: Journal Event Types

```typescript
type DurableEvent = YieldEvent | CloseEvent;

interface YieldEvent {
  type: "yield";
  coroutineId: string;
  description: { type: string; name: string };
  result: EventResult;
}

interface CloseEvent {
  type: "close";
  coroutineId: string;
  result: EventResult;
}

type EventResult =
  | { status: "ok"; value?: Json }
  | { status: "err"; error: { message: string; name?: string } }
  | { status: "cancelled" };
```

---

## Appendix D: End-to-End Example

### D.1 Workflow

```typescript
function* orderWorkflow(orderId: string): Workflow<Receipt> {
  const order = yield* OrderService().fetchOrder(orderId);
  if (order.total > 100) {
    const passed = yield* FraudDetector().fraudCheck(order);
    if (!passed) throw new Error("Fraud detected");
  }
  return yield* PaymentService().chargeCard(order.payment);
}
```

### D.2 Execution Trace

```
Step  Action                              State    Journal
────  ──────                              ─────    ───────
 1    eval Let(order, fetchOrder(...))     RUNNING
 2    resolve args: [Ref(orderId)] → ["order-123"]
 3    yield fetchOrder descriptor          SUSPENDED
 4    Agent A returns {id,total:150,payment}         Execute→A
 5    Yield written                                  [0] yield fetchOrder ok
 6    generator.next(order)                RUNNING
 7    eval Gt(Get(order,"total"), 100) → true
 8    eval Let(passed, fraudCheck(...))
 9    resolve args: [Ref(order)] → [{id,total,payment}]
10    yield fraudCheck descriptor           SUSPENDED
11    Agent B returns true                            Execute→B
12    Yield written                                  [1] yield fraudCheck ok
13    generator.next(true)                 RUNNING
14    eval Not(true) → false → skip throw
15    resolve args: [Get(order,"payment")] → [{card:"visa"}]
16    yield chargeCard descriptor           SUSPENDED

     ████ HOST CRASHES ████

17    New host reads journal ([0],[1])
18    Build ReplayIndex: root cursor=0
19    Fresh generator, eval tree
20    reach fetchOrder → index[0] MATCH → feed stored result   REPLAY
21    reach fraudCheck → index[1] MATCH → feed stored result   REPLAY
22    reach chargeCard → no entry → LIVE
23    yield chargeCard descriptor           SUSPENDED  Execute→C
24    Agent C returns {receiptId:"r-789"}
25    Yield written                                  [2] yield chargeCard ok
26    generator.next({receiptId})           RUNNING
27    workflow returns                      COMPLETED [3] close root ok
```

### D.3 Final Journal

```
[0] yield root order-service.fetchOrder  ok {id:"123",total:150,payment:{card:"visa"}}
[1] yield root fraud-detector.fraudCheck ok true
[2] yield root payment-service.chargeCard ok {receiptId:"r-789"}
[3] close root ok {receiptId:"r-789"}
```

### D.4 Interoperability Test

Two implementations are compatible if, given the same IR tree,
the same agent results, and the same classification, they produce
the same journal (byte-equal after canonical encoding) and the
same final result.
