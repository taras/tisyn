# Tisyn Middleware Standardization Amendment

**Version:** 0.1.0 Draft
**Amends:** Scoped Effects Specification 0.1.0
**Status:** Draft

---

## 1. Overview

### 1.1 Problem Statement

Tisyn's scoped effects model provides a middleware mechanism
via Effection Context APIs (`createApi` + `.around()`), but
this mechanism is not yet standardized as the normative
extensibility interface. New features risk hardening with
ad-hoc extension points — configuration blobs, transport-
specific hooks, hidden registries — instead of exposing
their behavioral variation through the middleware dispatch
boundary.

This amendment establishes Context APIs as the normative
extensibility surface for behavioral extension points in
Tisyn and introduces a normative design direction for agent
façades and future feature design.
Kernel semantics, IR vocabulary, and other explicitly
excluded concerns (§7) remain outside middleware.

### 1.2 Why Context APIs Are the Foundation

Tisyn's middleware is not inspired by or analogous to
Effection Context APIs. It is built on them. The `Effects`
API in `@tisyn/agent` is a Context API whose primitive
operation is `dispatch`:

````typescript
const EffectsApi = createApi("Effects", {
  *dispatch(effectId: string, data: Val): Operation<Val> {
    // core handler: routes to transports, handles
    // built-in effects, manages journal interaction
  },
});
````

`Effects.around(...)` installs middleware via the Context
API's `.around()` method. Scope inheritance, `next`
delegation, and min/max priority ordering are provided by
`@effectionx/context-api`, not reimplemented by Tisyn.

Convenience operations like `Effects.sleep(...)` are
layered sugar over `dispatch` and are not part of the
normative commitment of this amendment. The primitive is
`Effects.dispatch(effectId, data)`.

This amendment treats Context APIs as the primitive and
derives all standardization rules from their semantics.

### 1.3 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY
are used as defined in RFC 2119.

---

## 2. Definitions

**Context API.** An instance created via
`createApi(name, handler)` from `@effectionx/context-api`.
Provides a named operation surface with typed operations
and scope-bound middleware via `.around()`.

**Effects API.** The Context API instance that serves as
Tisyn's universal dispatch boundary. All effect dispatch —
built-in and agent-routed — flows through the Effects API's
middleware chain. Defined in `@tisyn/agent`.

**Agent façade.** A contract-specific author-facing object
returned by `useAgent(Agent)`, backed by a Context API
instance. The façade exposes each declared agent operation
as a direct top-level method (e.g., `reviewer.review(...)`)
and exposes `.around()` for per-agent middleware. Internally,
the backing Context API provides the middleware chain; the
façade flattens the `.operations.*` surface to preserve
authored ergonomics. The façade is not a raw `createApi`
result — it is derived from one.

**Host-side middleware.** Middleware that runs before the
call reaches Tisyn's cross-boundary dispatch and transport
layer. Corresponds to workflow-author concerns: tracing,
budgeting, guards, symbolic resolution. All agent façade
middleware is host-side. Effects middleware at `max` is
host-side.

**Environment-side middleware.** Middleware that runs at or
near the transport/runtime implementation boundary.
Corresponds to runtime concerns: concrete implementation
binding, transport routing, provider-specific adaptation.
Only Effects middleware at `min` occupies this position,
because the Effects core handler is the terminal dispatch
point.

---

## 3. Normative Design Direction

### 3.1 Context APIs Are the Middleware Primitive

All behavioral extension points in Tisyn MUST be expressed
as operations on named Context API instances created via
`createApi(name, handler)`. Middleware composition MUST use
`.around(middlewares, options?)` with the existing max/min
priority model. Concerns that are explicitly outside
middleware (§7) — kernel semantics, IR vocabulary, static
configuration, durable stream algebra — are not subject
to this rule.

The `.around()` method is the sole middleware installation
mechanism. No alternative composition, registration, or
interception mechanism is conforming for behavioral
extension points.

### 3.2 Max and Min Semantics

#### 3.2.1 Local Ordering (Context API Primitive)

Every Context API supports two middleware priorities via
the `options` parameter to `.around()`:

- **`{ at: "max" }` (default):** Outermost position
  relative to this API's core handler. Closest to the
  caller of this API's operations.
