# Tisyn Inline Invocation Specification

**Status.** Normative. MVP.
**Depends on.**
  - `tisyn-kernel-specification.md` (evaluation model; no amendment).
  - `tisyn-scoped-effects-specification.md` (§3 Dispatch Boundary; §5 overlays; §9 durability/replay; companion test MR-002, Core tier).
  - `tisyn-compound-concurrency-specification.md` (§4.2 unified allocator; §10 replay cursors; §9 ordering). Referenced for non-participation.
**Complements.** `tisyn-nested-invocation-specification.md` (sibling primitive; strict non-overlap).
**Depended on by.** None in MVP.
**Exports (terminology).** *inline invocation*, *inline caller*, *inline body*.

---

## Placement rationale

This is a standalone spec, not an amendment to nested invocation. `invoke` and `invokeInline` are genuine peers: one primitive per semantic region (isolated vs. shared-lifetime), sharing the `DispatchContext` seam, the call-site class, the export package, and the error family, but non-overlapping on identity, allocator participation, journal contribution, scope boundary, and error shape. Folding inline invocation into nested invocation would force conditional wording across §§5–13 of that spec; keeping them as peers with explicit `Complements` edges preserves coherent conformance surfaces in both documents. Only two narrow cross-references are added to existing specs (§16).

---

## 1. Overview

Inline invocation is a runtime-controlled mechanism by which dispatch-boundary middleware MAY evaluate a compiled `Fn` *in the current coroutine, inside the current Effection scope*, without allocating a new child coroutineId, without opening a new scope boundary, without advancing any allocator, and without introducing any new durable event. Effects yielded inside the inline body are journaled in the caller's stream under the caller's coroutineId, continuing the caller's yieldIndex sequence.

Inline invocation is initiated from host-side JavaScript middleware through the public API `invokeInline(fn, args, opts?)`, exposed as a free helper from the same (non-normative) package as `invoke`. It is not a kernel descriptor, not a compound external, and not a new durable event kind. The durable event algebra `YieldEvent | CloseEvent` is unmodified. The kernel is unmodified. The compiler is unmodified.

Inline invocation and nested invocation are **distinct primitives with non-overlapping semantics**. `invoke` (nested-invocation spec) is the correct primitive for isolated nested execution. `invokeInline` (this spec) is the correct primitive for shared-lifetime inline execution. Neither primitive is a mode of the other.

---

## 2. Normative scope

This specification defines:

- The public API `invokeInline(fn, args, opts?)` — a free helper of the reference implementation; the export package is non-normative — and its call-site preconditions.
- Core invariants governing coroutine identity, allocator non-participation, scope boundary, journal equivalence, replay, error propagation, cancellation, middleware visibility, and ordering.
- Explicit non-participation in the unified child allocator and explicit non-creation of a scope boundary.
- The durable-input treatment of inline-invocation inputs (null).
- Conformance hooks.

This specification does not define:

- Any kernel descriptor, classification change, or SUSPEND/resume contract change.
- Any compiler-visible form of inline invocation. `invokeInline` has no IR form. No authored surface.
- Any new durable event kind.
- Any new child-ID counter or namespace.
- The behavior of concurrent `invokeInline` composition from a single invoking middleware body (§15).
- Any cross-boundary or remote evaluation semantics.
- Any step/round orchestration layer or default for step bodies.

---

## 3. Relationship to existing specs

**Kernel specification.** Unmodified. `invokeInline` does not produce a kernel descriptor, does not invoke SUSPEND from authored IR, is not classified, and does not execute inside kernel IR evaluation as a compound-external. The runtime uses the existing kernel `evaluate` path to construct the inline body's generator; the mechanism by which that generator's yields reach the dispatch loop is an implementation detail constrained only by the invariants of §6.

