# Tisyn Blocking Scope Specification

**Version:** 0.1.0
**Implements:** Tisyn System Specification 1.0.0
**Amends:** Tisyn Kernel Specification 1.0.0, Tisyn Compiler Specification 1.2.0
**Status:** Draft

---

## 1. Overview

This specification defines first-class blocking scope creation
for authored Tisyn workflows. It covers the authored surface,
the IR representation, the kernel evaluation rules, the runtime
lifecycle, and the replay semantics for the `scoped(...)` form.

The target authored surface is:

````typescript
yield* scoped(function* () {
  yield* useTransport(Coder, coderTransport);

  yield* Effects.around({
    *dispatch([effectId, data], next) {
      if (effectId === "tisyn.exec") {
        throw new Error("exec denied");
      }
      return yield* next(effectId, data);
    },
  });

  const coder = yield* useAgent(Coder);
  return yield* coder.implement(spec);
});
````

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are
used as defined in RFC 2119.

### 1.2 Normative Scope

This specification covers:

- authored-language rules for `scoped(...)`, `useTransport(...)`,
  `Effects.around(...)`, and `useAgent(...)`
- the `scope` distinguished IR form
- kernel evaluation rules for `scope`
- runtime scope lifecycle
- teardown and error ordering
- replay and durability semantics

This specification defines only the blocking single-child scope
created by `scoped(...)`. Normative rules for scope composition,
nested scope middleware inheritance, compound concurrency
interaction with scope-local configuration, and non-blocking
scope-creating operations are deferred to future specifications.

### 1.3 Relationship to Other Specifications

This specification amends the kernel specification by adding
`"scope"` to the compound-external ID set. It amends the
compiler specification by adding scope-related authoring
constructs and compilation rules.

It builds on the scoped effects specification (v0.1.0) for
middleware evaluation semantics. In particular, scope-local
middleware handler `Fn` nodes are evaluated via the same
`evaluateMiddlewareFn` mechanism and enforcement wrapper model
defined in the scoped effects specification §7–§8.

---

## 2. Terminology

**Scope.** A lifetime-bearing execution context with an
identity, a parent, inherited configuration, and a body. A
scope's lifetime is bounded by its parent's lifetime.

**Scope-creating operation.** An operation that allocates a
new child scope and begins executing a body within it. This
specification defines `scoped` (blocking, single-child).
`all` and `race` (existing compound externals), `spawn`, and
`resource` are other scope-creating operations; their
specifications are separate documents.

**Setup prefix.** The ordered sequence of scope-configuration
statements at the beginning of a `scoped(...)` body. Setup
statements configure the scope (middleware, transport bindings)
and MUST appear before any body statement.

**Body.** The executable workflow logic following the setup
prefix within a `scoped(...)` body.

**Handler Fn.** An IR `Fn` node that implements middleware
logic for the scope. Evaluated via `evaluateMiddlewareFn`
with scope-local dispatch semantics (scoped effects
specification §8).

**Transport binding.** An association between an agent identity
prefix and a transport value, scoped to the lifetime of the
enclosing scope.

**Handle.** A compile-time binding that associates a local
variable with an agent contract. Erased during compilation;
does not appear in IR.

---

## 3. Authored-Language Rules

### 3.1 Accepted Form

The compiler MUST accept the following authored form:

````typescript
yield* scoped(function* () {
  <setup-prefix>
  <body>
});
````

The argument to `scoped` MUST be a generator function
expression (a `FunctionExpression` with an asterisk token).
Arrow functions, non-generator functions, and identifiers
MUST be rejected.

`yield* scoped(...)` MUST appear in statement position only,
consistent with the existing `yield*` rule (compiler
specification §2.2, error E010).

### 3.2 Setup/Body Partitioning

The statements inside the generator function body are
partitioned into a **setup prefix** and a **body**. This is
a normative authored-language constraint, not a compiler
optimization.

The compiler MUST process statements in source order. Each
statement is classified as either a setup statement or a body
statement. The first statement that is not a setup statement
begins the body. All subsequent statements are body statements
regardless of their form.

**Setup statements** are:

- `yield* useTransport(Contract, expr)`
- `yield* Effects.around({ *dispatch([p1, p2], next) { ... } })`

**Body statements** are all other statements, including:

