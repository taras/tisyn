# Tisyn Nested Invocation Specification

**Status.** Normative. MVP.
**Depends on.** `tisyn-kernel-specification.md`; `tisyn-scoped-effects-specification.md` (§9 and companion test MR-002, Core tier); `tisyn-compound-concurrency-specification.md` (§4.2, §9, §10, §10.6.2). Operational precedents: `tisyn-spawn-specification.md`, `tisyn-resource-specification.md`, `tisyn-timebox-specification.md`.
**Depended on by.** None in MVP.
**Exports (terminology).** *nested invocation*, *invoking middleware*, *invoked child*, *unified child allocator*.

---

## 1. Overview

**Nested invocation** is a runtime-controlled mechanism by which dispatch-boundary middleware MAY execute a compiled `Fn` as a child coroutine of the current parent coroutine. The child participates in the parent's journal, middleware chain, agent binding, transport bindings, scoped-effect stack, and residual lifetime, with deterministic child identity drawn from the parent's existing unified `childSpawnCount` allocator.

Nested invocation is a **runtime-internal primitive**, initiated from middleware executing on the runtime-controlled dispatch boundary — outside kernel IR evaluation — through the public API `ctx.invoke(...)`. It is not a kernel descriptor, not a compound external, and not a new durable event kind. The durable event algebra `YieldEvent | CloseEvent` is unmodified. The kernel is unmodified. The compiler is unmodified.

The child produced by a nested invocation participates in the same journal, the same dispatch routing, the same middleware chain, and the same lifetime model as any other child of its parent.

---

## 2. Normative scope

This specification defines:

- The public API `ctx.invoke` and its call-site preconditions.
- How the runtime allocates child identity for nested invocations.
- How the runtime constructs, drives, and tears down the invoked child.
- How nested invocation participates in journal ordering, replay, error propagation, and cancellation.
- The durable-input treatment of nested-invocation inputs.
- Conformance hooks.
- Forward-compatibility anchors for a future subordinate remote executor model.

This specification does not define:

- Any new kernel descriptor, any change to kernel classification, or any change to the kernel SUSPEND/resume contract.
- Any compiler-visible form of nested invocation. `ctx.invoke` has no IR form.
- Any new durable event kind.
- Any new child-ID counter or namespace.
- The behavior of concurrent nested invocations from a single invoking middleware body (see §15).
- Any wire protocol, transport format, or failure semantics for subordinate remote execution (see §14).

---

## 3. Relationship to existing specs

**Kernel specification.** Unmodified. `ctx.invoke` does not produce a kernel descriptor, does not invoke SUSPEND, is not classified, and does not execute inside kernel IR evaluation. The kernel has no knowledge of `ctx.invoke`.

**Scoped-effects specification.** The replay property on which this specification relies is §9 ("Durability and Replay"), enforced by the Core-tier companion test MR-002. This specification does not alter any scoped-effects semantics. One synchronized cross-reference paragraph is added under scoped-effects §3 (Dispatch Boundary) to name `ctx.invoke` and point to this specification (see §16.1 of this specification).

**Compound concurrency specification.** The unified child allocator (§4.2) and the per-coroutineId replay cursor model (§10) are reused by reference. This specification does not alter any compound concurrency semantics. One synchronized cross-reference paragraph is added under compound concurrency §4.2 to note that `ctx.invoke` advances the unified allocator (see §16.2 of this specification). Ordering invariants (§9), replay rules (§10.1, §10.3), and the Durable Yield Rule (§10.6.2) apply without modification.

**Spawn specification.** Operational precedent for participation in the unified `childSpawnCount` (§8.3, §A.1, §A.4) and for fresh-instance-on-replay of ephemeral runtime-side values.

**Resource specification.** Operational precedent for unified-allocator participation (§10.2).

**Timebox specification.** Operational precedent for per-origin advancement amount differing from `+1` (timebox advances by `+2` per invocation; nested invocation advances by `+1`).

**Stream iteration specification.** Unmodified. The durable event algebra `YieldEvent | CloseEvent` is closed.