**Scoped-effects specification.** The replay property on which this specification relies is §9 ("Durability and Replay"), enforced by the Core-tier companion test MR-002. This specification does not alter any scoped-effects semantics. One synchronized cross-reference paragraph is added under scoped-effects §3 (Dispatch Boundary) to name `invokeInline` and point to this specification (see §16.1).

**Compound concurrency specification.** The unified child allocator (§4.2) MUST NOT be advanced by inline invocation itself. The per-coroutineId replay cursor model (§10) is reused: the caller's cursor is the only one that applies. Ordering invariants (§9) continue to apply to the caller. This specification does not alter any compound-concurrency semantics and does not add any paragraph to that specification — non-participation is a negative property, stated normatively here.

**Nested invocation specification.** Unmodified. One synchronized cross-reference paragraph is added under nested-invocation spec §15 (Explicit non-goals and deferred items) stating that shared-lifetime inline execution is provided by `invokeInline` (see §16.2). Inline invocation is a sibling primitive, not an option on `invoke`. The call-site gating of §5.3 of the nested-invocation spec is reused by reference for `invokeInline`'s own call-site preconditions (§5.3 below), and the `InvalidInvokeCallSiteError` / `InvalidInvokeInputError` classes defined there are the recommended classes for `invokeInline` failures (§5.3.4 below).

**Spawn, resource, timebox specifications.** Unmodified. `spawn`, `resource`, and `timebox` descriptors yielded from inside an inline body are identical to those yielded from the caller's own body. Their specs handle this case without change. Their allocator-advancement attributions apply to them, not to `invokeInline` (§6.3.2).

**Stream iteration specification.** Unmodified. Subscription handles acquired inside an inline body are owned by the caller's coroutineId (because no new coroutineId exists). Capability-value rules apply unchanged.

**Compiler specification.** Unmodified. `invokeInline` has no authored surface and no IR form. This specification MUST NOT introduce any compiler amendment.

**Blocking-scope, system specifications.** Unmodified.

---

## 4. Terminology

**Inline invocation.** The act of evaluating a compiled `Fn` body in the caller's coroutine and scope by calling `invokeInline(fn, args, opts?)` from dispatch-boundary code.

**Inline caller.** The coroutine whose `DispatchContext` is active at the moment of the `invokeInline` call. Also the coroutine in whose scope and journal the inline body runs.

**Inline body.** The compiled `Fn` body evaluated by inline invocation, constructed from `fn.body` with `fn.params` bound to `args`.

**Dispatch boundary.** As defined by scoped-effects §3.

**Unified child allocator.** The `childSpawnCount` counter defined by compound concurrency §4.2. Inline invocation MUST NOT advance this counter on its own account.

---

## 5. API

### 5.1 Signature

The runtime MUST expose `invokeInline` as a free helper with the following signature:

```
invokeInline<T>(
  fn: Fn<T>,
  args: ReadonlyArray<Val>,
  opts?: { overlay?: ScopedEffectOverlay; label?: string }
): Operation<T>
```

The identity of the package that exports `invokeInline` is non-normative. The same package SHOULD export both `invoke` and `invokeInline`.

`invokeInline` is a free function, not a method on any context value. Internally it reads the active runtime-scoped `DispatchContext` (scoped-effects §3). The `DispatchContext` is the same ambient seam used by `invoke` (nested-invocation spec §5.1); this specification MUST NOT introduce a separate ambient context.

### 5.2 Naming

The public name of this operation MUST be `invokeInline`. Its export package is non-normative. The spec term for the semantic concept MUST be *inline invocation*. Implementations MAY use additional internal helper names; such names are not part of the normative surface.

### 5.3 Call-site preconditions

5.3.1. `invokeInline` MUST be called only from within the dynamic extent of an active `Effects.around({ dispatch })` middleware body registered against the runtime's dispatch chain. Calls from any other site — including `Effects.around({ resolve })` bodies, agent operation handlers, agent-facade `.around(...)` per-operation middleware, IR-evaluated middleware, compiler-authored middleware, and code outside any middleware — MUST produce a runtime error and MUST NOT evaluate the inline body, MUST NOT push any overlay, and MUST NOT write any journal entry, and MUST NOT advance the unified child allocator.

