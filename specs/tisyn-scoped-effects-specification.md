# Tisyn Scoped Effects Specification

**Version:** 0.1.0
**Implements:** Tisyn System Specification 1.0.0
**Status:** Draft

---

## 1. Overview

This document specifies the scoped effects model for Tisyn:
how workflows declare agent dependencies, install middleware,
perform effects, and how parent scopes constrain child
execution across delegation boundaries.

The specification defines four semantic roles that the runtime
MUST provide:

- **Scope boundary primitive** — creates an explicit lifetime
  and isolation region.
- **Middleware installation primitive** — installs middleware
  within the current scope.
- **Local binding primitive** — binds an agent identity to a
  local implementation within the current scope.
- **Transport binding primitive** — binds an agent identity to
  a transport within the current scope.
- **Agent facade lookup** — obtains a callable facade for an
  agent within the current scope.

The current reference API surface for these roles is:

````
scoped(...)                          → scope boundary
Effects.around(...)                  → middleware installation
Agents.use(Agent, handlers)          → local binding
useTransport(Agent, transport(...))  → transport binding
useAgent(Agent)                      → agent facade
````

The blocking single-child authored `scoped(function* () { ... })`
surface with setup/body partitioning is specified separately in
the blocking-scope specification. This document defines the
underlying scoped-effects semantics that surface builds on.

The specification also defines:

- a dispatch boundary through which all effects flow,
- a cross-boundary middleware protocol using IR `Fn` nodes,
- scope-local dispatch semantics for IR middleware logic, and
- durability requirements for cross-boundary middleware as
  execution inputs.

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are
used as defined in RFC 2119.

### 1.2 Normative Scope

The **semantic model** described in this specification —
scope boundaries, middleware composition, scope-local dispatch,
transport binding, agent facade resolution, cross-boundary
middleware protocol, and durability requirements — is normative.

The blocking single-child authored `scoped(...)` form, its
compiler lowering, and its runtime teardown/replay rules are
specified separately in the blocking-scope specification.

The **exact API names** (`scoped`, `Effects.around`,
`Agents.use`, `useTransport`, `useAgent`) are the current
reference surface.
They MAY evolve as the authored workflow syntax is finalized.
The semantic requirements they express are stable regardless
of final naming.

The **built-in effect catalog** (Appendix A) is provisional.
The set of built-in effects and their journaling contracts are
expected to stabilize but are not yet the primary normative
commitment of this document.

---

## 2. Terminology

**Scope boundary.** A lifetime and isolation region created by
an explicit scope boundary primitive (reference API: `scoped()`).
Middleware, transport bindings, and agent facades are scoped to
it. Generator functions do NOT create implicit scope boundaries.

**Middleware machinery.** The runtime infrastructure that owns
middleware composition, `next` delegation, scope attachment,
and inheritance. Implemented using Effection's context-api
`around()` pattern. Not serializable.

**Middleware logic.** The decision function inside a middleware
frame that determines whether an effect should be allowed,
denied, or transformed. May be a JavaScript generator function
(host-local) or a Tisyn IR `Fn` node (cross-boundary).

**Agent identity.** The declared name and operation set of an
agent. Defined by `declare function` contracts in authored
source. Independent of how the agent is reached.

**Transport binding.** The association of an agent identity
with a concrete transport within a scope. Established by the
transport binding primitive (reference API: `useTransport()`).
Scoped to the enclosing scope boundary.

**Agent facade.** A callable object returned by the agent
facade lookup primitive (reference API: `useAgent()`) that
provides typed method calls for a transport-bound agent and an
`.around()` middleware surface. Direct methods dispatch
through a per-agent Context API into the scope's `Effects`
middleware chain.

**Dispatch boundary.** The interception point through which all
effects flow. Middleware composes around this boundary.
Workflow-level effect execution enters from the outside. The
runtime MUST expose this boundary; the exact API surface is
part of the reference API.

**Global dispatch.** The outermost dispatch operation. When
workflow code performs an effect, it enters the full middleware
stack from the outside.

**Scope-local dispatch.** The runtime's interpretation of the
`dispatch` effect ID during IR middleware logic evaluation.
When the kernel yields Suspend for `Eval("dispatch", ...)` in
this context, the runtime routes the call to the inner
continuation of the current middleware frame rather than to the
global top of the dispatch chain. The effect ID is `dispatch`
in both cases; the difference is in how the runtime handles
the Suspend.

**Core dispatch handler.** The innermost handler in the
dispatch chain. Routes effects to agents via transports,
handles built-in effects, and manages journal interaction.

