# Tisyn Converge Compiler and Authoring Amendment

**Version:** 0.1.0
**Amends:** Tisyn Compiler Specification 1.2.0, Tisyn
Authoring Layer Specification, Tisyn Constructor DSL
Specification
**Depends on:** Tisyn Timebox Specification 0.1.0
**Status:** Draft

---

## 1. Overview

This document specifies `converge`, an authored workflow
form and constructor DSL macro that implements polling
convergence — repeatedly probing an external system until a
condition is met or a timeout fires.

`converge` is NOT a new IR node. It is NOT a kernel
primitive. It is NOT a runtime operation. The compiler
recognizes `converge` in authored code and lowers it to a
`timebox` node whose body is a recursive Fn + Call polling
loop using existing IR nodes. The constructor DSL provides a
`Converge` macro that performs the same expansion.

### 1.1 Normative Language

The key words MUST, MUST NOT, SHALL, SHALL NOT, SHOULD,
SHOULD NOT, and MAY are used as defined in RFC 2119.

---

## 2. Normative Scope

This specification defines:

- The authored syntax for `converge`
- Authoring constraints on `probe`, `until`, `interval`,
  and `timeout`
- The lowering strategy from authored form to IR
- The relationship between `converge` timeout behavior and
  `timebox`
- Result semantics
- Replay and journaling consequences
- Compiler validation and rejection rules
- The constructor DSL macro `Converge`

This specification does NOT define:

- Any new IR node type
- Any new kernel evaluation rule
- Any new runtime orchestration behavior
- Journal compression or compound-level journaling

---

## 3. Relationship to `timebox`

`converge` is defined in terms of `timebox`:

- The timeout behavior of `converge` IS `timebox` timeout
  behavior (Timebox Spec §9.2).
- The result type of `converge` IS `TimeboxResult<T>`
  (Timebox Spec §5.3).
- The cancellation behavior of `converge` IS `timebox`
  cancellation behavior (Timebox Spec §9.4).
- The journaling of `converge` IS the journaling of the
  `timebox` body's effects — probe effects and interval
  sleeps (Timebox Spec §11).
- The replay of `converge` IS the replay of the enclosing
  `timebox` (Timebox Spec §10).

`converge` adds one concept on top of `timebox`: a polling
loop with a `probe`/`until` split inside the body.

---

## 4. Authored Syntax

### 4.1 Form

```typescript
const result = yield* converge({
  probe: function* () {
    return yield* Deployment().status(deployId);
  },
  until: (status) => status.state === "ready",
  interval: 500,
  timeout: 10_000,
});
```

### 4.2 Config Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `probe` | Generator function | MUST | Effectful observation step. Called once per polling iteration. May contain one or more `yield*` effect calls. |
| `until` | Arrow function | MUST | Pure predicate. Receives the evaluated probe result. Returns truthy if convergence is achieved. |
| `interval` | Numeric expression | MUST | Milliseconds between polling iterations. MUST NOT contain `yield*`. |
| `timeout` | Numeric expression | MUST | Total milliseconds allowed. Passed as `timebox` duration. MUST NOT contain `yield*`. |

### 4.3 Dynamic `interval` and `timeout`

If `interval` or `timeout` must be produced by an effect,
the author MUST bind them in prior statement-position
`yield*` calls and pass the bound variables:

```typescript
const pollInterval = yield* Config().pollInterval();
const deadline = yield* Config().timeout();
const result = yield* converge({
  probe: function* () {
    return yield* Deployment().status(deployId);
  },
  until: (status) => status.state === "ready",
  interval: pollInterval,
  timeout: deadline,
});
```

The following is NOT valid authored syntax because `yield*`
appears inside the config object:

```typescript
// INVALID — yield* is not allowed in expression position
const result = yield* converge({
  probe: function* () { ... },
  until: (status) => status.state === "ready",
  interval: yield* Config().pollInterval(),   // REJECTED
  timeout: yield* Config().timeout(),         // REJECTED
});
```

