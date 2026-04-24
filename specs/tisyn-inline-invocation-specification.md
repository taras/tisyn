# Tisyn Inline Invocation Specification

**Status.** Normative. Draft.
**Depends on.**
  - `tisyn-kernel-specification.md` (evaluation model; no amendment).
  - `tisyn-scoped-effects-specification.md` (§3 Dispatch Boundary; §5.2 max/min priority; §9.5 structural replay substitution; companion test MR-002, Core tier).
  - `tisyn-compound-concurrency-specification.md` (§4.2 unified allocator; §9 ordering; §10 replay cursors; synchronized amendment at §17.4).
  - `tisyn-nested-invocation-specification.md` (sibling primitive; strict non-overlap).
  - `tisyn-stream-iteration-specification.md` (capability-ancestry and subscription-counter rules; synchronized amendment at §17.3).
**Complements.** `tisyn-nested-invocation-specification.md`.
**Depended on by.** None in MVP.
**Exports (terminology).** *inline invocation*, *inline caller*, *inline body*, *inline lane*, *nested inline invocation*, *journal coroutineId*, *owner coroutineId*.

---

## 1. Overview

**Inline invocation** is a runtime-controlled mechanism by which dispatch-boundary middleware MAY evaluate a compiled `Fn` under the caller's lifetime region — sharing the caller's Effection scope — while journaling the inline body's effects under a distinct **inline lane** in the durable stream.

Inline invocation exists to support shared-lifetime step execution: multi-step rounds where step 1 lazily creates resources that step 2 must reuse.

**Nested inline invocation is in scope for MVP.** When middleware handling an effect dispatched during an outer inline body's evaluation calls `invokeInline`, the call is valid (§7.6). This follows directly from the call-site rule.

Inline invocation and nested invocation are **distinct primitives**. `invoke` for isolated execution; `invokeInline` for shared-lifetime execution. Neither is a mode of the other.

---

## 2. Primary Invariant: Distinct Durable Identity, Shared Lifetime

Inline invocation separates two concerns that nested invocation bundles:

- **Durable replay identity.** Effects journal under the inline lane's coroutineId. Replay cursor keyed to the lane. This is the **journal coroutineId**.

- **Lifetime and ownership.** No new scope. Capability handles use the original caller's coroutineId for ownership and counter allocation. This is the **owner coroutineId**.

Under `invoke`, both roles are the same value. Under `invokeInline`, they diverge. This dual-identity model is the defining invariant.

This separation applies to the **inline body itself**. Child-bearing primitives retain their own semantics (§11).

---

## 3. Normative scope

Defines: API and call-site preconditions; inline lane; dual-identity model; capability ownership and counter allocation (§12); call-site model and nested inline (§6, §7.6); lifetime model (§11); ordering, replay, error, cancellation; composition with §9.5.

Does not define: kernel/compiler changes; new event kinds; concurrent `invokeInline` (§16); step orchestration.

---

## 4. Relationship to existing specs

**Kernel, compiler, blocking-scope, spawn, resource, timebox specifications.** Unmodified.

**Scoped-effects specification.** §9.5 three-lane replay applies. Cross-reference at §17.1.

**Compound concurrency specification.** The unified child allocator (§4.2) is advanced by `+1` per accepted `invokeInline` call (§7.2). The allocated ID uses the standard `parentId.{k}` format and names an inline lane — not a child scope. Invariant I-ID applies. **Synchronized amendment at §17.4.**

**Nested invocation specification.** Unmodified. `invoke` during inline-body evaluation retains full semantics (§11.3). Cross-reference at §17.2.

**Stream iteration specification.** When capabilities are acquired during inline-body evaluation, the subscription counter is driven by the owner coroutineId. **Synchronized amendment at §17.3.**

---

## 5. Terminology

**Inline invocation.** Evaluation of a compiled `Fn` body under the caller's lifetime region via `invokeInline(fn, args, opts?)` from dispatch-boundary code.

**Inline caller.** The coroutine whose `DispatchContext` is active at the moment of the call.

**Inline body.** The compiled `Fn` body. IR, kernel-evaluated. Can yield effect descriptors; cannot call host-side JavaScript.

**Inline lane.** The coroutineId under which effects dispatched during inline-body evaluation are journaled. Durable replay identity only; does not create a scope boundary; does not produce a `CloseEvent`.

**Journal coroutineId.** The lane ID. For: `YieldEvent` writes, replay cursor, divergence.

**Owner coroutineId.** The original caller's coroutineId. For: capability ownership, ancestry checks, capability counter allocation (§12).

**Nested inline invocation.** `invokeInline` from middleware handling an outer inline body's dispatched effect (§7.6). In MVP.

---

## 6. API

### 6.1 Signature