**Agent specification.** Unmodified. `ctx.invoke` is callable from the dispatch-boundary middleware surface already defined there. Agent operation handlers MUST NOT call `ctx.invoke` (§4).

---

## 4. Terminology

**Nested invocation.** The act of executing a compiled `Fn` as a child coroutine by calling `ctx.invoke` from dispatch-boundary code.

**Invoking middleware.** Dispatch-boundary code that calls `ctx.invoke`. This includes `Effects.around()` bodies, agent-facade per-operation middleware bodies, and any other code executing on the runtime-controlled dispatch boundary — outside kernel IR evaluation — that is re-executed on replay per scoped-effects §9. The term "host operation" as used informally elsewhere is equivalent to *invoking middleware* for the purposes of this specification and is not introduced as a distinct term.

**Invoked child.** The child coroutine allocated and driven as a consequence of a `ctx.invoke` call.

**Unified child allocator.** The parent coroutine's single `childSpawnCount` counter defined by compound concurrency §4.2, shared by all mechanisms that allocate children under the parent.

**Dispatch boundary.** The runtime-controlled interception point through which all effects flow, defined by scoped-effects §3. Middleware composes around this boundary and executes outside kernel IR evaluation.

---

## 5. API

### 5.1 Signature

The runtime MUST expose an operation `invoke` on the dispatch-boundary context `ctx` with the following signature:

```
ctx.invoke<T>(
  fn: Fn<T>,
  args: ReadonlyArray<Val>,
  opts?: { overlay?: ScopedEffectOverlay; label?: string }
): Operation<T>
```

### 5.2 Naming

The public name of this operation MUST be `invoke`. The spec term for the semantic concept MUST be *nested invocation*. Implementations MAY use additional internal helper names; such names are not part of the normative surface.

### 5.3 Call-site preconditions

5.3.1. `ctx.invoke` MUST be called only from within the dynamic extent of an active dispatch-boundary middleware call.

5.3.2. Calls from code that is not re-executed on replay — in particular, calls from agent operation handlers — MUST NOT occur. The runtime SHOULD surface such calls as a runtime error when detectable.

5.3.3. A call to `ctx.invoke` made outside the dynamic extent of active dispatch-boundary middleware MUST produce a runtime error and MUST NOT advance the unified child allocator.

### 5.4 Suspension model

5.4.1. `ctx.invoke` returns an Effection `Operation<T>`. The invoking middleware MUST compose it using ordinary generator delegation (`yield* ctx.invoke(...)`).

5.4.2. The suspension produced by `yield* ctx.invoke(...)` is an Effection suspension on the runtime-controlled dispatch boundary. It MUST NOT be a kernel SUSPEND and MUST NOT occur inside kernel IR evaluation.

### 5.5 Input validity

5.5.1. `fn` MUST be a compiled `Fn` value.

5.5.2. `args` MUST be a sequence of serializable values in the Tisyn `Val` domain.

5.5.3. `opts.overlay`, if present, MUST be a valid scoped-effect frame per scoped-effects §5.

5.5.4. `opts.label`, if present, is diagnostic and MUST NOT be journaled.

---

## 6. Child identity and unified allocator

This section is load-bearing. It defines identity allocation for all nested invocations.

### 6.1 Allocator ownership

Each parent coroutine MUST have exactly one child allocator. That allocator MUST be the `childSpawnCount` counter defined by compound concurrency §4.2. The allocator MUST be owned by the runtime, monotonic, initialized at parent coroutine creation, and MUST NOT be reset during the parent coroutine's lifetime.

### 6.2 Advancement on nested invocation

A `ctx.invoke` call MUST advance the unified child allocator by exactly `+1` atomically at the moment the runtime begins processing the call. The allocated child coroutineId MUST be `parentId.{k}`, where `k` is the pre-increment value of the allocator.

### 6.3 Mixed-origin allocation