**Durable input.** An execution input whose consistency MUST be
validated on replay to ensure reproducible behavior. For the
purposes of this specification, workflow arguments and cross-
boundary middleware logic are durable inputs. The broader Tisyn
runtime model MAY define additional replay-relevant inputs
(such as environment bindings); this specification defers to
the core execution spec for the complete set.

---

## 3. Dispatch Boundary

### 3.1 Requirements

The runtime MUST expose a dispatch boundary through which all
effects flow — both built-in and user-defined. Middleware
composes around this boundary. The dispatch boundary is the
single interception point for all effect traffic within a scope.

All effects MUST enter the dispatch boundary uniformly. There
MUST NOT be a separate path for built-in effects that bypasses
middleware. Middleware installed via the middleware installation
primitive MUST intercept built-in effect calls the same way it
intercepts user-defined effect calls.

### 3.2 Effect ID Namespace

Effects are identified by string IDs. The `tisyn.*` namespace
is reserved for built-in effects provided by the runtime. All
other namespaces are available for user-defined and agent-
provided effects.

### 3.3 Reference API Surface (Provisional)

The current reference API exposes the dispatch boundary as a
scoped API using Effection's `createApi` pattern. The following
is a provisional example of the API shape, not a frozen
normative surface:

````typescript
// Reference API example (provisional)
const Effects = createApi("tisyn.effects", {
  *dispatch(id: string, data: Json): Operation<Json>,
  *sleep(ms: number): Operation<void>,
  *fetch(request: FetchRequest): Operation<FetchResult>,
  *readFile(path: string): Operation<string>,
  *glob(patterns: GlobRequest): Operation<GlobResult>,
  *exec(command: ExecRequest): Operation<ExecResult>,
});
````

The dispatch boundary is the semantic primitive of the Effects
API. All effects — built-in and user-defined — MUST flow
through it. The built-in typed methods (`sleep`, `fetch`,
`readFile`, `glob`, `exec`) are convenience surface only; they
lower to `dispatch` calls with reserved `tisyn.*` effect IDs
and carry no independent semantics beyond that lowering.

For v1 of scoped effects, only the generic `Effects` boundary
is required. Implementations do **not** need to provide the
typed convenience methods (`Effects.sleep`, `Effects.fetch`,
`Effects.readFile`, `Effects.glob`, `Effects.exec`) yet. Those
remain deferred to a later tooling-oriented pass. Middleware
and interception semantics in this specification apply to plain
effect IDs regardless of whether convenience methods exist.

> **Note:** The exact convenience method surface is provisional
> and MAY evolve. The normative commitments of this section are:
> (a) the runtime MUST expose a dispatch boundary, (b) the
> `tisyn.*` namespace is reserved for built-in effects, and
> (c) built-in effects MUST be interceptable by middleware the
> same way as user-defined effects. The specific set of
> convenience methods and their signatures are not yet the
> primary normative commitment. See Appendix A for the current
> built-in effect catalog.

---

## 4. Scope Semantics

### 4.1 Explicit Scope Boundaries

Scope boundaries MUST be created by explicit scope boundary
primitives (reference API: `scoped()`), following Effection's
structured concurrency model.

Generator functions MUST NOT create implicit scope boundaries.
A helper generator or subworkflow invocation does not introduce
a new middleware region, transport binding region, or isolation
boundary unless it explicitly creates a scope.

### 4.2 What a Scope Provides

A scope provides:

- **Middleware isolation.** Middleware installed inside the
  scope does not affect the parent. The scope inherits the
  parent's middleware chain. Extensions are local.
- **Transport lifetime.** Transports bound via the transport
  binding primitive inside the scope MUST be shut down when
  the scope exits.
- **Cancellation boundary.** When the scope exits (normally or
  via cancellation), all child work MUST be halted per
  Effection's structured concurrency guarantees.
- **Delegation region.** A scope MAY represent a region where a
  parent has imposed constraints on child agents via middleware.

### 4.3 Scope as the Unit of Shared Configuration

Shared constraints — middleware that applies to multiple agents
or an entire delegation region — MUST be installed at the scope
level via the middleware installation primitive, not passed
repeatedly through per-agent configuration.

````typescript
// Reference API example
yield* scoped(function* () {
  // Scope-level middleware: applies to all agents in this scope
  yield* Effects.around({
    *dispatch([effectId, data], next) {
      if (effectId === "tisyn.exec") {
        throw new Error("exec denied in this scope");
      }
      return yield* next(effectId, data);
    },
  });

  yield* useTransport(Coder, stdio("node", ["./agents/coder.js"]));
  yield* useTransport(Reviewer, stdio("node", ["./agents/reviewer.js"]));

  const coder = yield* useAgent(Coder);
  const reviewer = yield* useAgent(Reviewer);

  const patch = yield* coder.implement(spec);
  return yield* reviewer.review(patch);
});
````