```
invokeInline<T>(
  fn: Fn<T>,
  args: ReadonlyArray<Val>,
  opts?: { overlay?: ScopedEffectOverlay; label?: string }
): Operation<T>
```

Export package non-normative. Reads `DispatchContext`; MUST NOT introduce a separate context.

### 6.2 Call-site preconditions

6.2.1. **Host-dispatch-middleware-only** at every nesting level. Zero side effects on rejection.

6.2.2. **Compiled `Fn` body cannot call directly.** Structurally impossible; if reached, rejected.

6.2.3. Stale-context detection per `invoke` rules.

6.2.4. SHOULD reuse `InvalidInvokeCallSiteError` / `InvalidInvokeInputError`. MUST surface primitive name.

### 6.3 Input validity

`fn` MUST be `Fn`. `args` MUST be `Val[]`. `opts.overlay` per scoped-effects §5. `opts.label` diagnostic only.

### 6.4 Suspension

Returns `Operation<T>` via `yield*`. Effection suspension; not kernel SUSPEND.

---

## 7. Inline Lane Identity and Allocator

### 7.1 Why a distinct lane

Dispatch middleware runs before the triggering `YieldEvent`. Inline-body effects MUST journal under a distinct coroutineId.

### 7.2 Allocator advancement

`invokeInline` MUST advance the caller's unified child allocator (`childSpawnCount` per compound concurrency §4.2) by exactly `+1` at the moment of the call, atomically, before evaluating the inline body. The resulting value `k` determines the inline lane ID. A rejected `invokeInline` call (per §6.2) MUST NOT advance the allocator.

The allocated ID uses the `parentId.{k}` format and names an **inline lane** — a durable replay identity that does not create a scope boundary and does not produce a `CloseEvent`. This is a new allocation origin alongside `invoke`, `spawn`, `resource`, `scope`, `timebox`, `all`, and `race`. See §17.4 for the compound-concurrency synchronized amendment.

### 7.3 Lane's own child allocator

Own `childSpawnCount` starting at 0. Advanced by compound-external IR descriptors and by host-side `invoke`/`invokeInline` from middleware handling the body's dispatched effects.

### 7.4 ID format

`parentId.{k}` per compound concurrency §4.2. **Deterministic identification only; does not imply child-scope semantics.**

### 7.5 Distinguishing inline lanes

Absence of `CloseEvent` is a defining durable property. Runtime distinguishes from interrupted children via re-entry context.

### 7.6 Nested inline invocation

**In MVP.** Occurs when middleware handling an effect dispatched during an outer inline body's evaluation calls `invokeInline`.

Mechanism: outer middleware A calls `invokeInline(outerFn)` → outer body dispatches E → middleware B handles E → B calls `invokeInline(innerFn)`. Valid because B is dispatch middleware.

Properties: call-site rule unchanged; lane subtree (`caller.{k}.{m}`); no `CloseEvent` at any level; independent replay cursors; owner coroutineId inherited unchanged (§12.3). Lifetime at nested levels per §11.

### 7.7 Determinism

Lane IDs byte-identical across runs. I-ID of compound concurrency §4.2 applies uniformly across all allocation origins, including inline invocation.

---

## 8. Journal Model

### 8.1 Effects under the lane

`YieldEvent`s with `coroutineId = laneId`. Own yieldIndex.

### 8.2 Triggering dispatch

Written under caller's coroutineId after middleware returns. Records outer dispatch result; not the ordering anchor for inline-body events.

### 8.3 Durable algebra

`YieldEvent | CloseEvent` unmodified.

### 8.4 No CloseEvent

MUST NOT produce a `CloseEvent` for the inline lane, under any condition.

### 8.5 No event for `invokeInline` itself

### 8.6 Child-bearing primitives

Produce own events per their specs. "No CloseEvent" applies to **the lane itself**.

---

## 9. Replay Model

### 9.1 Replay

Lane ID reconstructed from allocator. Replay boundary substitutes via lane cursor.

### 9.2 Core property

**Journal coroutineId distinct from caller's. Cursors coexist without divergence.**

### 9.3 Max-region rerun

Per §9.5.4.

### 9.4 Crash recovery

Lane has `YieldEvent`s but no `CloseEvent` by design. Middleware re-executes, `invokeInline` called, stored events replay, body transitions to live.

### 9.5 Divergence

Per-coroutineId. No inline-specific condition.

### 9.6 Children and nested lanes

Replay per own specs / per-coroutineId.

---

## 10. Ordering

### 10.1 Per-coroutineId

Lane yieldIndex and caller yieldIndex independent.

### 10.2 Stream-append

Inline-body events before triggering dispatch event.

### 10.3 Sequential calls

Strictly serialized.

### 10.4 With `invoke`

Each `+1`. Invoke has CloseEvent; inline does not.

### 10.5 Compound concurrency §9