### 4.4 Result Type

`converge` returns `TimeboxResult<T>` — the same type
defined by the Timebox Specification:

```typescript
type TimeboxResult<T> =
  | { status: "completed"; value: T }
  | { status: "timeout" };
```

When convergence succeeds, `status` is `"completed"` and
`value` is the evaluated probe result that satisfied `until`.

---

## 5. Authoring Constraints

### AC1. `probe` Must Be a Generator Function

The `probe` field MUST be a generator function expression
(`function* () { ... }`).

A `probe` that contains no `yield*` effect calls is
syntactically valid but semantically suspect. `converge` is
intended for effectful observation across explicit effect
boundaries — each probe iteration is expected to cross the
effect boundary to observe external state. A pure `probe`
that reads no external state will return the same value on
every iteration, making convergence either immediate or
impossible. The compiler SHOULD emit warning W-CONV-01 for
an effectless probe but MUST NOT reject it.

Arrow functions, non-generator functions, and variable
references MUST be rejected.

### AC2. Probe May Contain Multiple Effects

A probe body MAY contain multiple `yield*` effect calls,
control flow, and Let bindings. Each effect in the probe
body is an independent external effect that crosses the
effect boundary and is individually journaled. There is no
restriction to a single effect per probe iteration.

```typescript
// VALID — multi-step probe
probe: function* () {
  const build = yield* CI().getBuild(buildId);
  const tests = yield* CI().getTestResults(build.testRunId);
  return { build, tests };
}
```

### AC3. `until` Must Be an Arrow Function

The `until` field MUST be an arrow function with a single
expression body:

```typescript
// VALID
until: (status) => status.state === "ready"
until: (v) => v > 0
until: (result) => result.done === true

// INVALID — block body
until: (status) => { return status.state === "ready"; }

// INVALID — multiple statements
until: (status) => { const s = status.state; return s === "ready"; }

// INVALID — contains yield*
until: function* (status) { return yield* check(status); }
```

The arrow body MUST NOT contain `yield*` or `await`. It MUST
be a single expression with no block, no statements, and no
variable declarations. This ensures the compiler can lower
`until` to a Fn node with a pure structural body.

### AC4. `until` Parameter

`until` MUST accept exactly one parameter. It receives the
evaluated probe result — the Val produced by evaluating the
probe body to completion. It MUST return a value
interpretable as boolean by the kernel's `truthy()` function
(System Spec §5.4).

### AC5. `interval` and `timeout` Must Be Numeric Value Expressions

Both MUST be numeric expressions. Both are required — there
are no defaults in v1. Neither field MUST contain `yield*`.
The existing compiler restriction that `yield*` is only
valid in statement position applies to all fields of the
config object. If the author needs effect-produced values
for `interval` or `timeout`, they MUST bind them in prior
statements (§4.3).

### AC6. Config Must Be a Literal Object

The config object MUST be an object literal at the call
site. It MUST NOT be a variable reference. The compiler
needs static access to each field for recognition and
lowering.

```typescript
// VALID
yield* converge({ probe: ..., until: ..., interval: 500, timeout: 10000 });

// INVALID — variable reference
const cfg = { probe: ..., until: ..., interval: 500, timeout: 10000 };
yield* converge(cfg);
```

This follows the same pattern as `Effects.around({...})`
recognition (Scope Spec §3.5).

### AC7. Free Variable Capture

Free variables in the `probe` body and the `until` arrow
resolve via standard Tisyn call-site resolution (System Spec
§5.5). The compiler-generated recursive Fn captures no
environment; free Refs in its body resolve in the caller's
environment at each Call site.

Any binding in scope at the `converge` call site in the
authored workflow is available to both `probe` and `until`:
workflow parameters, prior `const` declarations, enclosing
scope bindings. The compiler MUST verify (per Compiler Spec
§8.3) that all free Refs in the expanded Fn bodies are
resolvable at their call sites.