---

## 5. Middleware Semantics

### 5.1 Installation

All middleware MUST be installed via the middleware installation
primitive (reference API: `Effects.around()`). The installation
mechanism follows Effection's context-api pattern:

- Middleware is stored in Effection context, scoped to the
  current scope.
- Installation clones the middleware registry (never mutates in
  place), appends or prepends the new middleware, recomposes
  the chain, and sets the new context value.
- Children inherit the parent's middleware chain. Child
  installations do not affect parent scope.

All behavioral middleware extension points in this
specification MUST use this `.around()` installation model.
Implementations MUST NOT introduce a separate enforcement
registration path for cross-boundary constraints or per-agent
interception.

### 5.2 Max/Min Priority

Middleware installs at one of two priorities:

- **Max** (default): outermost, closest to the caller.
  Appended to the max array. Suitable for logging,
  instrumentation, tracing.
- **Min**: innermost, closest to the core handler. Prepended
  to the min array. Suitable for implementation replacement
  and innermost local constraints.

The composition order for max middlewares `[M1, M2]` and min
middlewares `[m1, m2]` MUST be:

````
M1 → M2 → m1 → m2 → core handler
````

> **Note:** Parent-supplied cross-boundary middleware is
> installed as the first max-priority middleware in the
> child's execution scope. The context-api prototype chain
> traversal guarantees parent max middleware always runs before
> child max middleware, preserving monotonic narrowing (§7.5).

### 5.3 `next` Delegation

Each middleware receives its arguments as an array and a `next`
function — a JavaScript closure produced by the composition
machinery. `next` captures the remaining middleware chain.

For dispatch middleware, the signature is:

````typescript
*dispatch([effectId, data], next) { ... }
````

The middleware receives the arguments as a destructured array
and delegates by calling `next` with positional arguments:

````typescript
yield* next(effectId, data)
````

This is the normalized JavaScript-side calling convention for
dispatch middleware across all categories, including the
cross-boundary middleware wrapper (§7.5).

`next` is runtime infrastructure. It is NOT serializable. It
MUST NOT be represented as Tisyn IR.

### 5.4 Middleware Categories

Three categories of middleware are supported. All categories
install via the middleware installation primitive and
participate in the scope's composition chain.

**Category A: Host-local.** JavaScript middleware installed
by the host developer. Logging, tracing, metrics, debugging.
Dies with the process. Not serialized. Not journaled. Not
transmitted across boundaries.

**Category B: Durable/replay guards.** *(Deferred — not implemented in v1.)*
JavaScript middleware implementing the two-phase guard pattern:
check phase (I/O allowed, pre-replay) and decide phase
(synchronous comparison, during replay). Guard identity is
stored as journal metadata. Guard implementations are
host-provided. On restart, the runtime reads guard metadata and
re-installs JavaScript guard middleware.

**Category C: Cross-boundary.** Ordinary `Effects.around()`
middleware that evaluates IR middleware logic with scope-local
dispatch interpretation (§8). The IR middleware logic is
received from a parent delegation message. Installed as the
first max-priority middleware in the child's execution scope,
making it outermost via prototype chain traversal (§7.5). See
§7 for the full protocol.

---

## 6. Agent Identity and Binding

### 6.1 Agent Binding

An agent binding associates an agent identity with either a
local implementation or a transport within the current scope.
Both binding forms install `Effects.around()` middleware that
routes matching effects and reports binding status via the
`resolve` operation.

**Local binding** (reference API: `Agents.use(Agent, handlers)`)
installs dispatch and resolve middleware for the given handlers
directly in the current scope:

````typescript
// Reference API example
yield* Agents.use(Coder, {
  *review({ text }) { return `reviewed: ${text}`; },
  *summarize({ text }) { return `summary of: ${text}`; },
});
````

**Transport binding** (reference API:
`useTransport(Agent, transport(...))`) binds an agent identity
to a transport within the current scope:

````typescript
// Reference API example
yield* useTransport(Coder, stdio("node", ["./agents/coder.js"]));
yield* useTransport(Reviewer, websocket("ws://localhost:8080"));
````

Agent identity and binding mechanism are separate concerns.
The binding primitives connect them within a scope.

Transport descriptors (`stdio(...)`, `websocket(...)`, etc.)
are plain functions that return JSON data. They MUST NOT be
compiler built-ins or privileged syntax. The runtime resolves
the transport type string to a transport implementation at
binding time.

Transport bindings MUST be scoped. When the enclosing scope
exits, the runtime MUST shut down the transport.

### 6.2 Agent Facade Lookup