5.3.2. Isolation: the runtime MUST ensure that code paths not on the dispatch boundary do not observe a non-`undefined` `DispatchContext`. This is the same isolation requirement as nested-invocation spec §5.3.2; no separate enforcement mechanism is required.

5.3.3. Stale-context detection: if the active `DispatchContext` at the moment of the `invokeInline` call is not the same object that was installed for the currently-active dispatch chain, `invokeInline` MUST throw the call-site error described in §5.3.4.

5.3.4. Error classes. A call from a disallowed site MUST raise a call-site error that (a) identifies the failure as a dispatch-boundary call-site violation; (b) produces no change to the allocator, no journal entry, no overlay push, and no evaluation of `fn.body`; and (c) surfaces the primitive name that was invoked (e.g., via message content or an inspectable property) so that callers can distinguish `invoke` and `invokeInline` failures when needed. A call with invalid `fn`, `args`, or `opts` MUST raise an input-validity error with the same zero-side-effect guarantee. Implementations SHOULD reuse the `InvalidInvokeCallSiteError` and `InvalidInvokeInputError` classes defined by the nested-invocation specification for this purpose. An implementation MAY introduce distinct classes for diagnostic or type-system reasons, provided the semantic requirements above are met.

### 5.4 Suspension model

5.4.1. `invokeInline` returns an Effection `Operation<T>`. The invoking middleware MUST compose it using ordinary generator delegation (`yield* invokeInline(...)`).

5.4.2. The suspension produced by `yield* invokeInline(...)` is an Effection suspension on the runtime-controlled dispatch boundary. It MUST NOT be a kernel SUSPEND from authored IR and MUST NOT occur inside kernel IR evaluation.

### 5.5 Input validity

5.5.1. `fn` MUST be a compiled `Fn` value.

5.5.2. `args` MUST be a sequence of serializable values in the Tisyn `Val` domain.

5.5.3. `opts.overlay`, if present, MUST be a valid scoped-effect frame per scoped-effects §5.

5.5.4. `opts.label`, if present, is diagnostic and MUST NOT be journaled.

---

## 6. Core invariants

The primitive `invokeInline(fn, args, opts?)`, when called from a permitted call site with valid inputs, MUST satisfy the following invariants. Each invariant is a property of observable behavior. Mechanism is intentionally unspecified.

### 6.1 Observational-equivalence rule (the anchor)

**The inline-body equivalence rule.** A successful call `yield* invokeInline(fn, args, opts?)` MUST be observationally equivalent, for all workflow-visible semantics, to evaluating the body of `fn` with `fn.params` bound to `args` directly at the caller's program point, with the scoped-effect overlay (§6.7) in effect for the duration of the evaluation.

"Workflow-visible semantics" here means coroutine identity (§6.2), yield stream contents and ordering (§6.5, §6.10), replay and divergence (§6.6), scope boundary and lifetime region (§6.4), middleware visibility (§6.9), and error propagation (§6.8). The equivalence does **not** extend to host-local diagnostics or optional implementation tracing metadata — for example, a runtime MAY produce a debugger-visible stack-frame label for `invokeInline`, attach a diagnostic `label` from `opts`, or emit host-side tracing spans, provided none of those appear in the durable stream and none affect the properties listed above.

### 6.2 Coroutine identity

The effective coroutineId during inline-body evaluation MUST be the inline caller's coroutineId. No new coroutineId MUST be allocated, observed, or reported on account of `invokeInline`.

### 6.3 Allocator non-participation and attribution