No restrictions beyond the standard call-site resolution
model apply.

---

## 6. Lowering Strategy

### 6.1 Conceptual Model

> **Non-normative.** The following pseudocode shows the
> logical structure of the lowered form. The actual IR uses
> the Fn + Call recursive pattern, not generator syntax.

```
timebox(timeout, function* () {
  function* __poll() {
    const probeResult = yield* probe();
    if (until(probeResult)) {
      return probeResult;
    }
    yield* sleep(interval);
    return yield* __poll();
  }
  return yield* __poll();
})
```

### 6.2 Lowered IR — Constructor Function Notation

The authored form:

```typescript
yield* converge({
  probe: function* () {
    return yield* Deployment().status(deployId);
  },
  until: (status) => status.state === "ready",
  interval: 500,
  timeout: 10_000,
});
```

Lowers to the following IR tree, shown in `@tisyn/ir`
constructor function notation (not DSL parser input text):

```
Timebox(10000,
  Let("__until_0",
    Fn(["v"], Eq(Get(Ref("v"), "state"), "ready")),
  Let("__poll_0",
    Fn([],
      Let("__probe_0",
        Eval("deployment.status", [Ref("deployId")]),
      If(
        Call(Ref("__until_0"), Ref("__probe_0")),
        Ref("__probe_0"),
        Let("__discard_0",
          Eval("sleep", [500]),
          Call(Ref("__poll_0")))))),
  Call(Ref("__poll_0")))))
```

> **Notation.** Named calls — `Timebox`, `Let`, `Fn`, `Eval`,
> `If`, `Call`, `Ref`, `Eq`, `Get` — are `@tisyn/ir`
> constructor functions. `Timebox` is introduced by the
> Timebox Specification (§14); the rest are existing
> constructors. `Call` is variadic: `Call(fn, arg₁, ...,
> argₙ)`. Bracketed values `[Ref("deployId")]` and `[500]`
> are raw JSON array literals — plain Tisyn Literal
> expressions (System Spec §3.5), NOT `Arr(...)` constructor
> calls. `Arr(...)` produces an `Eval("array", ...)` IR
> node, which is structurally different from a raw array.
> Effect data for external Eval nodes MUST be a raw array.

**Reading the `__probe_0` Let.** The Let's value position
holds the compiled probe expression — in this example,
`Eval("deployment.status", [Ref("deployId")])`. When the
kernel evaluates this Let, it evaluates the probe expression
(dispatching the external effect, receiving the journaled
result), and binds the resulting Val to the name
`__probe_0`. All subsequent references to
`Ref("__probe_0")` in the Let body refer to this evaluated
result, not to the expression tree.

### 6.3 Lowered IR — Full JSON

The same tree in actual Tisyn JSON IR:

```json
{
  "tisyn": "eval",
  "id": "timebox",
  "data": { "tisyn": "quote", "expr": {
    "duration": 10000,
    "body": { "tisyn": "eval", "id": "let", "data": {
      "tisyn": "quote", "expr": {
        "name": "__until_0",
        "value": { "tisyn": "fn", "params": ["v"],
          "body": { "tisyn": "eval", "id": "eq", "data": {
            "tisyn": "quote", "expr": {
              "a": { "tisyn": "eval", "id": "get", "data": {
                "tisyn": "quote", "expr": {
                  "obj": { "tisyn": "ref", "name": "v" },
                  "key": "state" }}},
              "b": "ready" }}}},
        "body": { "tisyn": "eval", "id": "let", "data": {
          "tisyn": "quote", "expr": {
            "name": "__poll_0",
            "value": { "tisyn": "fn", "params": [],
              "body": { "tisyn": "eval", "id": "let", "data": {
                "tisyn": "quote", "expr": {
                  "name": "__probe_0",
                  "value": { "tisyn": "eval",
                    "id": "deployment.status",
                    "data": [{ "tisyn": "ref",
                      "name": "deployId" }] },
                  "body": { "tisyn": "eval", "id": "if",
                    "data": { "tisyn": "quote", "expr": {
                      "condition": { "tisyn": "eval",
                        "id": "call",
                        "data": { "tisyn": "quote", "expr": {
                          "fn": { "tisyn": "ref",
                            "name": "__until_0" },
                          "args": [{ "tisyn": "ref",
                            "name": "__probe_0" }] }}},
                      "then": { "tisyn": "ref",
                        "name": "__probe_0" },
                      "else": { "tisyn": "eval", "id": "let",
                        "data": { "tisyn": "quote", "expr": {
                          "name": "__discard_0",
                          "value": { "tisyn": "eval",
                            "id": "sleep",
                            "data": [500] },
                          "body": { "tisyn": "eval",
                            "id": "call",
                            "data": { "tisyn": "quote",
                              "expr": {
                                "fn": { "tisyn": "ref",
                                  "name": "__poll_0" },
                                "args": [] }}}
                          }}}
                      }}}
                  }}}
              }},
            "body": { "tisyn": "eval", "id": "call",
              "data": { "tisyn": "quote", "expr": {
                "fn": { "tisyn": "ref", "name": "__poll_0" },
                "args": [] }}}
          }}}
      }}}
  }}
}
```

### 6.4 Multi-Step Probe Lowering

When the probe body contains multiple effects, the compiler
compiles the entire probe generator body as a single Expr
tree and places it in the `__probe_0` Let's value position.
For example:

```typescript
probe: function* () {
  const build = yield* CI().getBuild(buildId);
  const tests = yield* CI().getTestResults(build.testRunId);
  return { build, tests };
}
```

The probe body compiles to a nested Let chain (the same
lowering the compiler applies to any multi-statement
generator body), shown in constructor function notation
(see §6.2 notation note):

```
Let("build",
  Eval("ci.getBuild", [Ref("buildId")]),
Let("tests",
  Eval("ci.getTestResults", [Get(Ref("build"), "testRunId")]),
  Construct({
    "build": Ref("build"),
    "tests": Ref("tests") })))
```

> `[Ref("buildId")]` is a raw JSON array (effect data),
> not an `Arr(...)` call. `Construct({...})` is a base
> constructor (Constructor DSL Spec §4.3) that produces an
> `Eval("construct", ...)` IR node — this is correct here
> because the probe body constructs a runtime object.

This entire expression tree occupies the `__probe_0` Let's
value position. When the kernel evaluates this Let, it
evaluates the nested expression — dispatching each external
effect in sequence, receiving each journaled result — and
binds the final evaluated Val (the constructed
`{ build, tests }` object) to the name `__probe_0`. The
`until` Fn then receives this evaluated Val, not the
expression tree.

### 6.5 How the Lowering Works

**`__until_0`.** Bound to a Fn compiled from the `until`
arrow function. The Fn body is pure structural IR (`Eq`,
`Get`). It is called via the `call` structural operation,
which passes the evaluated probe result as the argument. No
journal entry is produced.

**`__poll_0`.** Bound to a recursive Fn with no parameters.
This is the Case B pattern (Compiler Spec §6.2). The Fn
body contains external effects (the probe expression and the
`"sleep"` effect), which cross the execution boundary
normally when the kernel evaluates the Fn body via
`eval_call` (Architecture §5.4).

**`Call(Ref("__poll_0"))` (outer).** Starts the first
iteration. `Ref("__poll_0")` resolves via call-site
resolution — the caller's environment contains the
`Let("__poll_0", Fn(...))` binding.

**Each iteration:**

1. **Evaluate probe expression.** The kernel evaluates the
   `__probe_0` Let's value expression. Each external Eval
   within the probe expression causes the kernel to suspend,
   yield a descriptor, receive a journaled result, and
   resume. A single-effect probe produces one YieldEvent. A
   multi-step probe produces one YieldEvent per external
   effect. The final evaluated Val is bound to the name
   `__probe_0`.