Caller's CloseEvent MUST NOT precede lane's last YieldEvent.

---

## 11. Lifetime and Scope

### 11.1 No new scope boundary

### 11.2 Shared caller lifetime

No intermediate scope. Children attach to caller's scope. Each primitive retains own semantics.

### 11.3 `invoke` during inline-body evaluation

Full nested-invocation semantics: own scope, own CloseEvent, child-owned resources, reified errors. Child ID `laneId.{m}`.

### 11.4 `resource`

Provide in caller scope. Cleanup at caller teardown.

### 11.5 `spawn`

Foreground child at caller scope. Produces CloseEvent.

### 11.6 `timebox`, `all`, `race`

Own compound-external semantics.

### 11.7 Summary

Only the **inline lane itself** has "no CloseEvent + shared lifetime." True at every nesting level.

### 11.8 Cross-inline-call resource continuity

Resources persist because they attach to the caller's scope.

---

## 12. Capability Ownership and Counter Allocation Under Inline Lanes

### 12.1 The dual-identity model

| Role | Value | Used for |
|---|---|---|
| **Journal coroutineId** | Inline lane ID | `YieldEvent` writes, replay cursor, divergence |
| **Owner coroutineId** | Original caller's coroutineId | Capability ancestry, ownership, **counter allocation** |

Under `invoke`, both are the same. Under `invokeInline`, they diverge.

### 12.2 Scope of the rule

Owner coroutineId drives **both ownership and counter allocation** for all coroutineId-keyed restricted capabilities acquired directly during inline-body evaluation. General default unless a capability family's own spec defines different semantics.

Does **not** apply to: ordinary values; children created by child-bearing primitives (own counter per their own spec); resource lifetime (§11.4).

### 12.3 Capture-and-propagate rule

1. If active context already carries owner coroutineId (nested inline), inherit unchanged.
2. If not (outermost), capture calling coroutine's own coroutineId.

**Captured once at the outermost `invokeInline`; propagated unchanged through all nested levels.**

### 12.4 Owner-based counter allocation

Counter for deterministic tokens MUST be the counter associated with the owner coroutineId. All inline lanes under the same owner share a single capability counter. Unique, non-colliding tokens across sibling and nested lanes.

Shared counter, but journal entries are not shared: each `stream.subscribe` YieldEvent is under the subscribing lane's journal coroutineId. The token inside the result is from the owner's counter.

### 12.5 Replay reconstruction

Lane cursors: per-coroutineId, independently. Owner counter: reconstructed by deterministic re-execution. Each replayed `stream.subscribe` advances the shared counter by the same amount. At the replay frontier, the counter is at the correct next value.

### 12.6 Owner coroutineId is runtime context, not durable data

Not written into `YieldEvent`s. Reconstructed by re-entry through the same `invokeInline` path. Shared capability counter also runtime state.

### 12.7 Ancestry checks

Handle owner = original caller. Using context owner = same caller (directly or via propagation). Check passes.

### 12.8 `invoke` children

Own coroutineId, own scope, own counter. §12.2 does not override.

---

## 13. Error Propagation

### 13.1 Direct propagation

Uncaught errors as original value, not reified.

### 13.2 No CloseEvent on error

### 13.3 Caught errors do not escape

### 13.4 Flow-through

### 13.5 Child errors per their own specs

---

## 14. Cancellation

### 14.1 Propagates via caller's mechanism

### 14.2 No detached lifetime

### 14.3 `finally` blocks as part of caller's teardown

---

## 15. Conformance Hooks

- **IH1.** Allocator `+1`. Lane ID `parentId.{k}`. Rejected calls do not advance.
- **IH2.** Distinct durable identity. `YieldEvent`s under lane. Cursor independent.
- **IH3.** No CloseEvent for the lane.
- **IH4.** No event for the call itself.
- **IH5.** Shared lifetime. No intermediate scope.
- **IH6.** Primitive-specific semantics preserved.
- **IH7.** Replay equivalence. Per-coroutineId cursors independent.
- **IH8.** Error pass-through.
- **IH9.** Invalid call sites zero-effect (including no allocator advancement).
- **IH10.** Composition integrity with `invoke`.
- **IH11.** Replay-dispatch composition via lane's journal coroutineId.
- **IH12.** Call-site rule uniform at every nesting level.
- **IH13.** Caller-owned capabilities. Owner coroutineId drives ownership AND counter allocation. Shared counter. Runtime context, not durable. Child-bearing primitives excluded.
- **IH14.** Nested inline in MVP. Lane subtree, independent cursors, no CloseEvent, owner inherited.

---

## 16. Non-goals and deferred items

- Concurrent `invokeInline` composition.
- Compiler/IR surface.
- Per-call timebox or agent rebinding.
- Cross-boundary/remote inline.
- Step orchestration layer.
- `invokeInline` from non-`Effects.around({ dispatch })` sites.
- Direct call from compiled `Fn` body.