- `const handle = yield* useAgent(Contract)`
- agent effect calls
- `if`, `while`, `return`, `throw`, `try/catch`, etc.

### 3.3 Setup Restrictions

S1. Setup statements MUST appear before any body statement.

S2. Setup statements MUST NOT be conditional. The compiler
    MUST reject `if (...) { yield* useTransport(...); }`.

S3. Setup statements MUST NOT appear inside blocks, loops,
    or `try/catch/finally` constructs.

S4. Setup statements MAY appear in any order among themselves.

S5. Multiple `useTransport` calls for different contracts are
    permitted. Multiple `useTransport` calls for the same
    contract MUST be rejected.

S6. At most one `Effects.around` call is permitted per scope
    in this specification version. Multiple `Effects.around`
    calls MUST be rejected.

### 3.4 `useTransport` Constraints

````typescript
yield* useTransport(Contract, expr);
````

UT1. The first argument MUST be an identifier referencing an
     ambient contract declaration (`declare function`). The
     compiler MUST resolve this to an agent identity prefix
     via the existing `toAgentId` transform.

UT2. The second argument MUST be any authored expression that
     the compiler already accepts in ordinary expression
     position. Bare identifiers, property access expressions,
     call expressions, and conditional expressions are all
     permitted examples. No transport-specific expression
     subset is defined beyond the existing authored expression
     subset.

UT3. The compiler MUST lower the second argument via the
     existing expression compilation pipeline, producing an
     `Expr` in scope metadata. A bare identifier still lowers
     to `Ref(identifier)`. General expression compilation may
     still produce unresolved `Ref`s; whether the resulting
     binding expression evaluates successfully at runtime is a
     runtime obligation (§6.1 R2), not a compile-time
     guarantee.

### 3.5 `Effects.around` Constraints

````typescript
yield* Effects.around({
  *dispatch([param1, param2], nextParam) {
    // middleware body
  },
});
````

EA1. The argument MUST be an object literal with exactly one
     member: a generator method named `dispatch`.

EA2. The `dispatch` method MUST have exactly two parameters:
     - the first MUST be an array binding pattern with exactly
       two binding elements, each a simple identifier
     - the second MUST be a simple identifier (the continuation
       parameter)

EA3. The middleware body MUST contain only statements and
     expressions drawn from the following closed subset. This
     is the complete accepted set for this specification
     version. The compiler MUST reject any construct that does
     not conform to this subset, including as a subexpression.

     **Statements (top-level in the dispatch method body):**

     - `if (mExpr) { stmts } else { stmts }`
     - `if (mExpr) { stmts }`
     - `return mExpr;`
     - `return yield* nextParam(mExpr, mExpr);`
     - `const name = mExpr;`
     - `const name = yield* nextParam(mExpr, mExpr);`
     - `throw new Error(mExpr);`

     **Middleware expressions (`mExpr`):**

     An `mExpr` is one of:

     - literal value: string, number, boolean, `null`
     - `Ref`: a reference to a name bound by the `Fn`'s own
       parameters or by a `const` declaration within the
       middleware body
     - property access: `mExpr.identifier`
     - object literal: `{ key: mExpr, ... }`
     - array literal: `[mExpr, ...]`
     - string template: `` `text ${mExpr}` ``
     - arithmetic: `mExpr + mExpr`, `mExpr - mExpr`,
       `mExpr * mExpr`, `mExpr / mExpr`, `mExpr % mExpr`,
       unary `-mExpr`
     - comparison: `mExpr === mExpr`, `mExpr !== mExpr`,
       `mExpr > mExpr`, `mExpr >= mExpr`, `mExpr < mExpr`,
       `mExpr <= mExpr`
     - logical: `mExpr && mExpr`, `mExpr || mExpr`, `!mExpr`
     - conditional: `mExpr ? mExpr : mExpr`

     `mExpr` is self-referential: subexpressions of an `mExpr`
     MUST also be `mExpr`. No construct outside this definition
     is permitted at any nesting depth.

     **Explicitly not accepted in this version:**

     - `let` declarations and reassignment
     - `while`, `for`, and other loop forms
     - `try` / `catch` / `finally`
     - `yield*` targeting anything other than `nextParam(...)`
     - `yield* nextParam(...)` as a subexpression of `mExpr`
       (it is a statement-level form only, per EA6)
     - function expressions or arrow functions
     - `new` expressions (except `new Error(...)` in `throw`)
     - references to names not bound within the `Fn` body