2. **Call until.** `Call(Ref("__until_0"), Ref("__probe_0"))`
   is structural. The kernel looks up `__probe_0` in the
   environment (obtaining the evaluated probe result Val),
   passes it as the argument to the `__until_0` Fn, and
   evaluates the Fn body synchronously. Returns a
   boolean-interpretable value. No journal entry.

3. **Branch on the `if` condition.**
   - Truthy → the `then` branch is `Ref("__probe_0")`,
     which resolves to the evaluated probe result Val. This
     value propagates out through the Call chain as the Fn's
     return value, becoming the timebox body's result.
   - Falsy → the `else` branch evaluates
     `Eval("sleep", [500])` (the built-in `"sleep"`
     external effect, journaled as a YieldEvent), then
     `Call(Ref("__poll_0"))` recurses.

**Termination:**

- `until` returns truthy → `__poll_0` Fn returns the
  evaluated probe result → timebox body completes →
  `{ status: "completed", value: <evaluated probe result> }`.
- Timebox deadline fires → body task cancelled → recursive
  call chain halted → `{ status: "timeout" }`.
- Probe expression throws → error propagates through Call
  chain → timebox body throws → error propagates through
  timebox.

### 6.6 Why Fn + Call Is Valid

The compiler-generated `__poll_0` Fn contains effects. The
Compiler Spec §8.5 restricts user-authored arrow function Fn
bodies from containing effects, but compiler-generated Fn
nodes for Case B lowering are established precedent — the
same mechanism is used for `while`-with-`return` (Compiler
Spec §6.2) and stream iteration. The kernel's `eval_call`
handles effects in Fn bodies by suspending at external Eval
nodes regardless of nesting depth.

### 6.7 No New IR Nodes

This lowering uses only existing IR nodes: `Eval`, `Let`,
`Fn`, `Call`, `If`, `Ref`, `Eq`, `Get`, `Quote`, and
`timebox` (specified in the Timebox Specification). No
`continue`, `break`, `converge`, or other new node types are
introduced.

---

## 7. Result Semantics

### 7.1 Convergence Success

When the evaluated probe result satisfies `until`,
`converge` returns:

```json
{ "status": "completed", "value": "<evaluated probe result>" }
```

This is a `timebox` `completed` result. The `value` field
contains the Val that the probe expression evaluated to on
the satisfying iteration — not the probe expression tree.

### 7.2 Timeout

When no probe result satisfies `until` within the deadline:

```json
{ "status": "timeout" }
```

This is a `timebox` `timeout` result. Same semantics as
Timebox Spec §9.2.

### 7.3 Probe Error

If any external effect within the probe expression throws,
the error propagates through the Fn call chain, out of the
timebox body, through `timebox` to the parent as a thrown
error. Same semantics as Timebox Spec §9.3.

Probe errors are NOT retried in v1. A future amendment MAY
add an `onError` handler field.

---

## 8. Replay and Journaling

### 8.1 Per-Attempt Journaling

Because `converge` lowers to a `timebox` body containing
standard external effects, each external effect in the probe
expression and each interval `"sleep"` effect is
individually journaled. This is not a design choice — it is
a necessary consequence of crossing the effect boundary.

Each external effect in the probe is a standard effect. The
kernel yields a descriptor for it. The persist-before-resume
invariant (G3) requires the result to be journaled before
the kernel resumes. There is no mechanism to suppress this.

### 8.2 Journal Entries Per Iteration

A single polling iteration produces:

- One YieldEvent per external effect in the probe expression
  (one for a single-effect probe, multiple for a multi-step
  probe)
- One YieldEvent for the interval `"sleep"` effect (if the
  iteration does not converge)

The `until` evaluation is structural and produces no journal
entry.