- **§6.3.1 Non-participation.** The unified child allocator of compound-concurrency §4.2 MUST NOT be advanced on account of `invokeInline` itself. The per-origin advancement amounts enumerated in nested-invocation §6.3 are not extended by this specification.
- **§6.3.2 Attribution.** Allocator advancement caused by operations performed *inside* the inline body — `scoped`, `spawn`, `resource`, `timebox`, `all`, `race`, nested `invoke` — is attributed to those operations under their own specifications, exactly as it would be if they appeared at the caller's program point. `invokeInline` contributes zero advancement; the operations it contains contribute what they would have contributed anyway.

### 6.4 Scope boundary (direct statement)

**`invokeInline` MUST NOT introduce a new scope boundary.** The inline body MUST execute within the inline caller's existing scope boundary.

Consequences (stated here for conformance testing):

- **§6.4.1** Resources acquired inside the inline body MUST remain live after `invokeInline` returns, up to the caller's own scope teardown.
- **§6.4.2** Spawned children created inside the inline body MUST attach to the caller's scope boundary, subject to structured-concurrency rules that already apply to spawns originating in the caller's own body.
- **§6.4.3** Capability values (e.g., stream-subscription handles) acquired inside the inline body MUST be owned by the caller's coroutineId for the purposes of ancestry checks defined by other specs.
- **§6.4.4** Cancellation delivered to the caller MUST propagate to an in-flight inline body through the caller's existing cancellation mechanism; no separate cancellation pathway exists. Observability of inline-body cancellation is exactly that of caller-owned work.

### 6.5 Journal equivalence

Effects yielded inside the inline body MUST be journaled as if yielded directly by the caller:

- **§6.5.1** Each such effect MUST produce exactly one `YieldEvent` under the caller's coroutineId.
- **§6.5.2** The `yieldIndex` sequence of those events MUST be monotonic and contiguous with events produced directly by the caller's body, in program order.
- **§6.5.3** No `YieldEvent` or `CloseEvent` MUST be written on account of the `invokeInline` call itself. No marker event of any kind MUST be introduced.
- **§6.5.4** The durable event algebra `YieldEvent | CloseEvent` is unmodified by this specification.

### 6.6 Replay and divergence equivalence

- **§6.6.1** On replay, the caller's kernel re-evaluates the caller's IR per kernel spec §10.5. Effects contributed by the inline body are replayed from the caller's journal under the caller's coroutineId, indistinguishably from effects produced directly by the caller.
- **§6.6.2** The Durable Yield Rule (compound-concurrency §10.6.2) MUST apply to inline-body yields treated as ordinary caller yields.
- **§6.6.3** Divergence conditions (kernel spec §10.4) MUST apply to the caller's coroutine without modification. A non-deterministic invoking middleware that reaches a different `(fn, args, overlay)` on replay, or whose inline body yields a different effect sequence, manifests as ordinary caller-coroutine divergence. No inline-specific divergence condition MUST be introduced.
- **§6.6.4** Replay equivalence of `(fn, args, opts.overlay)` MUST be obtained via invoking-middleware determinism (scoped-effects §9 / companion test MR-002, Core tier). No new durable-input category MUST be introduced.

### 6.7 Overlay semantics

If `opts.overlay` is present, the scoped-effect frame it describes MUST be in effect for the entire duration of inline-body evaluation and MUST NOT be observable outside it. The overlay MUST NOT be journaled as a standalone durable input or as a standalone event.

### 6.8 Error propagation equivalence

An uncaught error raised inside the inline body MUST propagate from the `yield* invokeInline(...)` site as if thrown at the caller's program point:

- **§6.8.1** The propagated exception MUST be the original error value, not a reified close reason. (This is the deliberate difference from `invoke`, whose abnormal-close wrapping exists because `invoke` crosses a coroutine boundary.)
- **§6.8.2** Errors caught by `try/catch/finally` inside the inline body MUST NOT propagate out of `invokeInline`.
- **§6.8.3** If the invoking middleware does not catch the propagated error, it MUST flow through ordinary scoped-effects error flow. This specification MUST NOT introduce a special error-propagation path for inline invocation.

### 6.9 Middleware visibility