EA4. Within the middleware body, `yield* nextParam(mExpr, mExpr)`
     MUST be lowered to `Eval("dispatch", Arr(mExpr1, mExpr2))`.
     The `yield*` is consumed by the compiler — it does not
     produce a durability boundary.

EA5. The method body AST MUST contain at most one
     `yield* nextParam(...)` node. This is a total count across
     the entire method body, not a per-branch or per-control-
     flow-path count. A method body containing two or more
     `yield* nextParam(...)` nodes — even in mutually exclusive
     branches — MUST be rejected.

EA6. `yield* nextParam(...)` MUST appear only in one of these
     two statement forms:

     - as the expression of a `return` statement:
       `return yield* nextParam(a, b);`
     - as the initializer of a `const` declaration:
       `const r = yield* nextParam(a, b);`

     In the `const` form, subsequent statements in the method
     body MAY reference the bound name and MUST use only
     constructs from the accepted subset. For example:

     ````
     const r = yield* next(effectId, data);
     return { status: r.status };
     ````

     is accepted. The `return` following the `const` is a
     normal body statement using the accepted subset.

EA7. `yield*` within the middleware body MUST target only
     `nextParam(...)`. Any other `yield*` target MUST be
     rejected.

EA8. The middleware body MUST NOT contain `Ref` nodes whose
     names are not bound by the `Fn`'s own parameters (the
     two names from the array binding pattern) or by `const`
     declarations within the middleware body itself. This
     follows from the existing Fn closure restriction (compiler
     specification §9.4).

EA9. The compiler MUST lower the middleware body to an IR `Fn`
     node (§4.4) and attach it to the scope node metadata.

### 3.6 `useAgent` Constraints

````typescript
const handle = yield* useAgent(Contract);
````

UA1. `useAgent(Contract)` MUST appear in the body, not in the
     setup prefix.

UA2. The argument MUST be an identifier referencing an ambient
     contract declaration.

UA3. The contract referenced MUST have a corresponding
     `useTransport` binding in the same scope's setup prefix.
     The compiler MUST reject `useAgent` for contracts without
     a transport binding.

UA4. `useAgent` MUST be the initializer of a `const`
     declaration. `let` declarations, bare `yield*` statements,
     and other forms MUST be rejected.

UA5. The compiler MUST NOT emit any IR for `useAgent`. It is
     compile-time erased. The compiler records a handle binding
     in its scope context associating the declared variable name
     with the referenced contract.

### 3.7 Handle Usage Restrictions

H1. A handle variable MUST be used only for method calls of the
    form `yield* handle.method(args)`.

H2. A handle variable MUST NOT be reassigned, passed as an
    argument, returned, stored in a data structure, or used in
    any expression other than a method call.

H3. `yield* handle.method(args)` MUST lower to
    `Eval("agentPrefix.method", compiledArgs)`, where
    `agentPrefix` is derived from the contract name using the
    existing `toAgentId` transform, and `compiledArgs` follows
    the existing agent effect compilation rules (compiler
    specification §4.2).

H4. The method MUST exist in the contract declaration. The
    compiler MUST validate method name and arity against the
    contract.

---

## 4. Distinguished IR Form

### 4.1 Semantic Status

`scope` is a distinguished IR form. Although its physical
encoding reuses the existing `Eval` node with `Quote` data,
the kernel and runtime MUST treat it as a semantically distinct
operation with defined evaluation rules, not merely a
conventional use of generic external calls.

This is the same relationship that `all` and `race` have to
the generic `Eval` node: they share the physical encoding but
have distinguished semantics defined in separate specifications.

### 4.2 IR Shape

````
Eval("scope", Quote({
  handler:  Fn | null,
  bindings: { [agentPrefix: string]: Expr },
  body:     Expr
}))
````

The `data` field is a `Quote` node containing a plain object
with three fields.

### 4.3 Binding Entries

Each entry in `bindings` maps an agent identity prefix (string)
to an `Expr` that evaluates to a transport value in the
execution environment.

````json
{
  "bindings": {
    "coder": { "tisyn": "ref", "name": "coderTransport" }
  }
}
````