The total number of YieldEvents for a converge depends on
the number of iterations performed and the number of
external effects in the probe expression. It is NOT a fixed
formula — it varies with the authored probe.

### 8.3 Journal Trace — Single-Effect Probe, Convergence on 3rd Attempt

> **Non-normative.** This trace illustrates a converge with
> a single-effect probe that converges on its third attempt.

```
body-child:    Yield("deployment.status", yi=0)   probe 1
body-child:    Yield("sleep",             yi=1)   interval
body-child:    Yield("deployment.status", yi=2)   probe 2
body-child:    Yield("sleep",             yi=3)   interval
body-child:    Yield("deployment.status", yi=4)   probe 3
  → until satisfied, __poll_0 returns evaluated result
body-child:    Close(ok, value=<status>)
timeout-child: Close(cancelled)
```

### 8.4 Journal Trace — Multi-Step Probe (2 Effects), Convergence on 2nd Attempt

> **Non-normative.**

```
body-child:    Yield("ci.getBuild",       yi=0)   probe 1, effect 1
body-child:    Yield("ci.getTestResults", yi=1)   probe 1, effect 2
body-child:    Yield("sleep",             yi=2)   interval
body-child:    Yield("ci.getBuild",       yi=3)   probe 2, effect 1
body-child:    Yield("ci.getTestResults", yi=4)   probe 2, effect 2
  → until satisfied, __poll_0 returns evaluated result
body-child:    Close(ok, value=<r>)
timeout-child: Close(cancelled)
```

### 8.5 Journal Trace — Timeout

> **Non-normative.**

```
body-child:    Yield("deployment.status", yi=0)   probe 1
body-child:    Yield("sleep",             yi=1)   interval
body-child:    Yield("deployment.status", yi=2)   probe 2
body-child:    Yield("sleep",             yi=3)   interval
  → timeout fires before next probe
timeout-child: Yield("sleep",             yi=0)
timeout-child: Close(ok)
body-child:    Close(cancelled)
```

### 8.6 `until` Is Not Journaled

The `until` predicate is evaluated via the `call` structural
operation. Structural operations produce no journal entries.
On replay, the same probe results are replayed, the same
`until` evaluations occur, and the same boolean results are
produced.

### 8.7 Replay Fidelity

On replay, the timebox body child replays from its journal
entries. Each probe effect's stored result is fed to the
kernel. The kernel evaluates the probe expression, receiving
stored results from the journal for each external effect.
The probe expression evaluates to the same Val on each
iteration. The kernel evaluates `until` against each
evaluated probe result. The same probe result satisfies
`until` on the same iteration. The same number of `"sleep"`
effects occur. The timebox resolves identically.

### 8.8 Crash Recovery

If the host crashes mid-polling:

- All completed probe effects and interval sleeps are in the
  journal (persist-before-resume).
- On restart, the runtime replays the timebox body child,
  fast-forwarding through stored effects.
- Live execution resumes at the first un-journaled effect
  (the next probe effect or `"sleep"`).
- No completed work is lost.

If the probe is multi-step and the crash occurs between
external effects within a single iteration (e.g., after
`"ci.getBuild"` but before `"ci.getTestResults"`), the first
probe effect replays from journal and the second executes
live. This is the standard partial-replay behavior.

---

## 9. Compiler Validation and Rejection

### 9.1 Recognition

The compiler recognizes `yield* converge({...})` as a
special form when:

- The callee is `converge`.
- The argument is a single object literal.
- The object literal contains `probe`, `until`, `interval`,
  and `timeout` fields.

### 9.2 Rejection Cases