Effects yielded inside the inline body MUST traverse the caller's scoped-effects middleware chain and MUST see the caller's transport bindings and agent facade resolutions, with no separate binding or routing rule introduced by this specification.

### 6.10 Ordering

- **§6.10.1** Program-order preservation: within the caller's journal, a yield produced before the `invokeInline` call, a yield produced inside the inline body, and a yield produced after the call MUST appear in that program order.
- **§6.10.2** Multiple sequential `invokeInline` calls within a single invoking middleware body MUST produce strictly serialized inline bodies.
- **§6.10.3** Concurrent `invokeInline` composition within a single invoking middleware body is out of scope for MVP (§15) and MUST NOT be relied upon.
- **§6.10.4** Composition with `invoke`: each `invoke` call continues to advance the allocator per nested-invocation §6.2; each `invokeInline` call contributes zero. The interleaved sequence MUST be deterministic by scoped-effects §9.

---

## 7. Forbidden behaviors (summary)

Stated explicitly for implementors:

- Allocating a new coroutineId on account of `invokeInline`.
- Opening a new structured-concurrency scope on the call's account.
- Writing any `YieldEvent` or `CloseEvent` attributable to the call itself.
- Introducing any new durable event discriminant.
- Wrapping inline-body errors as reified close reasons.
- Leaking `opts.overlay` beyond the call's dynamic extent.
- Journaling `opts.overlay`, `fn`, `args`, or `opts.label` as standalone durable inputs or events.
- Introducing any replay-phase mechanism specific to `invokeInline`.
- Modifying any observable behavior of `invoke`.

---

## 8. Conformance hooks

An implementation is conformant with this specification if and only if it satisfies each of the following for every program exercising `invokeInline`. All hooks are phrased as properties of observable behavior.

- **IH1. Coroutine identity.** During inline-body evaluation, the effective coroutineId observable to the body equals the caller's coroutineId. No new coroutineId appears in the journal on account of `invokeInline`.
- **IH2. Allocator non-participation.** A snapshot of the caller's unified child allocator immediately before and immediately after an `invokeInline` call, taken with no intervening operation that would independently advance the allocator, yields equal values.
- **IH3. No durable boundary of its own.** No `YieldEvent` and no `CloseEvent` is written on account of the `invokeInline` call itself. The durable event algebra is unchanged.
- **IH4. Journal-stream extension.** Effects yielded inside the inline body appear as ordinary `YieldEvent`s under the caller's coroutineId, with `yieldIndex` values contiguous with the caller's own yields in program order (§6.10.1).
- **IH5. Caller-owned lifetime.** Resources, spawned children, and capability values created inside the inline body remain live and usable after `invokeInline` returns, up to the caller's own scope teardown, with lifetimes governed by the caller's scope rather than a boundary introduced by `invokeInline`.
- **IH6. Replay equivalence.** Replay of a journal produced with `invokeInline` reaches the same terminal state with no divergence. The Durable Yield Rule applies to inline-body yields treated as caller yields. No replay-phase mechanism specific to `invokeInline` is introduced.
- **IH7. Cancellation pass-through.** Cancellation of the caller during an in-flight inline body is observed by the body through the caller's cancellation mechanism; the caller's terminal state and teardown order are unchanged by the presence of the call.
- **IH8. Error pass-through.** An uncaught error raised inside the inline body is observable at the `yield* invokeInline(...)` site as the original error value, not as a reified close reason. Errors caught inside the body do not surface at the call site.
- **IH9. Invalid call sites have no effect.** A call from a disallowed site (§5.3) raises the call-site error (§5.3.4) and produces no change to the allocator, no journal entry, no overlay push, and no evaluation of `fn.body`.
- **IH10. Composition integrity.** Mixing `invoke` and `invokeInline` in a single invoking middleware body leaves each primitive's own invariants intact: `invoke` continues to allocate per nested-invocation §6.2; `invokeInline` continues to satisfy IH1–IH9; their journal contributions compose in program order (§6.10.1).