The key MUST be the agent identity prefix produced by the
compiler's `toAgentId` transform applied to the contract name.
The value MUST be a valid `Expr`. A bare identifier is encoded
as `Ref(name)`, but richer expression trees are permitted.

### 4.4 Handler Fn

The `handler` field is either `null` (no middleware) or an IR
`Fn` node with exactly two parameters representing the effect
ID and effect data.

The `Fn` body MAY contain:

- Structural operations from the accepted middleware subset
  (§3.5 EA3)
- `Eval("dispatch", Arr(effectIdExpr, dataExpr))` representing
  delegation to the inner middleware chain (scope-local dispatch)
- `Throw(msgExpr)` representing effect denial

The `Fn` body MUST NOT contain:

- External `Eval` operations other than `dispatch`
- `Ref` nodes referencing names not bound by the `Fn`'s own
  parameters or by `Let` bindings within the `Fn` body
- `try` nodes (deferred per §10.8)

> **Note:** These constraints match the existing pure middleware
> logic constraints (scoped effects specification §10). The
> handler `Fn` produced by the compiler is subject to the same
> rules as a cross-boundary middleware `Fn` received via
> JSON-RPC.

### 4.5 Body Expression

The `body` field is a valid Tisyn IR expression representing
the executable workflow logic. It is compiled from the body
portion of the authored `scoped(...)` form using the existing
statement compilation pipeline.

The body MAY contain any IR construct permitted by the existing
compiler specification, including external `Eval` nodes (agent
effect calls), compound external nodes (`all`, `race`), and
structural operations.

### 4.6 Validation

The scope node MUST pass standard IR validation. In particular:

V1. The `handler` Fn (if present) MUST be a valid IR `Fn` node.

V2. Binding-expression evaluation is a runtime obligation, not
    an IR validation check. IR validation MUST NOT reject scope
    nodes based on whether binding expressions will resolve
    successfully against the execution environment. Missing
    bindings and other evaluation failures are detected at
    scope entry time (§6.1 R2).

V3. The `body` MUST be a valid IR expression.

V3a. Binding values occupy evaluation positions within the
     scope node. A `Quote` node appearing directly as a binding
     value MUST be rejected by standard IR validation, just as
     a `Quote` in any other evaluation position is rejected.