| Condition | Code | Severity | Description |
|---|---|---|---|
| `probe` is not a generator function | E-CONV-01 | Error | `probe` must be a generator function expression |
| `until` is not an arrow function | E-CONV-02 | Error | `until` must be an arrow function |
| `until` has a block body | E-CONV-03 | Error | `until` must be a single expression |
| `until` contains `yield*` | E-CONV-04 | Error | `until` must not contain effects |
| `interval` is missing | E-CONV-05 | Error | `interval` is required |
| `timeout` is missing | E-CONV-06 | Error | `timeout` is required |
| Config is a variable reference | E-CONV-07 | Error | Config must be an object literal |
| `interval` contains `yield*` | E-CONV-08 | Error | `yield*` is not allowed in expression position |
| `timeout` contains `yield*` | E-CONV-09 | Error | `yield*` is not allowed in expression position |
| `probe` contains no `yield*` | W-CONV-01 | Warning | Probe body contains no effects; convergence is intended for effectful observation |

### 9.3 Free Variable Validation

The compiler MUST verify that all free Refs in the generated
`__poll_0` and `__until_0` Fn bodies are resolvable at their
call sites, per existing Fn free-variable rules (Compiler
Spec §8.3).

---

## 10. Constructor DSL Amendment

### 10.1 Macro Vocabulary Amendment

The current constructor DSL specification defines only the
closed base constructor table (Constructor DSL Spec §4.3).
It does not define a normative macro registry. Macro
constructors are described as a planned future extension
(Constructor DSL Spec §12), with design constraints C1–C6
specified (Constructor DSL Spec §12.2), but no macros are
registered and the macro vocabulary does not yet exist as a
normative artifact.

This specification creates the macro vocabulary registry as
a normative extension to the constructor DSL specification
and registers `Converge` as its first entry.

The macro vocabulary registry is a new normative section of
the constructor DSL specification, separate from the base
constructor table (§4.3). It is closed and statically
defined. Entries are added only by formal specification
amendment. Macro names MUST NOT collide with base
constructor names (constraint C5). Macros expand at
construction time into trees of base constructor calls and
MUST NOT introduce new IR node types (constraint C2). The
expanded output MUST be indistinguishable from a tree
produced by base constructors alone (constraint C3).

**Amendment.** Create the macro vocabulary registry in the
constructor DSL specification. Register the following as its
first entry:

| Name | `Converge` |
|---|---|
| Category | Macro |
| Arity | 4 (all required) |
| Parameter: `probe` | Expr — compiled probe expression tree (the authored `probe` generator body, compiled by the standard compiler rules into an Expr that may contain external Eval nodes) |
| Parameter: `until` | Fn — compiled predicate (the authored `until` arrow, compiled to a Fn with a pure structural body; MUST NOT contain external Eval nodes) |
| Parameter: `interval` | Expr — numeric synchronous expression for the polling interval in milliseconds; subject to the same constraints as authored `interval` (AC5): MUST NOT contain `yield*`, MUST NOT contain external Eval nodes; becomes raw `"sleep"` effect data in the expansion |
| Parameter: `timeout` | Expr — numeric synchronous expression for the total deadline in milliseconds; subject to the same constraints as authored `timeout` (AC5): MUST NOT contain `yield*`, MUST NOT contain external Eval nodes; becomes the `Timebox` duration in the expansion |
| Expands to | `Timebox` node containing recursive Fn + Call polling loop (§10.2) |
| IR id introduced | None — no `"converge"` id exists in the IR |
| Constraint compliance | C1–C6 (Constructor DSL Spec §12.2) |

**Parser integration.** The parser MUST recognize
`Converge(...)` as a macro call and dispatch to the
expansion function defined in §10.2. The parser MUST
validate arity (4 parameters required). The expansion
function receives four parsed Expr values and returns a
single Expr — the expanded IR tree.

**Adoption.** Implementations MUST NOT expose `Converge` in
the constructor DSL until this amendment is adopted.

### 10.2 Macro Expansion

Given parameters `P` (probe), `U` (until), `I` (interval),
`T` (timeout), `Converge` expands to the following IR tree
(constructor function notation; see §6.2 notation note):