---

## 9. Forward-compatibility note (non-normative)

Inline invocation is the natural primitive beneath a future step/round orchestration layer. A future step/round spec MAY define policies for when step bodies default to inline invocation versus nested invocation. Such a layer is out of scope for this specification and is not assumed by any normative clause above. No invariants in this specification are qualified by future step/round orchestration.

---

## 10. Non-blocking clarifications

The following small clarifications are tracked but are explicitly non-blocking for implementation. They affect test-plan tier placement only and do not change any invariant.

- **G1. Restricted-capability return across the boundary.** Whether spawn task handles, stream subscription handles, and resource handles may be *returned* from an inline body to the caller. §6.4.3 establishes caller ownership for ancestry purposes but does not explicitly grant a return permission. Core test coverage proves caller-owned lifetime without requiring return; Extended tests exercise return patterns. A future one-sentence clarification to §6.4 cross-referencing spawn §A.2 and stream §6.3 under the "inline caller owns" framing would permit those Extended tests to move to Core.
- **G2. Primitive-name distinguishability.** §5.3.4 says the error surfaces the primitive name "via message content or an inspectable property." A future clarification to require an inspectable property (e.g., `err.primitive`) would tighten test IE-V-006 from generic distinguishability to property assertion.
- **G3. Inline-body cancellation observability.** §6.4.4 states observability inherits from caller-owned work. A future one-sentence clarification making the observability class explicit would tighten IE-L-005's assertion.

None blocks acceptance, implementation, or MVP conformance.

---

## 11. Non-goals and deferred items

The following are explicitly out of scope for this specification version and MUST NOT be relied upon:

- Concurrent `invokeInline` composition within a single invoking middleware body.
- Any compiler surface, authored syntax, or IR form for inline invocation.
- Per-call narrower timebox applied to the inline body (use ordinary `timebox` in the caller).
- Per-call agent rebinding applied to the inline body (use scope configuration in the caller).
- Cross-boundary or remote inline invocation.
- Any default step-body policy.
- `invokeInline` from any site other than an `Effects.around({ dispatch })` body.

---

## 16. Synchronized cross-spec amendments

This specification is accompanied by two narrow amendments to existing specs.

### 16.1 `tisyn-scoped-effects-specification.md` — §3 (Dispatch Boundary)

Add one paragraph (sibling to the `invoke` paragraph added by nested-invocation §16.1):

> The runtime MAY additionally expose an `invokeInline(fn, args, opts?)` free helper (exported by an implementation-chosen package; the export path is not part of the normative surface) accessible from the body of an `Effects.around({ dispatch })` middleware. The operation is a runtime-controlled dispatch-boundary `Operation<T>` — it is initiated and resolved outside kernel IR evaluation — and it is not a compound external, does not produce a kernel descriptor, does not allocate any coroutineId, and introduces no durable event. Effects yielded inside the inline body are journaled under the caller's coroutineId. Semantics are defined by `tisyn-inline-invocation-specification.md`. Invoking middleware remains subject to the determinism expectation of §9; the replay property stated in MR-002 extends to middleware that calls `invokeInline` without modification.

### 16.2 `tisyn-nested-invocation-specification.md` — §15 (Explicit non-goals and deferred items)

Append one bullet:

> Shared-lifetime inline execution of a compiled `Fn` in the caller's coroutine and scope is not in scope for this specification and MUST NOT be achieved by modifying `invoke` semantics. It is provided by a distinct runtime primitive `invokeInline`, defined by `tisyn-inline-invocation-specification.md`. `invokeInline` is not a mode or option of `invoke`; the two primitives have non-overlapping semantics on identity, allocator participation, journal contribution, and scope boundary. The `InvalidInvokeCallSiteError` and `InvalidInvokeInputError` classes defined by §5.3 of this specification are the recommended error classes for `invokeInline` failures of the same category.

No other spec files are amended.