The agent facade lookup primitive (reference API:
`useAgent(Agent)`) obtains a callable facade for dispatching to
a bound agent:

````typescript
// Reference API example
const coder = yield* useAgent(Coder);
const patch = yield* coder.implement(spec);
````

Agent facade lookup is a lookup, not an installation. The agent
MUST already be bound (locally or via transport) in the current
scope or an ancestor scope. If no binding exists, the lookup
MUST fail with a descriptive error.

Binding availability is determined by querying the `resolve`
operation on the Effects middleware chain. Each binding
primitive installs a `resolve` handler that reports `true` for
its agent ID. The default `resolve` handler returns `false`.
This ensures the binding check derives from the routing layer
rather than a separate registry.

The returned facade MUST expose one direct top-level method per
declared agent operation. Each direct method MUST delegate to a
same-named operation on a backing per-agent Context API. The
backing API's core handler MUST dispatch using the agent's
effect ID namespace and the operation's single payload value.

The returned facade MUST also expose `.around()` from the
backing per-agent Context API. Middleware installed there
composes structurally before the `Effects` chain. Both facade
`max` and facade `min` middleware are host-side because the
facade core handler delegates into `Effects` rather than being
the terminal dispatch boundary.

The facade is not a raw Context API result. The `.operations`
namespace remains an implementation detail of the backing API;
the user-facing surface is the flattened direct-method facade.

Multiple `useAgent(Agent)` calls for the same declaration in the
same scope MUST share middleware visibility for that agent.
Child-scope facade middleware is inherited by descendants and
MUST NOT affect the parent after scope exit.

### 6.3 Separation of Concerns

| Concern | Semantic role | Reference API | Phase |
|---|---|---|---|
| Local binding | Local binding primitive | `Agents.use(Agent, handlers)` | Scope setup |
| Transport binding | Transport binding primitive | `useTransport(Agent, transport(...))` | Scope setup |
| Middleware | Middleware installation primitive | `Effects.around(...)` | Scope setup |
| Agent facade | Agent facade lookup | `useAgent(Agent)` | Workflow logic |
| Effect dispatch | Dispatch boundary | `yield* facade.method(data)` | Workflow logic |

Setup and workflow logic are distinct phases. Setup configures
the scope. Workflow logic uses what the scope provides.

---

## 7. Cross-Boundary Middleware Protocol

### 7.1 IR Middleware Logic Representation

Cross-boundary middleware logic MUST be represented as a Tisyn
IR `Fn` node. The `Fn` is a JSON-serializable value that
crosses delegation boundaries in JSON-RPC messages.

The `Fn` MUST accept two parameters — an effect ID (string) and
effect data (Val) — and MUST be a valid Tisyn IR `Fn` node. Its
evaluation MAY complete in one of three ways:

- **Return a value.** The effect is allowed (or short-
  circuited). The returned value is the effect result.
- **Throw.** The effect is denied. The error propagates to the
  caller.
- **Yield Suspend for `dispatch`.** The `Fn` body calls
  `Eval("dispatch", payload)` where payload is a two-element
  array `[effectId, data]`, delegating inward through the
  child's middleware chain with the original or transformed
  data. The runtime handles this Suspend using scope-local
  dispatch interpretation (§8). After the inner chain returns,
  the `Fn` MAY bind and transform the result before returning.

See §7.4 for the full calling convention with examples.

### 7.2 Protocol Field

Cross-boundary middleware logic MUST be carried in a
`middleware` field in the JSON-RPC execute request params:

````json
{
  "jsonrpc": "2.0",
  "id": "root:0",
  "method": "execute",
  "params": {
    "executionId": "ex-abc",
    "taskId": "root.0",
    "operation": "processOrder",
    "args": [{"orderId": "order-123"}],
    "middleware": <Fn node or null>
  }
}
````

The `middleware` field is per-execute. Different delegated tasks
MAY carry different middleware logic. The field is optional; if
absent or null, no cross-boundary middleware is installed.

### 7.3 Child Runtime Installation

When a child runtime receives an execute request with a
`middleware` field:

1. The runtime MUST validate the `Fn` node via `validateIr`.
   Malformed or invalid nodes MUST be rejected with a protocol
   error.
2. The runtime MUST install ordinary `Effects.around()`
   middleware as the first max-priority layer in the child's
   execution scope (§7.5). This ensures it is outermost via
   prototype chain traversal.
3. The middleware MUST evaluate the `Fn` using scope-local
   dispatch interpretation: any `Eval("dispatch", ...)` the
   kernel yields Suspend for MUST be routed to the child's
   composed middleware chain via `next` (see §8).