Nested-invocation allocations and kernel-origin allocations (`scope`, `all`, `race`, `spawn`, `resource`, `timebox`) MUST share the same allocator. In program order, each allocation MUST advance the counter by its per-origin amount: `+1` for nested invocation, `spawn`, `scope`, `race`, `all`, `resource`; `+2` for `timebox`.

### 6.4 Determinism

The interleaving of nested-invocation allocations with kernel-origin allocations within a single parent MUST be deterministic. This follows from kernel spec §11 (kernel determinism), scoped-effects §9 (middleware determinism), and the synchronous placement of middleware execution within the dispatch of specific, deterministic parent kernel yields.

### 6.5 Invariant I-ID

For the same IR, the same inputs, and the same middleware code, child coroutineIds allocated for nested invocations MUST be byte-identical across original run and replay. This is invariant I-ID of compound concurrency §4.2, applied uniformly across all allocation origins.

### 6.6 ID format

All child coroutineIds under a parent MUST use the `parentId.{k}` format defined by compound concurrency §4.2. This specification MUST NOT introduce any alternate separator, prefix, or namespaced counter.

---

## 7. Execution semantics (original run)

On each call to `ctx.invoke(fn, args, opts)`, the runtime MUST perform the following in order:

### 7.1 Allocator advancement

The runtime MUST advance the unified child allocator per §6.2 and compute the child coroutineId `C = parentId.{k}`.

### 7.2 Child kernel construction

The runtime MUST construct a fresh kernel instance for `fn` with `args` as its inputs.

### 7.3 Context inheritance

The runtime MUST construct the child's execution context by inheriting the parent's middleware stack, agent binding, transport bindings, and scoped-effect stack.

### 7.4 Overlay push

If `opts.overlay` is present, the runtime MUST push it as an additional scoped-effect frame at the moment of child construction. The push MUST be owned by the runtime, not by the invoking middleware.

### 7.5 Child execution

The runtime MUST drive the child via the same `driveKernel` loop that drives every coroutine. Child yields MUST flow through the same dispatch boundary as any other coroutine's yields. The child's `YieldEvent` entries and terminal `CloseEvent` MUST be written under coroutineId `C` through the ordinary runtime journal writer.

### 7.6 No journal event under parent for `ctx.invoke`

The `ctx.invoke` call itself MUST NOT write a `YieldEvent` or `CloseEvent` under the parent coroutineId. The parent's journal is unchanged by `ctx.invoke`; only the child's own journal entries under `C` are produced.

### 7.7 Overlay pop

If an overlay was pushed per §7.4, the runtime MUST pop it before `ctx.invoke` returns or throws. The pop MUST NOT outlive the child's execution.

### 7.8 Resumption of the invoking middleware

On the child's terminal `CloseEvent`, the runtime MUST resolve the Operation returned by `ctx.invoke`:

- On normal close (child terminated with a value), the Operation MUST resolve with the child's terminal value.
- On abnormal close (error, cancelled, diverged, bug), the Operation MUST throw an Effection-level exception carrying the reified close reason.

---

## 8. Replay semantics

Nested invocation introduces no replay mechanism. Its replay behavior derives entirely from existing normative clauses, stated here for traceability.

### 8.1 Parent kernel re-evaluation

On replay, the parent kernel MUST re-evaluate its IR per kernel spec §10.5. At external yield points, the runtime MUST feed journaled outcomes instead of live-dispatching.

### 8.2 Invoking-middleware re-execution

On replay, the invoking middleware MUST re-execute identically per scoped-effects §9 and companion test MR-002 (Core tier). No replay-phase API is exposed to middleware, and the runtime MUST NOT selectively skip middleware during replay.

### 8.3 Allocator advancement on replay

On replay, the unified child allocator MUST advance through the same sequence of advancements in the same order as on the original run. This follows from §6.4. For each `ctx.invoke` call, the child coroutineId allocated on replay MUST equal the child coroutineId allocated on the original run. Invariant I-ID MUST hold.

### 8.4 Child replay

The invoked child MUST replay from its own journal under coroutineId `C` per compound concurrency §10.1 and §10.3:

- If `C` has a complete journal (ending in `CloseEvent`), the child MUST replay to completion without live dispatch.
- If `C` has a partial journal, the child MUST replay the stored entries and then transition to live execution at the first missing yield.
- If `C` has no journaled entries, the child MUST begin live execution.

### 8.5 Durable Yield Rule

The Durable Yield Rule of compound concurrency §10.6.2 MUST apply to every yield produced by the invoked child. Effects with a durable recorded `YieldEvent` MUST NOT be re-dispatched to their agents on replay.

### 8.6 Divergence

Divergence conditions defined by kernel spec §10.4 (parent) and compound concurrency §10.4 (children) MUST apply to nested invocations without modification. This specification MUST NOT introduce a nested-invocation-specific divergence condition. Non-deterministic invoking middleware that produces a different `(fn, args, overlay)` tuple on replay manifests as ordinary child kernel divergence.

---

## 9. Durable-input treatment

9.1. `opts.overlay` MUST NOT be journaled as a standalone durable input or as a standalone event.

9.2. Replay equivalence of `opts.overlay` MUST be obtained via invoking-middleware determinism (§8.2). The invoking middleware is re-executed with the same inputs on replay and MUST produce the same overlay value.

9.3. Nested invocation MUST NOT introduce a new durable-input category. The set of durable inputs for a parent coroutine that performs nested invocations is the set of durable inputs already defined for that parent by the core execution model.

---

## 10. Error propagation

10.1. Normal child close MUST resolve the Operation returned by `ctx.invoke` with the child's terminal value. The invoking middleware observes this as the value returned from `yield* ctx.invoke(...)`.

10.2. Abnormal child close (error, cancelled, diverged, bug) MUST cause the Operation returned by `ctx.invoke` to throw an Effection-level exception carrying the reified close reason. The invoking middleware observes this as an exception thrown at the `yield* ctx.invoke(...)` await site.

10.3. Effect failures originating inside the invoked child MUST first pass through the child's own try/catch/finally stack before becoming the child's close reason. If not caught within the child, they become the child's abnormal close per §10.2.

10.4. If the invoking middleware does not catch the exception from §10.2, it MUST propagate through the middleware body per ordinary scoped-effects error flow. This specification MUST NOT introduce a special error-propagation path for nested invocation.

---

## 11. Cancellation

11.1. Cancellation delivered to the parent coroutine MUST propagate to any currently-active invoked child through the structured-cancellation mechanism defined by compound concurrency §4.3 (state machine) and operationally exemplified by spawn spec §6.6.

11.2. The invoked child MUST be permitted to run its teardown — including `finally` blocks and any structured cleanup — to completion before emitting its terminal `CloseEvent`, per compound concurrency §9.4.

11.3. A cancellation arriving while the invoked child is already in teardown MUST be absorbed per the idempotent-halt rule of compound concurrency §4.3.

11.4. Nested invocation MUST NOT provide detached-lifetime semantics. The child's lifetime is strictly bounded by the `yield* ctx.invoke(...)` await in the invoking middleware. For detached-lifetime execution, `spawn` at the workflow layer is the correct mechanism.

---

## 12. Ordering

12.1. All ordering invariants from compound concurrency §9 MUST apply to nested invocations, with the invoked child treated as an ordinary child of the parent.

12.2. The parent's outer `CloseEvent` MUST NOT be journaled before the invoked child's terminal `CloseEvent`. This follows from §9.3 of compound concurrency applied recursively.

12.3. Multiple sequential `ctx.invoke` calls within a single invoking middleware body MUST produce strictly serialized children: child *i*'s terminal `CloseEvent` MUST precede child *i+1*'s first journaled event. Serialization follows from the middleware awaiting each Operation before initiating the next.

12.4. Concurrent `ctx.invoke` composition from a single invoking middleware body is out of scope for MVP per §15 and MUST NOT be relied upon.

---

## 13. Conformance hooks

An implementation is conformant with this specification if and only if it satisfies each of the following for every program exercising `ctx.invoke`:

- **H1.** The journal satisfies compound concurrency §9 ordering rules with invoked children treated as ordinary children of the parent.
- **H2.** Child coroutineIds are produced by the unified `childSpawnCount` allocator of compound concurrency §4.2 and use the `parentId.{k}` format; no alternate separator, prefix, or namespace is used for nested invocation.
- **H3.** Replay from the produced journal reaches the same terminal state with no divergence; per-coroutineId replay cursors operate independently; effects with durable recorded yields are not re-dispatched to agents on replay.
- **H4.** Abnormal child close produces an Effection-level exception thrown at the invoking middleware's `yield* ctx.invoke(...)` await site, carrying the reified close reason.
- **H5.** Parent cancellation during an active invoked child results in child teardown and propagated close reason.
- **H6.** Invoking middleware containing `ctx.invoke` calls re-executes on replay with no observable difference (direct application of scoped-effects MR-002, Core tier).
- **H7.** A `ctx.invoke` call writes no event under the parent coroutineId on its own account; only the child's own journal entries under its coroutineId are produced.

---

## 14. Forward-compatibility note (non-normative)

**This section is non-normative.** It introduces no new requirements. It names three invariants that are already normatively required by this specification (§6.1, §7.5–§7.6, §8) and records that those invariants preserve compatibility with a possible future subordinate remote executor specification. This section MUST NOT be read as a partial specification of remote execution.

The invariants below are restatements, not additions. Each is cross-referenced to the normative section of this specification that already requires it:

- **N-RA1.** Parent runtime is the sole authority for child coroutineId allocation. Restates §6.1.
- **N-RA2.** Parent runtime is the sole authority for journal writes and journal ordering. Restates §7.5 and §7.6.
- **N-RA3.** Parent runtime is the sole authority for replay decisions. Restates §8.

Explicitly out of scope for this specification — to be addressed, if at all, by a separate subordinate remote executor specification:

- Wire protocol for child-drive dispatch to a remote substrate.
- Network failure semantics.
- Remote event transport format.
- Partition, retry, and reconnection behavior; at-least-once versus exactly-once delivery guarantees.

---

## 15. Explicit non-goals and deferred items

The following are explicitly out of scope for this specification version and MUST NOT be relied upon:

- Concurrent `ctx.invoke` composition within a single invoking middleware body.
- Per-invocation narrower timebox applied to the invoked child.
- Per-invocation agent rebinding applied to the invoked child.
- Detached-lifetime nested invocation. For detached-lifetime execution, use `spawn` at the workflow layer.
- Any kernel-visible descriptor form of nested invocation.
- Any namespaced or `.n`-prefixed child-ID format for nested invocation.
- Any non-public spelling of the API other than the normative public name `invoke`.
- Subordinate remote execution as a feature. §14 records only compatibility anchors.

---

## 16. Synchronized cross-spec amendments

This specification is accompanied by two narrow amendments to existing specs. These amendments are the source of truth for the shared surface.

### 16.1 `tisyn-scoped-effects-specification.md` — §3 (Dispatch Boundary)

Add one paragraph:

> The runtime MAY expose an `invoke` operation on the dispatch-boundary context accessible to middleware. The operation is a runtime-controlled dispatch-boundary `Operation<T>` — it is initiated and resolved outside kernel IR evaluation — and it is not a compound external and does not produce a kernel descriptor. Semantics are defined by `tisyn-nested-invocation-specification.md`. Invoking middleware remains subject to the determinism expectation of §9; the replay property stated in MR-002 extends to middleware that calls `ctx.invoke` without modification.

### 16.2 `tisyn-compound-concurrency-specification.md` — §4.2 (Child Task IDs)

Add one paragraph:

> The unified `childSpawnCount` is also advanced by nested invocation (`ctx.invoke`, per `tisyn-nested-invocation-specification.md`). Each `ctx.invoke` call advances the counter by exactly `+1` and allocates a child coroutineId of the form `parentId.{k}` using the standard format. Invariant I-ID applies uniformly across all allocation origins.

No other spec files are amended by this specification.