---

## 17. Synchronized cross-spec amendments

### 17.1 `tisyn-scoped-effects-specification.md` — §3

> The runtime MAY expose `invokeInline(fn, args, opts?)` from `Effects.around({ dispatch })` middleware. Effects journal under a distinct inline lane coroutineId (journal identity); capability ownership and counter allocation use the original caller's coroutineId (owner identity). Owner coroutineId is runtime context, not durable data. The lane does not produce a `CloseEvent`. Child-bearing primitives retain own semantics. Participates in §9.5 replay. Nested inline permitted. Semantics: `tisyn-inline-invocation-specification.md`.

### 17.2 `tisyn-nested-invocation-specification.md` — §15

> Shared-lifetime inline execution is provided by `invokeInline` (`tisyn-inline-invocation-specification.md`). `invoke` from middleware handling inline-body dispatches retains full nested-invocation semantics.

### 17.3 `tisyn-stream-iteration-specification.md` — subscription counter

> When a `stream.subscribe` effect is dispatched during inline-body evaluation (as defined by `tisyn-inline-invocation-specification.md`), the subscription counter from which the deterministic token is allocated MUST be the counter associated with the owner coroutineId, not the journal coroutineId. The owner coroutineId is the original inline caller's coroutineId per inline-invocation §12.3. All inline lanes that share the same owner coroutineId share a single subscription counter, ensuring token uniqueness across sibling and nested inline invocations. The `YieldEvent` for the `stream.subscribe` effect is written under the journal coroutineId (the inline lane) per normal journaling rules; the token inside the event result is drawn from the owner's shared counter. On replay, the counter is reconstructed by deterministic re-execution of the same inline-invocation sequence. Capability ancestry checks use the owner coroutineId per inline-invocation §12.7.

### 17.4 `tisyn-compound-concurrency-specification.md` — §4.2 (Unified child allocator)

Add one paragraph parallel to the existing nested-invocation cross-reference:

> The unified `childSpawnCount` allocator is also advanced by inline invocation. Each accepted `invokeInline(fn, args, opts?)` call from a valid dispatch-boundary call site (per `tisyn-inline-invocation-specification.md` §6.2) MUST advance the parent's `childSpawnCount` by exactly `+1`. The allocated coroutineId uses the standard `parentId.{k}` format and names an **inline lane** — a durable replay identity for journaling the inline body's effects. Unlike coroutineIds allocated by `invoke`, `spawn`, `resource`, `scope`, `timebox`, `all`, or `race`, the inline lane's coroutineId does not create a new Effection scope boundary and does not produce a `CloseEvent`. A rejected `invokeInline` call (invalid call site, invalid input) MUST NOT advance the allocator. Invariant I-ID applies uniformly: for the same IR, inputs, and middleware code, inline lane IDs allocated by `invokeInline` MUST be byte-identical across original run and replay, interleaved deterministically with IDs allocated by all other allocation origins.

This amendment does not change the unified allocator's mechanics, counter format, or I-ID invariant. It adds `invokeInline` as a new allocation origin alongside the existing set, and documents that the allocated ID is an inline lane — not a child scope.

---

## 18. Contrast with `invoke`

| Property | `invoke` | `invokeInline` |
|---|---|---|
| Allocator | `+1` | `+1` |
| ID format | `parentId.{k}` | `parentId.{k}` |
| Journal coroutineId | = child ID | = lane ID |
| Owner coroutineId | = child ID (same) | = **original caller** |
| Capability counter | Child's own | **Owner's shared counter** |
| Scope | New | Caller's |
| CloseEvent | Yes | **No** |
| Resource lifetime | Child-owned | Caller-owned |
| Error shape | Reified | Original |
| Nested | N/A | In MVP; owner inherited |

---

## 19. Amended and unchanged sections inventory

| Spec | Status |
|---|---|
| `tisyn-kernel-specification.md` | Unchanged |
| `tisyn-compiler-specification.md` | Unchanged |
| `tisyn-system-specification.md` | Unchanged |
| `tisyn-compound-concurrency-specification.md` | **Amendment at §17.4** (inline invocation as allocation origin) |
| `tisyn-scoped-effects-specification.md` | **Cross-reference at §17.1** |
| `tisyn-nested-invocation-specification.md` | **Cross-reference at §17.2** |
| `tisyn-stream-iteration-specification.md` | **Amendment at §17.3** (counter-selection rule) |
| `tisyn-blocking-scope-specification.md` | Unchanged |
| `tisyn-spawn-specification.md` | Unchanged |
| `tisyn-resource-specification.md` | Unchanged |
| `tisyn-timebox-specification.md` | Unchanged |
| Durable event algebra | Unchanged |