4. *(Deferred — not implemented in v1.)* The runtime MUST
   record the `Fn` as a durable input to the execution (see §9).

### 7.4 Middleware Logic Calling Convention

> **Notation.** The examples below use compact constructor-style
> notation (e.g., `Eval(...)`, `Let(...)`, `Ref(...)`) for
> readability. These correspond to the standard Tisyn IR node
> constructors. The normative requirement is that middleware
> logic be representable as a valid Tisyn IR `Fn` node; the
> constructor notation is shorthand for the underlying JSON IR.

The `dispatch` effect is invoked as
`Eval("dispatch", [effectId, data])` — an `Eval` node with
effect ID `"dispatch"` and a two-element array payload
containing the forwarded effect ID and effect data. This is the
normalized shape for all `dispatch` calls within IR middleware
logic.

Within its body, the IR `Fn` MAY:

- **Allow and delegate.** Call `Eval("dispatch", [effectId,
  data])` to continue through the inner chain.
- **Transform request.** Call `dispatch` with modified data:
  `Eval("dispatch", [effectId, transformedData])`.
- **Filter or transform results.** Bind the dispatch result
  with `Let` and transform it before returning:

  ````
  Let("result",
    Eval("dispatch", [Ref("effectId"), Ref("data")]),
    If(Eq(Ref("effectId"), "tisyn.fetch"),
      Construct({ status: Get(Ref("result"), "status"),
                  body: Get(Ref("result"), "body") }),
      Ref("result")))
  ````

- **Deny.** Call `Throw("reason")` to reject the effect.
- **Short-circuit.** Return a literal value without calling
  `dispatch`.

### 7.5 Monotonic Narrowing

Cross-boundary middleware logic from a parent MUST be
non-bypassable by the child's own middleware installations.

#### Composition across scope depth

When a parent delegates to a child with a `middleware` field,
the child runtime installs the parent's IR middleware logic as
ordinary `Effects.around()` middleware at default (max)
priority. This middleware MUST execute for every effect the
child performs, regardless of what other middleware the child
installs.

The non-bypassability guarantee comes from the context-api
prototype chain traversal:

1. The child runtime creates a scoped block for execution and
   installs the cross-boundary middleware as the FIRST
   `Effects.around()` call (outermost max in that scope).
2. Any subsequent `Effects.around()` calls (transport bindings,
   handler-installed middleware) become inner max layers.
3. At dispatch time, `collectMiddleware` walks the scope
   prototype chain from child to root. For each scope level,
   parent max middleware is placed before child max middleware
   via `unshift`. This structurally guarantees that the
   cross-boundary middleware runs outermost.
4. If the cross-boundary middleware throws or short-circuits,
   the child's inner layers are never entered.

This ordering guarantees that no child-installed middleware —
whether max or min, whether it short-circuits or not — can
execute before the parent's cross-boundary middleware has run.

#### Execution ordering

For every effect the child performs, the execution order MUST
be:

````
parent cross-boundary middleware (outermost max)
  → child max-1 → child max-2 → ... → child max-N
    → child min-1 → child min-2 → ... → child min-M
      → core dispatch handler
````

The parent cross-boundary middleware is outermost. If it denies
or short-circuits, no child layer executes. If it delegates via
scope-local `dispatch` (calling `next`), execution enters the
child's composed chain (remaining max layers, then min layers,
then core).

#### What the child may do

The child MAY install additional middleware within its own
scope that further narrows the allowed effects (additional
restrictions, logging, tracing). The child MUST NOT circumvent
the parent's cross-boundary middleware.

#### Why this works without a separate enforcement context

The context-api `collectMiddleware` function walks the scope
prototype chain and places parent max middleware at the front
of the combined array via `unshift`. This means parent max
middleware ALWAYS runs before child max middleware, regardless
of installation order within the child scope. A child-installed
max middleware cannot short-circuit before the parent's max
middleware because the parent's layer is structurally outermost
in the combined chain.

---

## 8. Scope-Local Dispatch Semantics

### 8.1 Mechanism

When the runtime evaluates IR middleware logic inside a
cross-boundary `Effects.around()` middleware (§7.5), the kernel
processes `Eval("dispatch", ...)` as an ordinary external
Eval — it yields Suspend with the effect ID `dispatch` and the
provided data. The kernel has no special knowledge of
`dispatch`.

The `evaluateMiddlewareFn` function intercepts this Suspend
and routes it to the `next` continuation — the remainder of the
Effects middleware chain — rather than to the global top of the
dispatch stack.

This is scope-local dispatch: the effect ID is `dispatch`, the
same as in workflow code. The difference is entirely in how the
middleware wrapper handles the Suspend during IR middleware
logic evaluation.