V4. No `Ref` in the handler `Fn` body may be free (unbound by
    the Fn's parameters or internal Let bindings).

---

## 5. Kernel Evaluation

### 5.1 Classification

`"scope"` MUST be added to the compound-external ID set
alongside `"all"` and `"race"`. The `isCompoundExternal`
function MUST return `true` for `"scope"`.

`classify("scope")` MUST return `EXTERNAL`.

### 5.2 Evaluation Procedure

When the kernel encounters `Eval("scope", D, E)`:

````
eval_scope(D, E):
  inner = unquote(D, E)
  descriptor = {
    id: "scope",
    data: {
      __tisyn_inner: inner,
      __tisyn_env: E
    }
  }
  result = SUSPEND(descriptor)
  return result
````

This follows the compound-external pattern: `unquote` extracts
the scope data (handler, bindings, body) without evaluating
them. The environment is attached so the runtime can create a
child kernel with the correct bindings.

### 5.3 Kernel Non-Responsibility

The kernel MUST NOT:

- Interpret handler logic
- Install middleware
- Resolve transport bindings
- Manage scope lifecycle or teardown
- Allocate child coroutineIds
- Write journal events for scope entry or exit

The kernel's sole responsibility is to extract, yield, and
resume.

---

## 6. Runtime Lifecycle

### 6.1 Scope Entry

When the runtime receives a scope descriptor from the kernel
in the `driveKernel` dispatch loop, it MUST satisfy the
following requirements:

R1. The runtime MUST establish a structured scope boundary
    (Effection `scoped()` or equivalent). All scope-local
    state MUST be bound to this scope's lifetime.

R2. The runtime MUST evaluate all transport binding
    expressions against the execution environment before body
    execution begins. Evaluation MUST use the kernel
    evaluator, not ad hoc host-language expression
    interpretation. If any binding expression fails
    structurally (for example due to an unbound `Ref`), the
    runtime MUST fail with a descriptive error before body
    execution begins. Binding expressions MUST be structural
    only: if evaluation yields an external effect descriptor,
    the runtime MUST fail before body execution begins.
    Successful binding values MUST be registered in the
    scope-local bound-agents registry.

R3. If the scope descriptor's handler is not null, the runtime
    MUST install it as an enforcement wrapper before body
    execution begins. Installation MUST use the enforcement
    wrapper mechanism defined in the scoped effects
    specification §7.5.

R4. The runtime MUST allocate a child coroutineId for the
    scope body using the deterministic child ID scheme
    (`child_id(parent_id, spawn_index)`).

R5. The runtime MUST drive a fresh kernel generator for the
    scope body expression with the inherited execution
    environment and the allocated child coroutineId.

**Ordering constraints.** R2 and R3 MUST complete before R5
begins. R4 MUST complete before R5 begins. R1 MUST establish
the scope boundary before any scope-local state is installed
(R2, R3). The relative ordering of R2, R3, and R4 among
themselves is not constrained, provided all complete before R5.

### 6.2 Scope Exit

On scope exit — whether due to body completion, body error, or
cancellation — the runtime MUST:

R6. **Write body Close event.** The runtime MUST write a
    `CloseEvent` for the body's coroutineId per the existing
    durable stream contract.

R7. **Exit structured scope.** The structured scope boundary
    established in R1 exits, triggering teardown: transport
    connections are shut down, middleware is removed, and any
    other scope-local resources are cleaned up.

R8. **Resume parent kernel.** The runtime resumes the parent
    kernel with the body's result.

### 6.3 Binding Resolution Errors

If a binding expression cannot be evaluated successfully
(because an inner `Ref` is unbound or because evaluation
attempts an external effect), the runtime MUST fail the scope
before body execution begins. The failure MUST be treated as a
scope body error: a `Close(err)` event is written for the body
coroutineId, and the error propagates to the parent kernel.

---

## 7. Teardown and Error Ordering

### 7.1 Success

When the scope body completes normally with value V:

T1. The runtime writes `Close(ok, V)` for the body's
    coroutineId.

T2. The structured scope exits (transport shutdown, middleware
    removal).

T3. The runtime resumes the parent kernel with V.

### 7.2 Failure

When the scope body throws error E:

T4. The runtime writes `Close(err, E)` for the body's
    coroutineId.

T5. The structured scope exits (teardown).

T6. The runtime resumes the parent kernel via `.throw(E)`.

### 7.3 Cancellation

When the parent is cancelled while the scope body is running:

T7. The structured scope is cancelled, which cancels the body.

T8. Body cleanup runs per the structured concurrency substrate.

T9. The runtime writes `Close(cancelled)` for the body's
    coroutineId.

T10. The structured scope exits (teardown).

T11. Parent cancellation continues.

### 7.4 Ordering Invariants

T12. **Teardown before resumption.** Scope teardown (transport
     shutdown, middleware removal) MUST occur after the body
     reaches `closed` state and before the parent kernel is
     resumed.

T13. **Close before resumption.** The body's `Close` event MUST
     appear in the journal before the parent kernel resumes.
     This is the existing P2 invariant (close-after-children)
     applied to the scope body as a single child.

T14. **Scope inside try/catch.** If a scope node appears inside
     a `try` block and the scope body throws, scope teardown
     occurs before the error reaches the parent's `catch`. The
     `catch` handler sees the error AFTER scope cleanup is
     complete.

### 7.5 Concurrency and Nesting

> **Non-normative.** This specification defines only the
> blocking single-child scope created by `scoped(...)`. The
> following describes expected behavior for compound operations
> and nested scopes within a scope body. These expectations
> follow from existing invariants (P2, Effection structured
> concurrency) and existing specifications (compound
> concurrency specification). They are included for clarity but
> do not introduce new normative commitments.
>
> If the scope body contains compound external operations
> (`all`, `race`), their children are expected to inherit the
> scope's middleware and transport bindings via Effection
> context-api inheritance. Compound concurrency invariants
> apply unchanged within the scope body.
>
> Nested scope nodes within a scope body are expected to
> receive their own coroutineIds and to extend (not replace)
> the enclosing scope's middleware via the enforcement wrapper
> model.
>
> Detailed normative rules for scope composition, nested scope
> middleware inheritance, and multi-scope teardown ordering are
> deferred to a future specification that addresses the full
> scope-creating operation family (`scoped`, `spawn`,
> `resource`).

---

## 8. Replay and Durability

### 8.1 No New Event Types

This specification does NOT introduce new durable event types.
The durable stream remains `YieldEvent | CloseEvent` only.

Scope creation, middleware installation, transport binding
resolution, and scope configuration are NOT journaled. They
are reconstructed from the IR on replay.

### 8.2 Body Events

Effects dispatched within the scope body produce `YieldEvent`s
journaled under the body's coroutineId. The body's completion
produces a `CloseEvent` under the body's coroutineId. These
follow the existing journaling rules.

### 8.3 Replay Reconstruction

On replay, the kernel re-evaluates the IR. When it encounters
the scope node, it yields the same descriptor (deterministic
from the immutable IR, property P5). The runtime:

RR1. Reinstalls the handler from the IR (same `Fn`).

RR2. Re-evaluates bindings from the environment (same binding
     `Expr`s against the same execution environment).

RR3. Allocates the same child coroutineId (deterministic
     allocation, invariant I-ID).

RR4. Drives the child kernel, which replays the body's stored
     events from the journal under the body's coroutineId.

### 8.4 Determinism

The following determinism argument applies:

- Same IR (immutable, P5) → same scope structure, same handler
  `Fn`, same binding `Expr`s, same body expression.
- Same execution environment → same binding-expression
  evaluation results.
- Same journal → same effect results replayed.
- Same handler `Fn` + same effect descriptors → same middleware
  decisions (deny, allow, transform).
- Therefore: same execution path, same branching, same final
  value.

Handler denials and middleware transformations produce no
journal events. They are deterministic consequences of the
handler `Fn` (which is in the IR) applied to effect descriptors
(which are deterministic from the IR and environment).

### 8.5 Crash Recovery

A crash can only occur between journal events
(persist-before-resume, property P1).

- If crash before any scope body events: replay re-enters the
  scope from the IR, reinstalls middleware, drives body kernel
  from the start.
- If crash after some body events but before body Close: replay
  re-enters the scope, reinstalls middleware, replays stored
  events, continues from last replayed position.
- If crash after body Close: body result is replayed from the
  journal; scope exit is structural.

No partial scope state can exist because scope entry/exit is
structural, not journaled.

### 8.6 Environment Consistency

The binding expressions are in the IR (immutable). On replay,
they are re-evaluated against the execution environment. If
the host provides a different environment on replay (different
transport values or different intermediate values referenced by
the expression), that is an input mismatch — the same category
as providing different workflow arguments or a different IR.
Input validation, when implemented per scoped effects
specification §9, handles this uniformly.

---

## 9. Compiler Obligations

### 9.1 `scoped(...)` Recognition

The compiler MUST add a new dispatch case in its `yield*`
processing path. When the `yield*` target is a call to
`scoped` with a generator function argument, the compiler MUST:

C1. Enter a scope compilation context.

C2. Process the inner generator's statements via setup/body
    partitioning (§3.2).

C3. Extract setup metadata: binding entries from `useTransport`,
    handler `Fn` from `Effects.around`.

C4. Compile the body via the existing statement compilation
    pipeline.

C5. Emit a scope node: `Eval("scope", Quote({ handler, bindings,
    body }))`.

### 9.2 `useTransport` Compilation

For each `yield* useTransport(Contract, expr)` in the
setup prefix, the compiler MUST:

C6. Resolve the contract name to an agent identity prefix via
    the existing `toAgentId` transform.

C7. Emit a binding entry:
    `{ [agentPrefix]: emitExpression(expr) }`.

C8. Reject duplicate bindings for the same contract.

### 9.3 `Effects.around` Compilation

For `yield* Effects.around({...})` in the setup prefix, the
compiler MUST:

C9.  Validate the argument shape per §3.5 (EA1–EA2).

C10. Extract the two parameter names from the array binding
     pattern.

C11. Record the continuation parameter name (the second
     parameter) in the compilation context.

C12. Compile the dispatch method body using the existing
     statement compilation pipeline with one addition: within
     this context, `yield* continuationParam(mExpr, mExpr)`
     MUST lower to `Eval("dispatch", Arr(mExpr1, mExpr2))`.

C13. Wrap the compiled body as `Fn([param1, param2], body)`.

C14. Enforce all middleware body restrictions (EA3–EA8).

### 9.4 `useAgent` Compilation

For `const handle = yield* useAgent(Contract)` in the body,
the compiler MUST:

C15. Validate the contract has a corresponding `useTransport`
     in the setup prefix (UA3).

C16. Record a handle binding in the scope context associating
     the variable name with the contract.

C17. Emit no IR. The `yield*` is consumed.

### 9.5 Handle Method Calls

For `yield* handle.method(args)` where `handle` is a recorded
handle binding, the compiler MUST:

C18. Resolve the method against the contract declaration.

C19. Validate method name and arity.

C20. Emit `Eval("agentPrefix.method", compiledArgs)` using the
     existing agent effect compilation rules.

### 9.6 Acceptance and Rejection

The compiler MUST reject authored source that violates any
constraint defined in §3 (S1–S6, UT1–UT3, EA1–EA9, UA1–UA5,
H1–H4) with a diagnostic that identifies the violated
constraint.

The compiler MUST accept authored source that satisfies all
constraints defined in §3 and produce a scope node conforming
to §4.

> **Non-normative.** Specific error codes, diagnostic message
> formats, and diagnostic severity levels are a compiler
> quality-of-implementation concern and are not specified here.
> Implementers SHOULD provide clear, actionable diagnostics
> that reference the violated constraint.

---

## 10. Deferred Extensions

The following are explicitly out of scope for this specification
version. They MAY be addressed in future versions.

### 10.1 Non-Blocking Scope Creation (`spawn`)

`spawn` creates a child scope without blocking the parent. It
requires journal interleaving semantics that this specification
does not define. The scope node encoding, coroutineId allocation
scheme, and metadata model defined here are designed to extend
to `spawn` without modification, but the non-blocking join
strategy and its journal rules are deferred.

### 10.2 Scoped Values (`resource`)

`resource` creates a child scope that yields a value whose
validity is bound to the scope's lifetime. It requires lifecycle
semantics (initialization, value exposure, suspend-until-parent-
exits, cleanup ordering) that this specification does not define.
Transport bindings are semantically resources; the metadata-based
model in this specification is intended as a compatible starting
point.

### 10.3 Closure Capture in Middleware Bodies

Middleware bodies that reference bindings from the enclosing
scope (outside the `*dispatch` method) violate the existing Fn
closure restriction (compiler specification §9.4). Supporting
such references would require either compile-time substitution
or an extension to middleware evaluation. This is deferred.

### 10.4 Richer `next(...)` Control Flow

This specification permits at most one `yield* next(...)` node
in the entire method body AST. Per-branch tracking (allowing
`next` in each branch of an `if/else`) and multi-call patterns
are deferred.

### 10.5 Multiple Middleware Handlers Per Scope

This specification permits at most one `Effects.around` call
per scope. Middleware composition from multiple handlers within
a single scope is deferred.

### 10.6 Dynamic Transport Expressions

Transport binding arguments are expression-valued in this
specification version. Property access, call expressions, and
other authored expressions are allowed, provided they are
accepted by the ordinary expression compiler and evaluate
structurally at scope entry.

### 10.7 Conditional or Interleaved Setup

Setup statements must be unconditional and must precede body
statements. Conditional setup, setup interleaved with body
logic, and runtime-determined scope configuration are deferred.

### 10.8 Additional Constructs in Middleware Bodies

The middleware body subset specified in §3.5 EA3 is the
complete set of accepted constructs for this specification
version. Constructs not listed in EA3 — including `let`
declarations, `let` reassignment, `while` loops, `for` loops,
and `try/catch/finally` — are not accepted in middleware bodies
and MUST be rejected by the compiler.

Future specification versions MAY extend the accepted
middleware body subset. Such extensions are expected to use
existing compiler and kernel machinery without requiring
changes to the scope node semantics defined here.

---

## Appendix A: Compilation Example

> **Non-normative.** This appendix illustrates one possible
> compilation of the target authored example. The exact IR
> encoding — including Quote nesting structure, structural
> operation argument formats, and data field layout — follows
> from the compiler specification's existing rules and is not
> independently normative. Different compilers producing
> semantically equivalent IR that conforms to §4 are
> conforming.

### Source

````typescript
declare function Coder(instance?: string): {
  implement(spec: Spec): Workflow<Patch>;
};

export function* secureCoding(spec: Spec): Workflow<Patch> {
  return yield* scoped(function* () {
    yield* useTransport(Coder, coderTransport);

    yield* Effects.around({
      *dispatch([effectId, data], next) {
        if (effectId === "tisyn.exec") {
          throw new Error("exec denied");
        }
        return yield* next(effectId, data);
      },
    });

    const coder = yield* useAgent(Coder);
    return yield* coder.implement(spec);
  });
}
````

### Setup extraction

| Statement | Classification | Extracted metadata |
|---|---|---|
| `yield* useTransport(Coder, coderTransport)` | Setup | Binding: `{ "coder": Ref("coderTransport") }` |
| `yield* useTransport(Coder, config.coderTransport)` | Setup | Binding: `{ "coder": Get(Ref("config"), "coderTransport") }` |
| `yield* Effects.around({...})` | Setup | Handler: `Fn(["effectId", "data"], ...)` |
| `const coder = yield* useAgent(Coder)` | Body | Handle binding: `coder → Coder` contract (compile-time only) |
| `return yield* coder.implement(spec)` | Body | Agent effect: `Eval("coder.implement", ...)` |

### Compiled IR

````json
{
  "tisyn": "eval",
  "id": "scope",
  "data": {
    "tisyn": "quote",
    "expr": {
      "handler": {
        "tisyn": "fn",
        "params": ["effectId", "data"],
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
                    "a": { "tisyn": "ref", "name": "effectId" },
                    "b": "tisyn.exec"
                  }
                }
              },
              "then": {
                "tisyn": "eval",
                "id": "throw",
                "data": "exec denied"
              },
              "else": {
                "tisyn": "eval",
                "id": "dispatch",
                "data": [
                  { "tisyn": "ref", "name": "effectId" },
                  { "tisyn": "ref", "name": "data" }
                ]
              }
            }
          }
        }
      },
      "bindings": {
        "coder": { "tisyn": "ref", "name": "coderTransport" }
      },
      "body": {
        "tisyn": "eval",
        "id": "coder.implement",
        "data": {
          "tisyn": "quote",
          "expr": {
            "spec": { "tisyn": "ref", "name": "spec" }
          }
        }
      }
    }
  }
}
````