- **`{ at: "min" }`:** Innermost position relative to this
  API's core handler. Closest to this API's core handler.

The composition order for max middlewares `[M1, M2]` and
min middlewares `[m1, m2]` within a single API is:

````
M1 → M2 → m1 → m2 → core handler
````

**Registration-to-execution order.** When multiple
middlewares are installed at the same priority within a
scope:

- **Max:** appended. The first `max` installation becomes
  outermost (runs first on the way in, last on the way
  out). Each subsequent `max` installation runs after
  earlier ones on the way in. Source/installation order
  matches execution entry order.

- **Min:** prepended. The first `min` installation becomes
  closest to the core handler (runs last before core).
  Each subsequent `min` installation runs between the max
  layer and earlier `min` installations. Source/
  installation order is the reverse of execution entry
  order within the min layer.

Example: given installations in this order —

````
yield* api.around(A);              // max (default)
yield* api.around(B);              // max (default)
yield* api.around(C, { at: "min" });
yield* api.around(D, { at: "min" });
````

— the execution order is:

````
A → B → D → C → core handler
````

A is outermost (installed first at max). C is closest to
core (installed first at min). D was prepended after C.

This is a Context API primitive. It applies uniformly to
every `createApi` instance. Implementations MUST NOT
introduce additional priority levels, per-hook ordering
annotations, or separate inbound/outbound middleware
primitives.

#### 3.2.2 Architectural Placement (Tisyn-Specific)

The local ordering within a single API does not by itself
determine whether middleware is host-side or environment-
side in Tisyn's architecture. That depends on where the
API's core handler sits relative to the cross-boundary
dispatch and transport layer.

**Effects API.** The Effects core handler is the terminal
dispatch point — it routes effects to transports, handles
built-in effects, and manages journal interaction. For the
Effects API specifically:

- Effects `max` middleware is **host-side**: it wraps
  dispatch before the call reaches transport routing.
- Effects `min` middleware is **environment-side**: it runs
  nearest the transport/implementation boundary. Transport
  binding (`useTransport`) installs at `min` as the
  implementation provider.

**Agent façades.** An agent façade's backing Context API
has a core handler that calls `dispatch()`, which enters
the Effects middleware chain. This core handler is NOT the
terminal dispatch point. For agent façades:

- Agent `max` middleware is **host-side**: outermost
  wrapping of agent operations, farthest from dispatch.
- Agent `min` middleware is **also host-side**: innermost
  wrapping of agent operations, but still before the call
  enters the Effects chain.

Both agent `max` and agent `min` execute before Effects
middleware. The entire agent façade middleware layer is
host-side relative to the Tisyn cross-boundary dispatch
model.

### 3.3 `useAgent(Agent)` Returns an Agent Façade

#### 3.3.1 Current State

`useAgent(Agent)` currently returns a plain `AgentHandle`
whose methods call `dispatch(\`${agentId}.${opName}\`, args)`.
Agent operations are not independently middleware-
addressable — all interception happens at the Effects
level via string-based effect ID filtering.

#### 3.3.2 Normative Direction

`useAgent(Agent)` establishes the contract-to-
implementation dispatch mapping for the named agent in the
current scope and MUST return an **agent façade** — the
author-facing projection of that mapping, backed by a
Context API instance derived from the agent's declared
operations.

**Backing Context API.** The runtime MUST create a Context
API instance via `createApi(\`agent:${id}\`, handler)` with
one operation per declared agent operation. The core handler
for each operation MUST delegate to `Effects.dispatch()`
using the agent's effect ID and the operation's single
payload value. A core handler for an operation with
payload `args` MUST call
`dispatch(\`${agentId}.${opName}\`, args)`. The payload
is the single value passed by the workflow author; the
runtime does not wrap or unwrap it. The transport
protocol's `args: [data]` wire shape is an adapter
detail, not the authored operation model.

**Façade shape.** The façade MUST expose:

- One **direct top-level method** per declared agent
  operation. Each method delegates to the corresponding
  operation on the backing Context API (i.e., calls
  `backingApi.operations.<name>(...)`), so the call
  traverses the backing API's middleware chain.