The continuation-relative interpretation of
`Eval("dispatch", ...)` MUST apply **only** while the runtime
is evaluating cross-boundary IR middleware logic inside the
`Effects.around()` wrapper. Outside that context — in workflow
code, in host-local JavaScript middleware, in guard
middleware — `dispatch` retains its ordinary global
dispatch-boundary behavior and enters the full middleware stack
from the outside.

### 8.2 Not a Special Effect ID

There MUST NOT be a separate `dispatch.inner` or
`dispatch.next` effect ID. The effect ID is `dispatch`. Its
scope-local meaning is determined by the runtime's Suspend
handler during IR middleware logic evaluation, not by the
kernel, not by the effect ID string, and not by an environment
binding.

### 8.3 Non-Recursion Guarantee

When `evaluateMiddlewareFn` routes a scope-local `dispatch`
Suspend to `next`, that call MUST enter the remainder of the
middleware chain. It MUST NOT re-enter the cross-boundary
middleware wrapper. It MUST NOT trigger the IR middleware logic
again.

This guarantee prevents infinite regress: the middleware
logic's dispatch call continues inward via `next`, past the
cross-boundary middleware layer.

### 8.4 Runtime Implementation

The runtime MUST implement scope-local dispatch via the
following mechanism:

1. Evaluate `Call(middlewareFn, [effectId, data])` using the
   kernel.
2. When the kernel yields Suspend for effect ID `dispatch`,
   the Suspend carries the `dispatch` payload — a two-element
   array `[forwardedEffectId, forwardedData]` as defined in
   §7.4. The runtime extracts these two elements from the
   payload.