```
Timebox(T,
  Let("__until_0", U,
  Let("__poll_0",
    Fn([],
      Let("__probe_0", P,
      If(
        Call(Ref("__until_0"), Ref("__probe_0")),
        Ref("__probe_0"),
        Let("__discard_0",
          Eval("sleep", [I]),
          Call(Ref("__poll_0")))))),
  Call(Ref("__poll_0")))))
```

`P` is an Expr — the compiled probe expression tree, not an
evaluated result. The macro places it in the `__probe_0`
Let's value position. The kernel evaluates it at runtime
when evaluating the Let.

`U` is a Fn — the compiled predicate. The macro places it in
the `__until_0` Let's value position. The kernel calls it
via the structural `call` operation.

`I` and `T` are Exprs — the interval and timeout duration
expressions. `T` becomes the `Timebox` duration. `[I]`
becomes the `"sleep"` effect's data — a raw JSON array
containing the interval expression (not an `Arr(I)` call).

### 10.3 Equivalence Requirement

The compiler and the constructor DSL macro MUST produce
identical IR for the same `converge` configuration.

### 10.4 Vocabulary Summary

| Entry | Registry | Category | Amends |
|---|---|---|---|
| `Timebox` | Base constructor table (existing) | Base constructor | Timebox Spec §14.1 |
| `Converge` | Macro vocabulary (created by this amendment) | Macro | This section (§10.1) |

---

## 11. Examples

### 11.1 Polling a Deployment

```typescript
const result = yield* converge({
  probe: function* () {
    return yield* Deployment().status(deployId);
  },
  until: (status) => status.state === "ready",
  interval: 500,
  timeout: 30_000,
});

if (result.status === "completed") {
  yield* Notify().alert("Deployment ready");
} else {
  yield* Notify().alert("Deployment timed out");
}
```

### 11.2 Waiting for Approval

```typescript
const result = yield* converge({
  probe: function* () {
    return yield* ApprovalService().check(requestId);
  },
  until: (approval) => approval.decision !== "pending",
  interval: 2000,
  timeout: 60_000,
});
```

### 11.3 Multi-Step Probe

```typescript
const result = yield* converge({
  probe: function* () {
    const build = yield* CI().getBuild(buildId);
    const tests = yield* CI().getTestResults(build.testRunId);
    return { build, tests };
  },
  until: (r) => r.build.status === "complete" && r.tests.passed,
  interval: 5000,
  timeout: 120_000,
});
```

### 11.4 Dynamic Interval and Timeout

```typescript
const pollInterval = yield* Config().pollInterval();
const deadline = yield* Config().timeout();

const result = yield* converge({
  probe: function* () {
    return yield* Deployment().status(deployId);
  },
  until: (status) => status.state === "ready",
  interval: pollInterval,
  timeout: deadline,
});
```

---

## 12. Deferred / Non-Goals

**Error retry.** Probe errors propagate in v1. A future
`onError` handler field may allow retry-on-error without
changes to the IR model.

**Backoff.** Fixed interval only. Exponential backoff can be
added later without IR model changes (the `interval`
expression position already accepts any synchronous
expression).

**Journal compression.** Explicitly rejected.
Per-attempt journaling is a necessary consequence of
crossing the effect boundary. Each probe effect and each
interval sleep is a standard effect with its own YieldEvent.
There is no mechanism to suppress or batch these entries.

**`converge` as a compound external.** Explicitly rejected.
The polling loop is transparent authored/compiler logic, not
runtime-internal orchestration. The runtime sees only the
enclosing `timebox` and its children.

**`always`.** The stability-assertion primitive (from
Effection's test utilities) is excluded from core Tisyn. It
is a test-only concept with no durable-execution analog.

**`when`.** The testing-style "retry until assertion stops
failing" pattern is replaced by `converge` with explicit
`probe`/`until` split. The split makes the observation step
and the success predicate independently visible in the IR
and individually testable.