- An **`.around()` method** that delegates to the backing
  Context API's `.around()`, following standard Context
  API semantics for middleware installation.

The façade is not a raw `createApi` result. A raw Context
API exposes operations under `.operations.*`; the façade
flattens them to the top level. This preserves authored
ergonomics while retaining Context API middleware semantics.

**Illustrative construction:**

````typescript
// Backing Context API (internal, not directly returned)
const backingApi = createApi(`agent:${Reviewer.id}`, {
  *review(patch: Patch): Operation<ReviewResult> {
    return yield* dispatch(`${Reviewer.id}.review`, patch);
  },
});

// Façade (returned by useAgent)
const reviewer = {
  review: backingApi.operations.review,
  around: backingApi.around,
};
````

> **Boundary note.** The backing API's core handler bridges
> between the typed Context API surface (where middleware
> sees typed arguments like `Patch`) and the `Val`-typed
> dispatch boundary (where `Effects.dispatch` accepts
> serializable values). This is a typed-to-`Val` seam
> internal to the façade construction machinery. Tisyn's
> `Val` encompasses all JSON-serializable values, so
> domain types that satisfy this constraint require no
> explicit conversion. The runtime is responsible for
> ensuring compatibility at this seam; authored middleware
> and workflow code never encounter it.

**Preserved ergonomics:**

````typescript
// Calling ergonomics unchanged from current AgentHandle
const reviewer = yield* useAgent(Reviewer);
const result = yield* reviewer.review(patch);

// Per-agent middleware now possible via .around()
// Note: [patch] is Context API tuple destructuring of the
// single-parameter handler, not array-of-args dispatch format.
yield* reviewer.around({
  *review([patch], next) {
    console.log("intercepting review");
    return yield* next(patch);
  },
});
````

#### 3.3.3 Composition Order

When a workflow calls `yield* reviewer.review(patch)`, the
full middleware composition is:

````
reviewer max → reviewer min → Effects max → Effects min → core
````

This nesting is structural: the backing Context API's core
handler for each operation calls `dispatch()`, which enters
the Effects middleware chain. No explicit chaining
configuration is required.

Note that **all agent façade middleware — both max and min
— runs before the call enters the Effects chain.** Agent
`min` is innermost relative to the backing Context API's
core handler, but it is still host-side relative to Tisyn's
cross-boundary dispatch. The environment-side boundary is at
Effects `min`, where transport routing occurs. See §3.2.2.

**Call path vs middleware composition.** The middleware
composition diagram above shows active middleware layers.
The architectural call path is always:

````
façade method
  → backing Context API operation
    → [backing API middleware, if any]
      → backing API core handler
        → Effects.dispatch(effectId, args)
          → [Effects middleware]
            → Effects core handler
````

The backing Context API layer is traversed on every call,
even when no façade middleware is installed. An empty
middleware stack means the backing API operation delegates
directly to its core handler — the layer is not bypassed.

#### 3.3.4 Middleware Visibility Within a Scope

Multiple `useAgent(Coder)` calls within the same scope
MUST resolve to the same dispatch mapping, so that
middleware installed via one façade reference is visible
to all references. The runtime MAY achieve this by caching
façade instances (including their backing Context API) per
agent ID per scope, but the caching strategy is an
implementation detail — the normative requirement is
consistent middleware visibility.

#### 3.3.5 Scope Inheritance

Agent façade middleware follows standard Context API scope
inheritance via the backing Context API. Middleware
installed on `coder.around(...)` in a parent scope is
inherited by child scopes. Child scope installations do
not affect the parent.

> **Clarification.** Middleware attached via an agent
> façade's `.around()` wraps named façade operations — it
> intercepts calls to `review`, `sample`, `fetchOrder`, and
> so on. This is not the same thing as concrete
> implementation binding. All façade-level middleware —
> whether installed at `max` or `min` — is host-side:
> it runs before the call enters the Effects dispatch
> chain. Concrete implementation binding occurs at the
> environment side of the Effects API, where transport
> routing middleware is installed at Effects `min`.

### 3.4 Effects Remains the Universal Dispatch Boundary