3. The runtime calls `yield* next(forwardedEffectId,
   forwardedData)` on the JavaScript side — where `next` is
   the inner continuation (the child's composed chain),
   invoked with positional arguments per the normalized JS
   middleware calling convention (§5.3).
4. The result from `next` is fed back to the kernel to resume
   evaluation.
5. If evaluation completes with a value (no `dispatch` call),
   return the value directly (short-circuit).
6. If evaluation throws, propagate the error (effect denied).

---

## 9. Durability and Replay

### 9.1 IR Middleware Logic as Durable Input

> **Deferred.** Not implemented in v1. `DurableEvent` is
> `YieldEvent | CloseEvent` only — no durable-input recording
> for cross-boundary middleware exists. The semantics below
> describe the intended future behavior.

Cross-boundary IR middleware logic MUST be treated as a durable
input to the child execution. The runtime MUST record it
alongside other durable inputs (workflow arguments and any
additional replay-relevant inputs defined by the core execution
model).

### 9.2 Replay Validation

> **Deferred.** Not implemented in v1 — see §9.1.

On replay, the runtime MUST validate that all durable inputs
are consistent with the original execution. If the IR
middleware logic received on re-delegation after crash differs
from the recorded input, the runtime MUST treat this as an
input mismatch according to the system's existing durable input
validation model.

### 9.3 Middleware Re-Installation on Replay

> **Deferred.** Not implemented in v1 — see §9.1.

On replay, the runtime MUST read the stored IR middleware logic
from the durable inputs and re-install the same enforcement
wrapper. The same scope-local dispatch semantics (§8) MUST
apply.

### 9.4 Guard Middleware Durability

> **Deferred.** Category B (durable/replay guard) middleware is
> not implemented in this release. `DurableEvent` is `YieldEvent | CloseEvent`
> only — no guard identity metadata is stored in the journal.
> The semantics below describe the intended future behavior.

Category B guard middleware is durable through guard identity
metadata stored in the journal, not through IR representation.
The runtime MUST read guard metadata on restart and re-install
JavaScript guard middleware via the middleware installation
primitive. Guard implementations are host-provided.

---

## 10. Pure Middleware Logic Constraints (v1)

### 10.1 Permitted Operations

Cross-boundary IR middleware logic is a valid Tisyn IR `Fn`
node. Its body MAY use any IR node kind required to represent
a well-formed function — including `Ref`, `Fn`, `Let`,
`Quote`, literals, and data structures.

The v1 constraint applies to **Eval operations** within the
middleware logic body:

- The only permitted external Eval is
  `Eval("dispatch", [effectId, data])`, interpreted as scope-
  local dispatch (§8).
- The permitted structural Eval operations are: `if`, `eq`,
  `neq`, `and`, `or`, `not`, `get`, `gt`, `gte`, `lt`, `lte`,
  `let`, `throw`, `construct`, `array`, `concat`.
- All other Eval operations — including `tisyn.fetch`,
  `tisyn.exec`, `tisyn.readFile`, `tisyn.glob`, `tisyn.sleep`,
  and any user-defined effect ID — are prohibited in v1
  middleware logic. See §10.2.

### 10.2 No Arbitrary External Effects

Cross-boundary IR middleware logic MUST NOT call external
effects other than `dispatch` in v1. Specifically, it MUST NOT
call `tisyn.fetch`, `tisyn.exec`, `tisyn.readFile`,
`tisyn.glob`, `tisyn.sleep`, or any user-defined effect ID
from within IR middleware logic.

The sole permitted external call is `dispatch`, which the
runtime interprets as scope-local dispatch to the inner
continuation (§8).

### 10.3 Result Transformation

Result transformation via `Let` + `dispatch` + structural
operations is supported in v1. The IR middleware logic MAY
bind the result of a `dispatch` call and transform it before
returning.

### 10.4 Effectful Guards

Guards that require I/O (reading files, computing hashes,
scanning directories) MUST use JavaScript middleware with the
two-phase guard pattern from `@effectionx/durable-effects`.
They MUST NOT be expressed as IR middleware logic in v1.

---

## 11. Compiler Boundaries

### 11.1 No Middleware Awareness

The compiler MUST NOT have knowledge of middleware semantics,
middleware installation, or middleware logic `Fn` nodes. If an
IR `Fn` appears in authored source as a literal, the compiler
MUST lower it as a normal `Fn` value.

### 11.2 Authored Form Recognition

The compiler SHOULD recognize authored forms corresponding to
the transport binding and agent facade lookup semantic roles
(§1). It MUST lower them to declaration or effect nodes as
appropriate per the compiler specification. The exact authored
syntax for these forms is determined by the compiler
specification, not this document, and MAY evolve independently
of this specification per §1.2.

---

## 12. Kernel Boundaries

### 12.1 No Middleware Awareness

The kernel MUST NOT have knowledge of middleware. When the
runtime evaluates IR middleware logic via
`Call(middlewareFn, [effectId, data])`, the kernel processes
this as a normal structural `Call`.

### 12.2 Dispatch in Middleware Logic

When IR middleware logic calls `Eval("dispatch", ...)`, the
kernel yields Suspend with effect ID `dispatch` — its standard
behavior for any external Eval. The kernel does not know that
this Suspend will be handled differently from a global dispatch
call.

The scope-local interpretation is entirely a runtime concern.
The runtime's Suspend handler during middleware logic evaluation
routes `dispatch` Suspends to the inner continuation rather
than the global dispatch stack (see §8). No kernel mechanism is
involved in this routing decision.

---

## 13. Runtime Responsibilities

The runtime MUST:

1. **Provide a dispatch boundary.** Expose a scoped dispatch
   boundary through which all effects flow. Built-in effects
   and user-defined effects MUST enter the same boundary.
2. **Process transport binding.** Bind agent identities to
   transport implementations within the current scope. Manage
   transport lifetime — shut down on scope exit.
3. **Process agent facade lookup.** Return typed facades that
   dispatch through per-agent Context APIs and the scope's
   Effects middleware chain. Fail with a descriptive error if
   no transport binding exists.
4. **Install host-local middleware.** Process middleware
   installation calls with JavaScript middleware per the
   context-api pattern.
5. **Install cross-boundary middleware.** Read IR middleware
   logic from delegation messages (§7.3). Validate. Install as
   ordinary `Effects.around()` middleware with scope-local
   dispatch interpretation (§8), as the first max-priority
   layer in the execution scope per §7.5.
6. *(Deferred — not implemented in v1.)* **Record durable inputs.**
   Store cross-boundary IR middleware logic alongside other
   execution inputs. Validate consistency on replay (§9).
7. **Provide the generic effect boundary.** The runtime MUST
   route plain effect IDs, including reserved `tisyn.*` IDs,
   through the same scoped `Effects` boundary.
8. **Handle built-in effects when implemented.** If the runtime
   implements any provisional built-in `tisyn.*` effects, it
   MUST route them through the same boundary and journal them
   per Appendix A.
9. **Route user-defined effects.** Route non-`tisyn.*` effect
   IDs to agent-registered handlers via transport bindings.

---

## 14. Deferred Extensions

The following are explicitly out of scope for v1. They MAY be
added in future versions of this specification.

### 14.1 Automatic IR `Fn` Wrapping

The middleware installation primitive does not accept IR `Fn`
nodes directly in v1. Cross-boundary IR middleware logic MUST
be wrapped explicitly by the runtime (§7.3, §8.4). A future
version MAY allow the middleware installation primitive to
auto-detect IR `Fn` nodes and construct the JavaScript wrapper
internally.

### 14.2 Additional Structural Operations

The structural operation set MAY be extended in future versions
to support middleware logic patterns such as list membership
(`contains`), string prefix matching (`starts-with`), or
pattern matching. Extensions MUST be added to the kernel's
structural operation set via a specification revision.

### 14.3 Per-Agent Middleware Refinement

Scope-level middleware installation is the primary sharing
mechanism. A future version MAY add per-agent refinement —
additional middleware applied to a single agent's effects
within a scope. This MUST NOT become the primary composition
model.

### 14.4 Reusable Middleware Abstractions

Users will want composable helpers that install middleware into
the current scope:

````typescript
yield* useLogging();
yield* useRetry({ maxAttempts: 3, backoff: "exponential" });
yield* useRateLimit({ effectId: "tisyn.fetch", maxPerSecond: 10 });
````

The `useX()` naming convention, composition ordering guidance,
and authored syntax relationship are deferred to a future
version. The current scope-based model supports these helpers
— each calls the middleware installation primitive internally
— but the conventions are not yet standardized.

### 14.5 Ergonomic Sugar

Common patterns (a scope with specific restrictions plus
transport bindings) MAY benefit from combined APIs that reduce
boilerplate. Sugar design is deferred until usage patterns are
observed.

### 14.6 Effectful IR Middleware Logic

A future version MAY allow cross-boundary IR middleware logic
to call external effects beyond `dispatch`. This would require
addressing recursive interception, journal scoping, and the
enforcement/execution boundary. It is explicitly excluded from
v1.

### 14.7 Typed Built-In `Effects.*` Methods

The typed convenience methods shown in §3.3
(`Effects.sleep`, `Effects.fetch`, `Effects.readFile`,
`Effects.glob`, `Effects.exec`) are explicitly deferred. v1
requires only the generic `Effects.dispatch` boundary and the
reserved `tisyn.*` namespace. A future version MAY add the
typed convenience surface once the built-in effect catalog is
ready to stabilize around real tooling and LLM use cases.

---

## Appendix A: Built-in Effect Catalog (Provisional)

> **Status:** This appendix is provisional. The set of built-in
> effects and their journaling contracts are expected to
> stabilize but are not yet the primary normative commitment of
> this specification. The normative core is the scoped effects
> architecture defined in §§3–9. Implementations of scoped
> effects v1 do not need to ship the typed convenience methods
> shown in §3.3 or the full built-in handler set listed here.

### A.1 Built-in Effect IDs

The runtime SHOULD provide handlers for the following built-in
effect IDs under the reserved `tisyn.*` namespace:

| Effect ID | Description |
|---|---|
| `tisyn.sleep` | Durable timer |
| `tisyn.fetch` | HTTP request |
| `tisyn.exec` | Subprocess execution |
| `tisyn.readFile` | File read |
| `tisyn.glob` | Directory scan |

All built-in effects are subject to middleware per §3.1.

### A.2 Journaling Contracts

Each built-in effect SHOULD produce journal entries with the
following description/result shapes. These shapes are designed
to support replay, security redaction, and guard integration.

**`tisyn.sleep`**
- Description: `{ kind: "tisyn.sleep", duration: number }`
- Result: `{ completedAt: string }`
- On replay: return immediately, no wait.

**`tisyn.fetch`**
- Description: `{ kind: "tisyn.fetch", url, method, safeHeaders, bodyHash }`
- Result: `{ status, filteredHeaders, body, bodyHash }`
- Security: sensitive request headers SHOULD be redacted from
  the description. Request body SHOULD be hashed, not stored.

**`tisyn.exec`**
- Description: `{ kind: "tisyn.exec", command, cwd, envKeys, timeout }`
- Result: `{ exitCode, stdout, stderr }`
- Security: environment variable values SHOULD NOT appear in
  the description. Only key names are recorded.

**`tisyn.readFile`**
- Description: `{ kind: "tisyn.readFile", path, encoding }`
- Result: `{ content, contentHash }`
- The `contentHash` field enables replay guard integration.

**`tisyn.glob`**
- Description: `{ kind: "tisyn.glob", baseDir, include, exclude }`
- Result: `{ matches: [{path, contentHash}], scanHash }`
- Matches SHOULD be sorted by path. Duplicates SHOULD be
  removed.

### A.3 Design Rationale

These five built-in effects were selected because they cover
the most common I/O patterns in agent workflows, each has a
natural journaling shape, each benefits from middleware
interception (host restriction, path sandboxing, command
filtering), and each has a corresponding precedent in
`@effectionx/durable-effects`.

**Excluded from built-ins:** `eval` and `resolve` from
`@effectionx/durable-effects` are too specialized for the core
runtime. They SHOULD be user-space effects dispatched via
the dispatch boundary with application-specific effect IDs.