> **Note:** `useAgent(Coder)` does not appear in the IR. The
> handle binding `coder` was resolved at compile time.
> `coder.implement(spec)` lowered to
> `Eval("coder.implement", ...)` with the contract-aware
> payload format.

---

## Appendix B: Implementation Notes

> **Non-normative.** The following are implementation
> observations that may be useful to implementers. They do
> not form part of the normative specification.

### B.1 `Effects.around` AST extraction

The compiler's recognition of the `Effects.around(...)` AST
shape involves TypeScript AST node types that the compiler does
not currently traverse: `MethodDeclaration` with
`asteriskToken`, and `ArrayBindingPattern` with
`BindingElement`s. An implementation spike — writing
`emitEffectsAround` and testing it against the target example's
AST — is recommended before full implementation.

### B.2 Runtime dispatch refactoring

The runtime's `driveKernel` dispatch loop currently branches on
`isCompoundExternal(id)`. Adding `"scope"` creates a third
branch within that path. Future scope-creating operations
(`spawn`, `resource`) will add more. An implementer MAY
refactor the dispatch to branch on a scope-creating-operation
category and then select join strategy, but this refactoring
is not required by this specification.

---

## Appendix C: Deferred Items Summary

| Item | Reason | Future location |
|---|---|---|
| `spawn` | Journal interleaving rules not designed | Future spec |
| `resource` | Lifecycle semantics not designed | Future spec |
| Closure capture in middleware | Violates Fn §9.4; needs design | Future amendment |
| Per-branch `next` tracking | Conservative one-call rule is simpler | Future amendment |
| Multiple `Effects.around` | Composition semantics not designed | Future amendment |
| Dynamic transport expressions | Identifier-only is simpler | Future amendment |
| Conditional/interleaved setup | Determinism concerns | Future amendment |
| `let`/`while`/`try` in middleware | Not part of EA3 accepted set | Future amendment |
| Durable input recording | Deferred per scoped effects spec §9 | Future amendment |