The `Effects` Context API is the universal dispatch boundary
through which all effect traffic flows. This is unchanged
from the Scoped Effects Specification. Agent façade
operations dispatch through Effects because the backing
Context API's core handler calls `dispatch()`.

Effects-level middleware intercepts all agent operations
regardless of which agent they target. Agent-level
middleware intercepts only the operations of that specific
agent. The two layers compose structurally.

### 3.5 Implementation-Side Runtime Boundary

The middleware model standardizes host-side composition
(agent façade middleware and Effects `max`) and identifies
Effects `min` as the environment-side position. For `min`
to have a consistent meaning across execution environments,
the implementation substrate that `min` middleware wraps
must itself be uniform.

Tisyn SHOULD standardize a uniform agent-runtime dispatch
boundary across remote, browser-local, and in-process
execution environments. This boundary is the
implementation-side counterpart to `Effects.dispatch(...)`.
It provides the consistent target for environment-side
`min` middleware: regardless of whether an agent runs as a
remote process, a browser-local module, or an in-process
handler, `min` middleware wraps the same dispatch
transition.

Without this standardization, `min` is only "closest to
whatever this runtime happens to do" — its meaning varies
by execution environment, and middleware installed at `min`
has no portable semantic target. With it, environment-side
middleware (transport routing, implementation binding,
provider-specific adaptation) composes against a single
interface.

This boundary is a follow-on design target. Its
specification is deferred to a companion amendment (see
§6, Amendment A6).

### 3.6 Middleware Helpers Are Out of Scope

This amendment does not standardize middleware helper
functions (e.g., guard, resolver, observer, transformer
factories). Raw `.around(...)` is the primitive middleware
surface standardized here. Helper utilities MAY be
introduced in a future amendment if recurring authoring
patterns justify them.

---

## 4. Normative Rules

### R1. Context API Exclusivity for Behavioral Extension Points

Every new behavioral extension point in Tisyn MUST be
expressed as an operation on a named Context API. Ad-hoc
registries, transport-specific configuration hooks, and
implicit global state MUST NOT be introduced as extension
mechanisms for behavioral concerns.

Concerns that are explicitly outside middleware (§7) —
kernel semantics, IR vocabulary, static configuration,
durable stream algebra — are not subject to this rule.

### R2. Named APIs via `createApi`

The naming discipline for extension points is provided by
`createApi(name, handler)`. Each Context API instance has a
domain name and typed operations. `.around(...)` is the
sole middleware composition mechanism. Implementations
MUST NOT introduce a category-dispatch layer or typed
middleware taxonomy above `.around()`.

### R3. Max/Min Is API-Local; Architectural Placement Is API-Dependent

`max` and `min` are local ordering primitives within a
single Context API (§3.2.1). They do not universally
correspond to host-side and environment-side placement.

For the **Effects API**, `min` corresponds to environment-
side placement (transport/implementation binding) and `max`
corresponds to host-side placement (workflow-author
concerns). Transport binding middleware SHOULD install at
Effects `min`. Workflow-level cross-cutting middleware
(tracing, budgeting) SHOULD install at Effects `max`.

For **agent façades**, both `max` and `min` are host-side
relative to the Tisyn cross-boundary dispatch model,
because the backing Context API's core handler enters the
Effects chain. Agent `min` is useful for innermost façade-
local concerns (e.g., argument normalization that should
run after all other façade middleware), but it is not
environment-side.

Implementations MUST NOT introduce additional priority
levels or ordering mechanisms beyond max and min.

### R4. Scope-Bound Middleware

Middleware is scoped to structured concurrency lifetimes
via Effection's scope model. Within a scope, `.around()`
calls are additive. Execution order is determined by
installation order and priority as specified in §3.2.1:
`max` installations are appended (first installed =
outermost); `min` installations are prepended (first
installed = closest to core). Children inherit parent
middleware. Child installations do not affect the parent.
Middleware is removed when the scope exits.

There is no global middleware registry. Middleware MUST
always be installed into a specific scope.

### R5. One Middleware Mechanism

Tisyn has one middleware mechanism for behavioral
extension: Context API `.around(...)`. There is no
second middleware-like layer, no separate enforcement
context, and no privileged interception channel outside
the Context API model. Behavioral constraints, guards,
transformations, routing, and observation are expressed
through Context API middleware.

Concerns that must not be interceptable by workflow
authors are runtime or kernel invariants (§7), not a
parallel middleware system. If the runtime needs to
install cross-cutting constraints, it installs them as
middleware in the runtime's root scope before workflow
execution begins. This is ordinary middleware composition
— the runtime installs first, so its middleware is
outermost per §3.2.1 registration order.

### R6. Replay Is Invisible to Workflow Middleware

This amendment does not expose replay/record phase to
workflow-facing middleware. Replay mechanics remain
invisible to the authored workflow model and to the
middleware surfaces standardized here. Middleware installed
via `.around(...)` MUST be replay-transparent — it MUST
NOT depend on whether the runtime is replaying or
recording. Any replay-aware instrumentation is a runtime-
internal concern, not part of this amendment.

### R7. Agent Façades Are Derived, Not Authored

Agent façades and their backing Context APIs MUST be
derived from agent declarations. Workflow authors MUST NOT
call `createApi` to create agent-level middleware surfaces.
`useAgent(Agent)` returns the façade. The agent declaration
is the source of truth for the operation surface.

---

## 5. Review Checklist for Future Specs

Every new Tisyn feature specification MUST address each
item below. Items marked ◆ are blocking — the spec
MUST NOT proceed to implementation without them.

◆ **Context API inventory.** Does this feature introduce
  a new operation surface? If yes: is it a new `createApi`
  instance, new operations on an existing API, or neither?
  Justify the choice.

◆ **Middleware points.** For each operation this feature
  introduces: can workflow authors or the runtime
  meaningfully intercept it? If yes, it MUST flow through
  a Context API. If no, document why.

◆ **Placement guidance.** For each middleware point: which
  Context API does it belong on (Effects, agent façade,
  or a new API)? Should typical middleware install at max
  or min? Is the placement host-side or environment-side
  per §3.2.2? Document the expected composition.

◆ **Replay transparency.** Middleware standardized for
  this feature MUST be replay-transparent — it MUST NOT
  depend on whether the runtime is replaying or recording
  (R6). If the feature requires replay-aware behavior,
  that behavior belongs in the runtime, not in workflow-
  facing middleware.

◆ **Default behavior.** What happens when no middleware is
  installed? The core handler in `createApi(name, handler)`
  defines this. It MUST be documented and MUST produce
  correct baseline behavior without requiring middleware.

◆ **IR interaction.** If the feature involves cross-
  boundary behavior, does it require new IR nodes or
  kernel primitives? If so, those are kernel/compiler
  concerns, not middleware concerns. Document the
  boundary.

**Scope placement.** At which scope level(s) is middleware
for this feature typically installed? (Workflow root,
delegation scope, per-agent scope.)

**Naming check.** Do all new API names avoid unqualified
use of "policy," "handler" (for middleware), "manager,"
or "provider"?

**Composition with existing APIs.** Does this feature's
middleware compose with Effects middleware? With agent-
level middleware? Document the composition order.

**Anti-junk-drawer check.** Confirm that no new operation
is added to an existing Context API unless it is cohesive
with that API's domain.

---

## 6. Spec Amendments Implied

Ordered by priority. Each amendment identifies the target
specification and the specific sections affected.

### A1. `useAgent()` Returns an Agent Façade

**Priority:** Highest — this is the key standardization
move.

**Target:** Scoped Effects Specification §6.2 (Agent Handle
Lookup), `@tisyn/agent` implementation.

**Changes required:**

1. Amend §6.2 to specify that `useAgent(Agent)` MUST
   return an agent façade — a contract-specific author-
   facing object backed by a Context API instance, not a
   plain callable handle.

2. Define the façade construction contract: the runtime
   creates a backing Context API via `createApi` with one
   operation per declared agent operation; the façade
   exposes these operations as direct top-level methods
   and exposes `.around()` from the backing API.

3. Specify middleware visibility: multiple `useAgent`
   calls for the same agent within a scope MUST resolve
   to the same dispatch mapping.

4. Specify composition order: agent-level middleware
   (on the backing API) runs before Effects middleware
   because the backing API's core handler calls
   `dispatch()`.

5. Amend §6.3 (Separation of Concerns) table to show
   agent handle as a façade backed by a Context API,
   not a plain lookup result.

6. Add test plan items: agent-level middleware intercepts
   operations; agent max runs before Effects max;
   middleware visibility across façade references; scope
   inheritance of agent middleware.

### A2. Formalize Effects as the Universal Dispatch API

**Priority:** High — documentation/normative formalization
of existing behavior.

**Target:** Scoped Effects Specification §3.

**Changes required:**

1. State normatively that Effects is a Context API instance
   created via `createApi("Effects", handler)`.

2. State that `Effects.around(...)` is the scope-level
   middleware installation mechanism.

3. State that all effect dispatch, including agent
   operation dispatch from backing Context API core
   handlers, flows through the Effects chain.

### A3. Document Max/Min and Architectural Placement

**Priority:** High — needed for consistent middleware
placement across future features.

**Target:** Scoped Effects Specification §5.2.

**Changes required:**

1. State that `max` and `min` are local ordering
   primitives within a single Context API, not universal
   architectural placement labels.

2. Document the Effects-specific mapping: Effects `max`
   is host-side, Effects `min` is environment-side
   (transport/implementation binding).

3. Document that for agent façades, both `max` and `min`
   are host-side relative to the Tisyn cross-boundary
   dispatch model.

4. Document that transport binding middleware installs at
   Effects `min` as the implementation provider.

5. Add explicit statement that no additional priority
   levels or ordering mechanisms are conforming.

### A4. Review Checklist Governance

**Priority:** Medium — process change, not code change.

**Target:** Specification process documentation.

**Changes required:**

1. Adopt §5 of this document as a normative part of the
   specification process.

2. Specs missing ◆ items MUST NOT proceed to
   implementation.

### A5. Named Concept Glossary

**Priority:** Low — codifies naming conventions.

**Target:** Core specification appendix.

**Changes required:**

1. Add the terminology from §2 of this document as a
   normative glossary.

2. Define prohibited terms: "policy" (unqualified),
   "handler" (for middleware — reserved for terminal
   execution targets), "manager" (as API name).

### A6. Implementation-Side Agent Runtime Boundary

**Priority:** High — needed for `min` to have consistent
meaning across execution environments.

**Target:** New specification or addendum to the Scoped
Effects Specification and transport specification.

**Changes required:**

1. Define a uniform agent-runtime dispatch boundary that
   all execution environments (remote, browser-local,
   in-process) MUST implement.

2. Specify that this boundary is the implementation-side
   counterpart to `Effects.dispatch(...)` — it is the
   consistent target that Effects `min` middleware wraps.

3. Specify the interface contract: what the boundary
   receives (effect ID, single payload value), what
   it returns, and how errors propagate.

4. Audit existing transport implementations (`stdio`,
   `websocket`, `inprocess`, `local`) against this
   boundary and document any gaps.

5. Ensure that `min` middleware installed on the Effects
   API composes against this boundary uniformly,
   regardless of execution environment.

### A7. Retire `EnforcementContext`

**Priority:** Medium — aligns the implementation with the
single-mechanism principle (R5).

**Target:** `@tisyn/agent` implementation, Scoped Effects
Specification §7.

**Changes required:**

1. Cross-boundary IR `Fn` constraints MUST be installed
   as standard Context API middleware in the runtime's
   root scope before workflow execution begins. This uses
   the ordinary middleware model and scope composition
   rules; it does not introduce a separate enforcement
   mechanism or a non-shadowability guarantee.

2. Remove `installEnforcement`, `EnforcementContext`, and
   the separate enforcement wrapper from `@tisyn/agent`.

3. Verify that the existing `dispatch()` function no
   longer needs a special-case enforcement path — all
   constraints flow through the standard middleware
   chain.

---

## 7. What Belongs Outside Middleware

The following concerns MUST NOT be expressed as Context
APIs and MUST NOT acquire `.around()` surfaces:

**IR node definitions.** The SSA node vocabulary (`Eval`,
`Quote`, `Ref`, `Fn`, `Let`, `Call`) is static data, not
an operation surface.

**Durable stream algebra.** `YieldEvent | CloseEvent` is a
fixed algebraic structure. It is not middleware-addressable.

**Kernel evaluation.** The kernel processes IR nodes via a
deterministic state machine. It has no middleware layer and
MUST NOT acquire one.

**Static configuration.** Environment variables, compile-
time constants, and descriptor data are resolved before
middleware runs. Config resolution MAY become a Context API
in a future version if execution-time config interception
proves necessary, but this is not part of the current
amendment.

**Replay mechanics.** Whether the runtime is replaying
journaled events or recording fresh execution is a
runtime-internal concern. Replay/record phase MUST NOT be
exposed to workflow-facing middleware surfaces standardized
by this amendment (R6).

Cross-boundary constraints (such as parent-imposed limits
on child agent execution) are behavioral and SHOULD be
expressed as standard Context API middleware installed by
the runtime before workflow execution begins (R5), not as
a separate mechanism outside middleware.

---

## 8. Open Questions

### Q1. Host-Provided Middleware in Child Environments

When a host delegates to a child agent execution
environment, the host may need to install middleware that
applies within the child's scope (e.g., budget limits,
capability restrictions, observability hooks).

The runtime SHOULD install these constraints as standard
Context API middleware at `max` in the child environment's
root scope. This is ordinary middleware composition — the
host provides middleware, the child inherits it via scope
inheritance, and the child's own middleware composes inside
it. If the child installs its own middleware at `max`, the
host's middleware still runs first (outermost) per §3.2.1
registration order, because the host installs before the
child's scope begins.

This is not a separate mechanism. It is the standard
Context API scope model applied across an execution
boundary.

---

## Appendix A: Composition Example

> **Non-normative.** Illustrates the full middleware
> composition for a workflow that uses both scope-level
> and agent-level middleware.

### Source

````typescript
yield* scoped(function* () {
  // Scope-level middleware: traces all agent operations
  yield* Effects.around({
    *dispatch([effectId, data], next) {
      tracer.begin(effectId);
      try {
        return yield* next(effectId, data);
      } finally {
        tracer.end(effectId);
      }
    },
  });

  yield* useTransport(LLM, websocket("ws://localhost:9090"));
  yield* useTransport(Reviewer, websocket("ws://localhost:8080"));

  const llm = yield* useAgent(LLM);
  const reviewer = yield* useAgent(Reviewer);

  // Note: [request] is Context API tuple destructuring of the
  // single-parameter handler, not array-of-args dispatch format.

  // Installed first at max → outermost (M1 per §3.2.1)
  yield* llm.around({
    *sample([request], next) {
      if (budget.exhausted()) throw new Error("budget exceeded");
      return yield* next(request);
    },
  });

  // Installed second at max → inner (M2 per §3.2.1)
  yield* llm.around({
    *sample([request], next) {
      return yield* withRetry(3, function* () {
        return yield* next(request);
      });
    },
  });

  const response = yield* llm.sample({ prompt, model: "claude-sonnet" });
  const review = yield* reviewer.review(response);
  return review;
});
````

### Call path for `yield* llm.sample({ prompt, model })`

````
llm.sample(...)                    ← façade method
  → llm max M1 (budget guard)      ← backing API middleware
  → llm max M2 (retry)             ← backing API middleware
  → llm backing API core handler   ← calls dispatch()
    → Effects max M1 (tracer)      ← Effects middleware
    → Effects min (transport)      ← Effects middleware
    → Effects core handler
````

### Call path for `yield* reviewer.review(response)`

````
reviewer.review(...)               ← façade method
  → reviewer backing API core      ← no middleware; delegates
    → Effects max M1 (tracer)      ← Effects middleware
    → Effects min (transport)      ← Effects middleware
    → Effects core handler
````

The reviewer has no agent-level middleware installed, but
the call still traverses the reviewer's backing Context
API — its operation delegates directly to the core handler,
which calls `dispatch()` into the Effects chain. The
backing API layer is not bypassed; its middleware stack is
simply empty.

The distinction between the two call paths is middleware
presence, not architectural structure. Both paths traverse
façade → backing API → Effects. `llm.around(...)` adds
middleware to the LLM backing API's chain. The reviewer's
backing API chain is empty. The architectural transitions
are the same.
