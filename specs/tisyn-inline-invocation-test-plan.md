# Tisyn Inline Invocation — Conformance Test Plan

**Tests:** `tisyn-inline-invocation-specification.md`
**Companion of.** `tisyn-inline-invocation-specification.md`
**Complements.** `tisyn-nested-invocation-test-plan.md`
**Depends on.** `tisyn-scoped-effects-specification.md` §9.5 (Replay Semantics and Middleware Contract); `tisyn-scoped-effects-test-plan.md` (MR-002 replay transparency); `tisyn-compound-concurrency-specification.md` (§4.2 allocator, §10 replay cursors, §9 ordering); `tisyn-spawn-test-plan.md`, `tisyn-resource-test-plan.md`, `tisyn-stream-iteration-test-plan.md` (interaction tests).

Test IDs use the prefix `IE-` (Inline invocation → Equivalence) to disambiguate against `IN-` / `MR-` / `SP-` / `RS-` / `TB-` / `SI-` from other plans.

Placement rationale: new companion file. The inline-invocation spec is a standalone peer of nested invocation (see spec §0 "Placement rationale"), and its test plan mirrors that placement. Amending the nested-invocation test plan would force conditional Core/Extended rows on every hook.

---

## 1. Overview

### 1.1 Scope

This test plan defines conformance criteria for `invokeInline` against spec §§5–8. It covers:

- identity and non-allocation (§6.2, §6.3; IH1, IH2)
- absence of an inline-owned durable boundary (§6.5; IH3, IH4)
- scope and lifetime equivalence (§6.4; IH5)
- replay and divergence equivalence (§6.6; IH6)
- error propagation and call-site / input validation (§5.3, §6.8; IH8, IH9)
- middleware and transport visibility, overlay scoping (§6.7, §6.9)
- regression protection for `invoke` and composition integrity (IH10)
- interaction with `spawn`, `resource`, `timebox`, and stream subscriptions (§6.4)

It does not cover:

- `invoke` semantics on their own terms (see nested-invocation test plan)
- kernel evaluation rules (see kernel test plan)
- compiler lowering (there is no authored surface)
- durable-stream persistence beyond observing event contents

### 1.2 Out of scope

- Concurrent `invokeInline` composition within a single invoking middleware body (spec §6.10.3, §11).
- Any authored-language form of inline invocation.
- Capability values *returned* across the inline boundary (spec §10/G1); Extended-only until that clarification lands.

### 1.3 Fixture conventions

- **Mock transport-bound agents.** Lifetime tests use a mock "Session" agent (`openSession` / `switchSession` / `closeSession`), a mock "Db" agent (`acquire` / `release`), and a mock stream source, consistent with existing harnesses.
- **Hand-constructed IR.** Inline bodies are constructed directly as `Fn(...)` values.
- **Journal inspection.** Journals are compared by canonical JSON equality under the existing conformance harness. Inline-body yields are inspected via their **lane cursor** (partition key = `${callerCoroutineId}@inline${q}.${j}`); the caller's own-body yields are inspected via the caller's coroutineId cursor. See §3.0 for the two-cursor convention.
- **Non-normative reference surfaces.** Where a test uses a reference-harness surface (ambient coroutine-id, allocator snapshot, scoped-effect stack depth, `DispatchContext` identity), the row says so explicitly and is tiered accordingly (Extended or Diagnostic).

---

## 2. Observability model

### 2.1 Tiers

- **Core — Normative.** Conformance-determining. A Core test MUST pass for the implementation to be conformant. Core tests rely only on Workflow-visible or Journal-visible evidence.
- **Extended — Normative.** SHOULD pass. Covers boundary cases, composition edges, and properties proven through Runtime-exposed or Harness-assisted evidence whose normative status is not yet standardized across the spec corpus. An Extended failure is a tracked conformance concern, not a disqualification.
- **Diagnostic — Non-normative.** Implementation-specific evidence. MUST NOT determine conformance. Uses Harness-introspective observables.

### 2.2 Observability classes

- **Workflow-visible.** Observable through values produced and consumed inside the authored workflow: effect return values, thrown exceptions, authored control flow, IR-level bindings, agent operations. If evidence flows through host-side state (middleware-local JS variables, closure captures, runtime-provided tool surfaces), the test is *not* Workflow-visible.
- **Journal-visible.** Observable by inspecting the durable `YieldEvent | CloseEvent` stream after the run, using only the coroutineId and yieldIndex structure.
- **Runtime-exposed — Extended-qualified.** Uses a surface provided by the reference runtime that is not yet a normative conformance API. Includes: ambient coroutine-id inspection (`CoroutineContext` in the reference `@tisyn/transport` package), unified allocator snapshot, scoped-effect frame stack depth, `DispatchContext` object identity. Extended tests only.
- **Harness-assisted — Extended-qualified.** Uses host-side JavaScript state inside the invoking middleware (middleware-local variables, closures) to bridge data between calls. Legitimate; labeled explicitly. Extended only; never the sole Core witness for any invariant.
- **Harness-introspective — Diagnostic only.** Uses implementation internals with no normative standing (scope sentinels, driver-entry counters, private context probes).

**Policy.** Core = Workflow-visible or Journal-visible. Runtime-exposed and Harness-assisted are Extended with an explicit note. Harness-introspective is Diagnostic.

---

## 3. Normative test cases

### 3.0 Two-cursor assertion convention

Under spec §6.5 / §6.5.5, inline-body yields are journaled on a **inline journal lane** — a replay-cursor partition key of the form `${callerCoroutineId}@inline${q}.${j}` — not under the caller's coroutineId. The caller's own-coroutineId cursor contains only the caller-body yields (including the triggering dispatch that invoked `invokeInline`).

Every test in §3 that asserts journal content uses the two-cursor model:

- `eventsFor(journal, callerCoroutineId)` reads the caller's own-body yields plus the triggering dispatches and caller `CloseEvent`.
- `eventsFor(journal, laneKey)` reads the inline body's yields for a specific inline invocation. The lane key is `${callerCoroutineId}@inline${q}.${j}` where `q` is the caller's yield ordinal at the triggering dispatch and `j` is the per-dispatch invokeInline counter (starts at 0 for the first invokeInline in a dispatch).
- No `CloseEvent` appears on any lane cursor.

Per spec §6.6.1: middleware re-executes on every run (scoped-effects §9.5). On pure replay from a complete journal, every `invokeInline` call re-opens the same lane via the deterministic `(q, j)` key; the inline body re-runs; its yields are pushed to `ctx.journal` as they are consumed from the lane cursor. The runtime terminal boundary substitutes stored results at `runAsTerminal(...)` delegation points to prevent external side effects from re-firing. `ctx.journal` on replay is byte-identical to the original, including inline-lane events. On crash recovery, the same mechanism applies: durable prior work is rebuilt via middleware re-execution + cursor-substituted terminals, and the live frontier takes over where the durable prefix ends.

### 3.1 Basic invocation and input validity (spec §§5.1, 5.5)

| ID | Tier | Hook | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| IE-B-001 | Core | §5.1 | Workflow-visible | `invokeInline` returns `Operation<T>` composed via `yield*` | Middleware calls `yield* invokeInline(Fn(["x"], Ref("x")), [42])` | Result is `42` |
| IE-B-002 | Core | §6.1 | Workflow-visible | `args` bind positionally to `fn.params` | `Fn(["a","b"], Add(Ref("a"), Ref("b")))` with `args=[1,2]` | Result is `3` |
| IE-B-003 | Core | §5.5.1, IH9 | Workflow-visible | `fn` must be a compiled `Fn` value | `invokeInline({not: "a Fn"}, [])` | Raises `InvalidInvoke*` family error; no journal entry, no allocator change |
| IE-B-004 | Core | §5.5.2, IH9 | Workflow-visible | `args` must be an array | `invokeInline(fn, "not an array")` | Raises input-validity error; no side effects |
| IE-B-005 | Extended | §5.5.4 | Journal-visible | `opts.label` is not journaled | Call with `{label: "sentinel-label"}`; inspect journal | No journal entry contains the label |
| IE-B-006 | Core | §5.5.3 | Workflow-visible | `opts.overlay` structural validation | Pass a malformed overlay | Raises input-validity error; no side effects |

### 3.2 Identity and non-allocation (spec §6.2, §6.3; IH1, IH2)

| ID | Tier | Hook | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| IE-I-001 | Extended | IH1 | Runtime-exposed (ambient coroutine-id; reference-harness surface) | Caller's coroutineId is visible inside the inline body | Inline body reads ambient coroutine-id; harness records caller id before the call | Reported id inside the body equals the caller's id |
| IE-I-002 | Extended | IH2 | Runtime-exposed (allocator snapshot; reference-harness surface) | Allocator unchanged across the call | Snapshot the allocator before and after an `invokeInline` call whose body contains no allocator-advancing operation | Values equal |
| IE-I-002J | Core | IH2 | Journal-visible | Allocator non-participation via child-coroutineId allocation | Caller yields A (middleware calls `invokeInline(fnYieldingB)`; fn.body yields B with no allocator-advancing operation); caller yields C (middleware calls `invoke(childFn)`) | Caller cursor: [A, C] at yieldIndex 0..1. Inline lane `${caller}@inline0.0`: [B]. Invoke-child `${caller}.0` cursor: childFn's yields + terminal `CloseEvent`. No other child coroutineIds, no other inline lanes |
| IE-I-003 | Core | IH1, §6.2 | Journal-visible | No additional runtime coroutineId appears in the journal | Workflow uses `invokeInline` exclusively (no `invoke`, `scoped`, `spawn`, `resource`, `timebox`, `all`, `race`) | No coroutineId values of the form `parentId.{k}` appear. Caller cursor and inline lane cursors partition all events. Exactly one `CloseEvent` overall, under the caller's coroutineId |
| IE-I-004 | Core | IH10, §6.10.4 | Journal-visible | Mixing `invoke` and `invokeInline`: only `invoke` allocates | Sequence: caller yields Ta (middleware calls `invokeInline(a)`, a yields A); caller yields Tb (middleware calls `invoke(b)`, b yields B); caller yields Tc (middleware calls `invokeInline(c)`, c yields C); caller yields D | Caller cursor: [Ta, Tb, Tc, D] at yieldIndex 0..3. Inline lane `${caller}@inline0.0`: [A] (`q=0, j=0`). Inline lane `${caller}@inline2.0`: [C] (`q=2, j=0`). Invoke-child `${caller}.0` (allocated at Tb) cursor: [B] + terminal `CloseEvent`. Exactly one new child coroutineId; zero from `invokeInline` |
| IE-I-005 | Core | §6.3.2 | Journal-visible | Operations inside the inline body attribute their allocator advancements to the caller's unified child allocator | Inline body contains `spawn(innerFn)`; caller then performs `spawn(callerFn)` | Two child coroutineIds `${caller}.0` and `${caller}.1` in source order; first attributable to inline-body `spawn` per spawn spec §A.4 (consumed from caller's `childSpawnCount`, NOT from any lane-local allocator), second to the caller's own `spawn` |
| IE-I-006 | Extended | §6.3.2, IH10 | Journal-visible | Determinism under deeper mixed-origin allocation | Inline body contains `scoped(...)` then `spawn(...)`; caller then does `invoke(...)` | Three child coroutineIds in source order `parentId.0`, `parentId.1`, `parentId.2` |

### 3.3 No durable boundary of its own (spec §6.5; IH3, IH4)

| ID | Tier | Hook | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| IE-B-010 | Core | IH3, §6.5.3 | Journal-visible | No `YieldEvent` attributable to the call itself | Caller yields A (triggering middleware calls `invokeInline(fn)` with fn's body empty); caller yields D after return | Caller cursor: [A, D] at its own yieldIndex 0..1. Inline lane `${caller}@inline0.0` cursor: empty (fn.body is empty — no yields). No other entries under any cursor on this path |
| IE-B-011 | Core | IH3, §6.5.3 | Journal-visible | No `CloseEvent` attributable to the call itself | As IE-B-010, run to completion | Exactly one `CloseEvent` under the caller's coroutineId. Zero `CloseEvent`s under any inline lane key |
| IE-B-012 | Core | IH4, §6.5.1–2 | Journal-visible | Caller cursor / lane cursor partition | Caller yields A (triggering middleware calls `invokeInline(fn)`; fn yields B, C); caller yields D | Caller cursor: [A, D] at its own yieldIndex 0..1. Inline lane `${caller}@inline0.0` cursor: [B, C] at its own yieldIndex 0..1. Contiguity assertion is per-cursor |
| IE-B-013 | Core | IH4, §6.5.5 | Journal-visible | Distinct lane keys for distinct caller dispatches | Case (a): Caller yields A1 (middleware calls `invokeInline(fn1)` yielding B); caller yields A2 (middleware calls `invokeInline(fn2)` yielding C); caller yields D. Case (b): a single triggering caller yield A whose middleware calls `invokeInline(fn1)` (yielding B) then `invokeInline(fn2)` (yielding C); caller yields D | Case (a): caller cursor = [A1, A2, D] at yieldIndex 0..2; lane `${caller}@inline0.0` = [B] (`q=0, j=0`); lane `${caller}@inline1.0` = [C] (`q=1, j=0`). Case (b): caller cursor = [A, D] at yieldIndex 0..1; lane `${caller}@inline0.0` = [B] (`q=0, j=0`); lane `${caller}@inline0.1` = [C] (`q=0, j=1`). Distinct lanes per distinct `(q, j)` tuple |
| IE-B-014 | Core | IH3, §6.5.4 | Journal-visible | Durable event algebra unchanged | Enumerate event discriminants in a mixed workflow using `invokeInline` and `invoke` across caller, invoke-child, and inline lane cursors | Set of event type discriminants is exactly `{YieldEvent, CloseEvent}`. `coroutineId` field's grammar is widened to include inline lane keys (§6.5.5), but this is a string-grammar widening, not a new discriminant |

### 3.4 Scope and lifetime (spec §6.4; IH5)

Scope proven in Core through its normative consequences: caller-owned teardown ordering, no inline-owned close/yield events, middleware visibility. No Core test relies on middleware-local JS state to bridge data across calls; harness-assisted variants are Extended and flagged.

| ID | Tier | Hook | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| IE-L-001C | Core | IH5, §6.4.1 | Journal-visible | Resource created inside an inline body is torn down at caller scope exit, not at the inline call's return | Caller: `invokeInline(bodyAcquiringR1)` where body uses `resource(acquireR1)` with `try { provide(R1) } finally { releaseR1 }`. Caller then yields effect E. Caller scope exits | Caller coroutineId: acquire at yieldIndex 0; E at yieldIndex 1; **then** release as caller-scope teardown (resource spec §7.4) before caller `CloseEvent`. Release appearing at yieldIndex 1 with E at yieldIndex 2 would falsify |
| IE-L-001H | Extended | IH5 | Harness-assisted | Sibling inline calls see the same live resource via middleware-local state | Middleware declares JS variable `session = null`. Inline A `resource(createSession)` stores session via host callback. Inline B reads `session`, does `db.query(session, …)` | Inline B succeeds; cleanup only at caller teardown. **Flagged G1** |
| IE-L-002 | Extended | IH5, §6.4.2 | Journal-visible | Spawn from inline body attaches to caller's lifetime (no handle return) | Inline body spawns long-running child; caller scope exits | Child `CloseEvent` precedes caller `CloseEvent`; compound-concurrency §9 holds |
| IE-L-002R | Extended | IH5 | Harness-assisted | Returning a spawn task handle from inline body and joining at caller | Inline body spawns, bridges handle via middleware-local state; caller joins | Join succeeds. **Flagged G1** |
| IE-L-003C | Core | IH5 | Workflow-visible + journal-visible | Session-shaped resource reusable across sibling inline calls via transport-bound state | Transport-bound Session agent (state keyed by `sessionId` on the agent side). Inline A `openSession("s1")`. Caller yields E. Inline B `switchSession("s1")` | Inline B succeeds; cleanup at caller teardown. No capability value crosses the inline boundary |
| IE-L-004 | Extended | IH5, §6.4.3 | Harness-assisted | Stream-subscription handle returned from inline body and reused by caller | Inline body `stream.subscribe`, bridges handle to caller | Later `stream.next` succeeds; ancestry passes. **Flagged G1** |
| IE-L-004R | Core | IH5 | Workflow-visible + journal-visible | Subscription held in caller-scope and iterated from inline body | Caller does `stream.subscribe` directly, `Let`-binds handle. Caller calls `invokeInline(bodyIteratingUsingRefToHandle)` | `stream.next` inside inline body journals under caller coroutineId; ancestry passes; no handle movement across boundary |
| IE-L-005 | Core | IH5, §6.4.4 | Journal-visible | Caller cancellation propagates to in-flight inline body | Inline body suspends on long-running effect; caller cancelled externally | Caller `Close(cancelled)` under caller coroutineId; no other `CloseEvent` attributable to inline body; any inline-body `finally` yields precede caller `Close(cancelled)` under caller coroutineId |
| IE-L-006 | Core | §6.4, IH5 | Journal-visible | Reverse-order teardown across mixed origins | Caller creates R1 directly; inline A creates R2; inline B creates R3; caller exits | Cleanup R3 → R2 → R1 under caller coroutineId, then caller `CloseEvent` |

### 3.5 Replay and divergence (spec §6.6; IH6)

| ID | Tier | Hook | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| IE-RP-001 | Core | IH6, §6.6.1 | Journal-visible | Pure replay reproduces `ctx.journal` byte-identically, including inline-lane events | Mixed workflow including `invokeInline`; serialize; replay | Terminal result byte-identical. `eventsFor(journal, caller)` byte-identical to original. `eventsFor(journal, laneKey)` byte-identical to original — middleware and inline body kernel re-run per scoped-effects §9.5; every replayed yield is pushed to `ctx.journal`. `eventsFor(stream, *)` unchanged (durable stream is not re-written on replay). External agent side effects counted at `runAsTerminal(...)` delegation sites increment by 0 on replay — the runtime terminal substitutes stored results in place of `liveWork()` |
| IE-RP-002 | Core | §6.6.2 | Journal-visible + workflow-visible | Durable Yield Rule applies to inline-body yields on lane cursor | Inline body yields two agent effects; replay with harness failing any live dispatch | Replay succeeds; no live dispatch on the lane cursor during recovery if lane entries are durable |
| IE-RP-003 | Extended | §6.6.4, MR-002 | Runtime-exposed | Invoking middleware re-executes deterministically on replay | Middleware body calls `invokeInline`; run; replay | Same `(fn, args, opts.overlay)` tuple reached on every run. Inherits from scoped-effects MR-002 / §9.5 |
| IE-RP-004 | Extended | IH6, §6.6 | Runtime-exposed (allocator snapshot) | Replay allocator trajectory identical | Record allocator at observable points; replay; compare | Trajectories match |
| IE-RP-004J | Core | IH6, §6.6 | Journal-visible | Replay child-coroutineId trajectory identical across caller and invoke-child cursors | Mixed workflow with `invoke`, `invokeInline`, and `spawn`-inside-inline-body. Run; replay | Both runs produce identical caller-cursor and invoke-child-cursor journals with identical child coroutineIds. Lane cursors retain their stream entries |
| IE-RP-005 | Core | §6.6.3 | Workflow-visible + journal-visible | Divergence manifests under the appropriate cursor | Non-deterministic middleware: `invokeInline(fnA)` originally, `invokeInline(fnB)` on crash recovery, fnA/fnB yield different first effects | `DivergenceError` attributable to the lane cursor (not the caller cursor) when the divergence is in fn's first yield. No inline-specific class |
| IE-RP-006 | Extended | §6.6.3 | Workflow-visible | Divergence from inline-body content only | Same `(fn, args)` but fn non-deterministic internally | Lane-cursor `DivergenceError` |
| IE-RP-007 | Core | IH6, IH10 | Journal-visible | Mixed `invoke` + `invokeInline` replay is deterministic per-cursor | Run and replay IE-I-004 setup | Identical caller cursor and invoke-child cursor in `ctx.journal` across runs. Lane cursor streams byte-identical |
| IE-RP-008 | Core | §6.6.1 | Journal-visible | Partial-journal recovery through an inline call (single invocation) | Crash after an inline-body yield was durable but before the triggering caller yield. Recover | Caller cursor is empty for the triggering yield → live dispatch re-enters → middleware re-runs → invokeInline opens same lane key (`q=0`, `j=0`) → iterateFrame drains partial lane cursor, live-dispatches remainder → middleware returns → triggering caller yield appended live. `ctx.journal` after recovery matches a full original run |
| IE-RP-008b | Core | §6.5.5, §6.6.1 | Journal-visible | Recovery with prior durable inline invocation selects the correct lane key | Caller yields A1 (middleware calls `invokeInline(fn)` yielding B1); caller yields A2 (middleware calls `invokeInline(fg)` yielding B2); caller yields D. Crash occurs after A1 and lane `${caller}@inline0.0`=[B1] are fully durable but before A2's triggering YieldEvent is durable. B2 may or may not be partially durable | On recovery: caller cursor = [A1]; lane `${caller}@inline0.0` = [B1]; lane `${caller}@inline1.0` = [B2] partial or full. Middleware re-executes per §9.5: A1's middleware re-runs, `invokeInline` re-opens lane `${caller}@inline0.0` (same `q=0, j=0`); fn re-runs, its B1 yield is replay-substituted at the terminal boundary from the durable lane cursor. `frame.yieldIndex` advances to 1 via A1 append. Caller yields A2 → cursor empty → live dispatch → middleware runs → invokeInline opens lane `${caller}@inline1.0` (from `q=1, j=0`) — matches A2's durable lane, NOT A1's. iterateFrame replays/live-dispatches as needed for B2; fg completes; middleware returns; A2 appended live; D live-dispatched. No lane-key collision on `@inline0.0`. Acceptance gate for the `(q, j)` composite-key design |
| IE-RP-009 | Extended | §6.6.1 | Journal-visible | Crash recovery with mixed primitives at different progress | Crash after `invoke(a)` completed and during `invokeInline(b)`'s body | Invoke child replays from own cursor; caller continues per ordinary per-cursor replay; lane cursor drains per its own mechanism |
| IE-RP-010 | Core | §6.4.1, §9.5 | Workflow-visible + journal-visible | Durable inline resource acquisition is live-rebuilt on recovery | Caller yields A1 whose middleware calls `invokeInline(fn)` where fn acquires a caller-owned resource via `resource(acquire)`; A1 and the resource-child cursor are fully durable. Crash before A2 is durable. Recover; caller yields A2 whose middleware uses the resource via a caller-scope Session agent that reads the resource identity | On recovery, A1's middleware re-runs (scoped-effects §9.5), `invokeInline` re-opens the same lane via `(q=0, j=0)`, fn re-runs, the resource compound external re-spawns its child driveKernel which replays its own cursor; the runtime terminal boundary substitutes stored results at `runAsTerminal(...)` delegation points so live acquire IO is not re-fired. `frame.resourceChildren` is re-populated. A2's middleware then observes the resource as live; the resource is torn down at caller-scope exit |
| IE-RP-011 | Core | §6.3.2, §9.5 | Journal-visible | Durable inline invoke/spawn does not collide with later live-frontier invoke on recovery | Caller yields A1 whose middleware calls `invokeInline(fn1)` where fn1 does `invoke(childFn)` yielding B, allocating `root.0`. A1 and `root.0` cursor durable. Crash before A2 is durable. Recover; caller yields A2 whose middleware does `invoke(anotherChild)` | On recovery, A1's middleware re-runs; `invokeInline` re-opens lane; fn1's `invoke` re-allocates `root.0` (child kernel replays from cursor; terminal substitutes stored results — no double-dispatch). After A1's re-execution, caller's `frame.childSpawnCount` is advanced to 1. A2's `invoke` then allocates `root.1` — no collision on `root.0` |
| IE-RP-012 | Core | §6.4.3, §9.5 | Workflow-visible + journal-visible | Durable inline subscription is usable by later live-frontier caller code on recovery | Caller yields A1 whose middleware calls `invokeInline(fn)` where fn does `stream.subscribe(source)` yielding subscription token `sub:root:0`; A1 and subscription cursor durable. Crash before A2 is durable. Recover; caller yields A2 whose middleware uses the handle via a caller-scope Subscription agent that exposes it | On recovery, A1's middleware re-runs; `invokeInline` re-opens lane; fn's `stream.subscribe` re-runs with terminal substituting stored token `sub:root:0`; `ctx.subscriptions` is re-populated with the entry for `sub:root:0`. A2's `stream.next(handle)` resolves — ancestry passes because token's coroutineId `root` matches caller's effective coroutineId |

### 3.6 Error propagation (spec §6.8; IH8)

| ID | Tier | Hook | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| IE-E-001 | Core | IH8, §6.8.1 | Workflow-visible | Uncaught inline-body error surfaces at call site as original error | Inline body throws `new MyError("x")` | Middleware observes exactly that exception at `yield* invokeInline(...)`; not wrapped |
| IE-E-002 | Core | §6.8.1 | Workflow-visible | Error shape contrast with `invoke` | Parallel fixtures: inline body throws `MyError`; invoked child throws `MyError` | `invokeInline`: caller sees `MyError` directly (assertion reads thrown value's own properties). `invoke`: caller sees a reified close-reason exception carrying `MyError` per nested-invocation §10.2 |
| IE-E-003 | Core | §6.8.2 | Workflow-visible | Errors caught inside inline body do not escape | Inline body `try/catch` catches error, returns value | `invokeInline` resolves with body's return value; no propagation |
| IE-E-004 | Core | §6.8.3 | Workflow-visible | Uncaught error flows through caller's scoped-effects error flow | Middleware does not catch | Caller terminates per existing scoped-effects semantics; no inline-specific path |
| IE-E-005 | Extended | §6.8.2 | Journal-visible | Error caught inside body produces no unusual event | Inline body's try/catch suppresses thrown error | Normal flow resumes; no spurious journal entry |
| IE-E-006 | Core | §6.8.1 | Workflow-visible | Non-`Error` thrown values preserved verbatim | Inline body throws a plain object or string | Exact value propagates; no wrapping or coercion |

### 3.7 Call-site and input rejection (spec §5.3; IH9)

All share: a rejected call advances no allocator, writes no journal entry, pushes no overlay, does not evaluate `fn.body`.

| ID | Tier | Hook | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| IE-V-001 | Core | IH9, §5.3.1 | Workflow-visible + journal-visible | Rejected call produces no effects attributable to the rejected call attempt | Workflow: caller yields A; middleware calls `invokeInline` from a disallowed site (outside any `Effects.around({dispatch})`); harness observes the thrown error; caller yields B | (a) Throws `InvalidInvoke*` call-site error. (b) No journal entry is attributable to the rejected call attempt: journal contains exactly A at yieldIndex 0, B at yieldIndex 1, caller `CloseEvent`, with no additional entry appearing between A and B under any coroutineId. (c) No coroutineId is allocated attributable to the rejected attempt: no new child coroutineId in the journal. (d) No overlay push persists: if the rejected call supplied `opts.overlay`, a subsequent effect F after the rejection is not observed by any middleware frame installed by that overlay (asserted via a marker on F's journaled description). (e) No evaluation of `fn.body`: `fn.body`, had it been evaluated, would have produced a sentinel yield whose effect ID is absent from the journal between A and B. Unrelated subsequent workflow activity is not part of this assertion |
| IE-V-002 | Core | §5.3.1 | Workflow-visible | Rejected from agent operation handler | Agent handler body calls `yield* invokeInline(...)` | Raises call-site error; no side effects |
| IE-V-003 | Core | §5.3.1 | Workflow-visible | Rejected from `Effects.around({ resolve })` body | Install resolve middleware; call `invokeInline` inside | Raises call-site error; no side effects |
| IE-V-004 | Core | §5.3.1 | Workflow-visible | Rejected from facade `.around(...)` body | Install facade middleware; call `invokeInline` inside | Raises call-site error; no side effects |
| IE-V-005 | Extended | §5.3.3 | Runtime-exposed (`DispatchContext` identity) | Stale `DispatchContext` reuse | Capture ctx in invocation #1; attempt reuse in invocation #2 | Raises call-site error; no side effects |
| IE-V-006 | Core | IH9 | Workflow-visible | Primitive-name distinguishability | Trigger call-site errors from both `invokeInline` and `invoke` in parallel | Thrown error distinguishes the failing primitive through any documented means (message content or property). **Flagged G2** |
| IE-V-007 | Extended | §5.3.1 | Workflow-visible | `invokeInline` from IR-evaluated middleware | Hostile scenario attempting to reach `invokeInline` from IR middleware | Raises call-site error or is structurally impossible |
| IE-V-008 | Core | IH9, §5.3.1.a, §11 | Workflow-visible + journal-visible | Nested `invokeInline` from inline-lane dispatch is rejected with zero side effects | Install an `Effects.around({ dispatch })` middleware that unconditionally calls `yield* invokeInline(fn)`. Workflow: caller yields A → middleware handles A → calls `invokeInline(fn)` → fn.body yields effect E → middleware re-enters dispatching E (now on inline lane) → tries to call `invokeInline(fg)`. Harness observes the rejection and allows the outer inline body to continue | The nested call throws `InvalidInvokeCallSiteError` identifying the primitive name. No lane allocated for the rejected attempt. No `j` increment for the nested dispatch. No evaluation of `fg.body`. No entry on any cursor attributable to the rejected attempt. Durable journal shows caller cursor = [A, D] and inline lane `${caller}@inline0.0` = [E, ...] — identical to the same workflow without the rejected nested call. `frame.yieldIndex` and outer `j` counter unchanged by the rejection |

### 3.8 Middleware, transport, overlay (spec §6.7, §6.9)

| ID | Tier | Hook | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| IE-M-001 | Core | §6.9 | Journal-visible | Inline-body effects traverse caller's middleware chain | Caller installs `Effects.around({ dispatch })` tagging effect descriptions; inline body yields an effect | Journaled effect description carries the tag |
| IE-M-002 | Core | §6.9 | Workflow-visible + journal-visible | Caller's transport bindings visible inside inline body | Caller scope has `useTransport(Agent, ...)` + `useAgent(Agent)`; inline body calls agent method via facade | Dispatch routes to caller-scope-bound transport |
| IE-M-003 | Core | §6.9 | Workflow-visible + journal-visible | Caller's agent facade resolution visible | Caller binds two agents; inline body dispatches to each | Both resolve correctly; no rebinding |
| IE-M-004 | Extended | §6.7 | Runtime-exposed (stack depth) | Overlay scoping via stack-depth inspection | Record scoped-effect frame stack depth before/after call with no `opts.overlay` | Depths equal |
| IE-M-004J | Core | §6.7 | Workflow-visible + journal-visible | Overlay scoping observed through effect behavior | `invokeInline(fn, args, { overlay })`; inline body yields E1 under transforming overlay; after return caller yields E2 | E1's journaled description reflects overlay transformation; E2's does not |
| IE-M-005 | Core | §6.7 | Journal-visible | Overlay not journaled standalone | Call with `opts.overlay`; inspect journal | No entry records overlay as an independent durable input or event |
| IE-M-006 | Extended | §6.9 | Journal-visible | Cross-boundary middleware visible to inline-body effects | Cross-boundary IR middleware installed at caller scope; inline body yields effect | Middleware fires; routing unchanged |

### 3.9 `invoke` regression (IH10)

| ID | Tier | Hook | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|---|
| IE-N-001 | Core | IH10 | Journal-visible | `invoke` still allocates a child coroutineId | Single `invoke(fn)` call | Journal: new child coroutineId `parentId.0`; child's own `YieldEvent`s and terminal `CloseEvent` appear under it |
| IE-N-002 | Core | IH10 | Workflow-visible + journal-visible | `invoke` still isolates its child's scope | `invoke` child acquires a resource; returns. Caller attempts to use | Resource torn down at child close; attempted use fails per existing resource semantics |
| IE-N-003 | Core | IH10 | Journal-visible | `invoke` still writes `Close` under child coroutineId | Inspect journal for `invoke` call | `CloseEvent` under child coroutineId; no such event for any `invokeInline` call in same run |
| IE-N-004 | Core | IH10 | Journal-visible | Mixed `invoke`/`invokeInline` preserves each primitive's invariants | Sequence: `invoke(a)`, `invokeInline(b)` (body yields one effect), `invoke(c)` | Two new child coroutineIds (for a and c); no coroutineId for b; inline body's yield appears contiguously under caller |
| IE-N-005 | Core | IH10 | Workflow-visible | Error-shape contrast preserved under mixing | Single middleware body: branch A `invoke(aThrows)` (reified close-reason) vs branch B `invokeInline(bThrows)` (original) | Each branch surfaces its primitive's error shape unchanged |
| IE-N-006 | Extended | IH10 | Journal-visible | Deep mixing with inline bodies containing `invoke` | Inline body of `invokeInline(outer)` itself contains `invoke(inner)` | `invoke(inner)`'s child is a child of the caller (not of any inline "body"); exactly one child coroutineId attributable to that `invoke` |
| IE-N-007 | Extended | — | Journal-visible | `invoke`-only sanity regression | Workflow uses only `invoke` | Matches nested-invocation test plan expectations bit-for-bit |

### 3.10 Interaction with other primitives

#### 3.10.1 With `spawn`

| ID | Tier | Obs. class | Description | Expected |
|---|---|---|---|---|
| IE-INT-SP-001C | Core | Journal-visible | Fire-and-forget spawn inside inline body, torn down at caller scope exit | Child `CloseEvent` before caller `CloseEvent`; no handle return required |
| IE-INT-SP-001 | Extended | Harness-assisted | Join a task handle produced by inline body | Join succeeds. **Flagged G1** |
| IE-INT-SP-002 | Core | Journal-visible | Spawned child not orphaned | No child events after caller teardown |
| IE-INT-SP-003 | Extended | Journal-visible | Compound-concurrency §9 ordering under mixed-origin spawns | Ordering invariants hold |

#### 3.10.2 With `resource`

| ID | Tier | Obs. class | Description | Expected |
|---|---|---|---|---|
| IE-INT-RS-001C | Core | Journal-visible | Inline-body resource with try/finally; release at caller teardown | Release yield after caller's next yield; before caller `CloseEvent` |
| IE-INT-RS-001H | Extended | Harness-assisted | Resource handle shared across siblings via middleware-local state | Second inline sees live handle. **Flagged G1** |
| IE-INT-RS-002 | Core | Journal-visible | Mixed-source resources teardown in reverse creation order | R3 → R2 → R1 |
| IE-INT-RS-003 | Extended | Journal-visible | Resource init failure propagation | Error out of `invokeInline` per IE-E-001; earlier resources still cleaned up |

#### 3.10.3 With `timebox`

| ID | Tier | Obs. class | Description | Expected |
|---|---|---|---|---|
| IE-INT-TB-001 | Extended | Journal-visible | `timebox` inside inline body behaves per timebox spec | Allocator advancement attributed to timebox; caller observes result |
| IE-INT-TB-002 | Extended | Journal-visible | Timebox cancels inline-body work without affecting caller | Timebox cancels its body child per its own spec; caller continues |

#### 3.10.4 With stream subscriptions

| ID | Tier | Obs. class | Description | Expected |
|---|---|---|---|---|
| IE-INT-ST-001C | Core | Workflow-visible | Caller subscribes; inline body iterates via `Ref` | All `stream.next` calls succeed; ancestry passes |
| IE-INT-ST-001 | Extended | Harness-assisted | Inline body subscribes; caller iterates via bridged handle | Succeeds. **Flagged G1** |
| IE-INT-ST-002 | Extended | Harness-assisted | Subscription survives across sibling inline calls via handle bridge | Succeeds. **Flagged G1** |
| IE-INT-ST-003 | Extended | Journal-visible | Subscription torn down at caller scope exit | Per stream spec §10.2 |

---

## 4. Diagnostic-only test cases (non-normative)

**Observability:** Harness-introspective. MUST NOT determine conformance. Exist as diagnostic aids.

| ID | Purpose |
|---|---|
| IE-D-001 | **Scope sentinel identity.** Install a scope-local sentinel in caller's scope; inline body reads it. Both reads return same object identity. Failure suggests (not proves) a new scope was opened |
| IE-D-002 | **Coroutine-driver entry counter.** Instrument reference runtime's driver entry; baseline without `invokeInline` vs augmented. Counts equal. Substrate-specific |
| IE-D-003 | **Overlay-stack leak detector.** Stack depth before/after call with no `opts.overlay` equal |
| IE-D-004 | **Allocator call-site attribution trace.** Trace allocator-advancement call sites; `invokeInline` does not appear as a source |
| IE-D-005 | **Child-ID issuer count.** Issuer called once per allocator-advancing operation; zero times per `invokeInline` |
| IE-D-006 | **Ambient coroutine-id restored after call.** Read ambient coroutine-id inside body and after return; both equal caller's id |
| IE-D-007 | **`DispatchContext` identity probe for stale-context detection.** Substrate-specific; localizes the enforcement code path |

---

## 5. Minimum acceptance subset

Feature is MVP-complete when all 17 pass. All Journal-visible or Workflow-visible.

| # | ID | Invariant | Obs. class |
|---|---|---|---|
| 1 | IE-B-001 | `invokeInline` returns `Operation<T>` usable via `yield*` | Workflow-visible |
| 2 | IE-B-010 | No inline-call-itself `YieldEvent` (§6.5.3, IH3) | Journal-visible |
| 3 | IE-B-011 | No inline-call-itself `CloseEvent`; no `CloseEvent` under any lane key (§6.5.3, IH3) | Journal-visible |
| 4 | IE-B-012 | Caller cursor and inline lane cursor partition correctly (§6.5.1–2, IH4) | Journal-visible |
| 5 | IE-B-013 | Distinct lane keys for distinct caller dispatches or sibling calls (§6.5.5) | Journal-visible |
| 6 | IE-I-002J | Allocator unchanged by `invokeInline` itself (§6.3.1, IH2) | Journal-visible |
| 7 | IE-I-004 | Mixed `invoke` + `invokeInline`: only `invoke` allocates (IH10, §6.10.4) | Journal-visible |
| 8 | IE-I-005 | Operations inside inline body attribute allocator advancements to caller's unified allocator (§6.3.2) | Journal-visible |
| 9 | IE-L-001C | Resource acquired inside an inline body is torn down at caller scope exit, not at call return (§6.4.1, IH5) | Journal-visible |
| 10 | IE-L-005 | Caller cancellation reaches an in-flight inline body (§6.4.4, IH5, IH7) | Journal-visible |
| 11 | IE-RP-001 | Pure replay reproduces caller-cursor `ctx.journal` byte-identically (§6.6.1, IH6) | Journal-visible |
| 12 | IE-RP-005 | Divergence under the appropriate cursor (§6.6.3) | Workflow-visible + journal-visible |
| 13 | IE-RP-008b | Recovery with prior durable inline invocation selects the correct lane key (§6.5.5 + §6.6.1) | Journal-visible |
| 14 | IE-E-001 | Uncaught inline-body error surfaces at call site as original error (§6.8.1, IH8) | Workflow-visible |
| 15 | IE-V-001 | Rejected call attempt has no attributable side effects on any cursor (§5.3.1, IH9) | Workflow-visible + journal-visible |
| 16 | IE-V-008 | Nested `invokeInline` from inline-lane dispatch is rejected with zero side effects (§5.3.1.a, §11, IH9) | Workflow-visible + journal-visible |
| 17 | IE-N-001 | `invoke` regression: still allocates child coroutineId and writes its own events | Journal-visible |

---

## 6. Coverage summary

### 6.1 Invariant coverage (spec §6) — Core tier

| Invariant | Core tests |
|---|---|
| §6.1 Observational equivalence (anchor) | All Core tests collectively |
| §6.2 Coroutine identity | IE-I-003, IE-I-004, IE-I-005 |
| §6.3.1 Allocator non-participation | IE-I-002J, IE-I-004 |
| §6.3.2 Attribution to contained operations | IE-I-005 |
| §6.4 Scope boundary | IE-L-001C, IE-L-005, IE-L-006, IE-L-003C, IE-L-004R (via consequences) |
| §6.4.1 Resources outlive the call | IE-L-001C, IE-L-003C, IE-INT-RS-001C |
| §6.4.2 Spawns attach to caller | IE-INT-SP-001C, IE-INT-SP-002 |
| §6.4.3 Capabilities caller-owned | IE-L-003C, IE-INT-ST-001C |
| §6.4.4 Cancellation pass-through | IE-L-005 |
| §6.5.1 One YieldEvent per inline yield on lane cursor | IE-B-012, IE-B-013 |
| §6.5.2 Contiguous yieldIndex within lane cursor | IE-B-012, IE-B-013 |
| §6.5.3 No event for the call itself; no CloseEvent under lane key | IE-B-010, IE-B-011 |
| §6.5.4 Durable algebra unchanged (grammar widened) | IE-B-014 |
| §6.5.5 Inline journal lane keys distinct per `(q, j)` | IE-B-013, IE-RP-008b |
| §6.6.1 Per-cursor replay policy | IE-RP-001, IE-RP-008, IE-RP-008b |
| §6.6.2 Durable Yield Rule on inline lane yields | IE-RP-002 |
| §6.6.3 Per-cursor divergence | IE-RP-005 |
| §6.6.4 Invoking-middleware determinism | Extended only (IE-RP-003, inherited from MR-002 / §9.5) |
| §6.7 Overlay scoping | IE-M-004J, IE-M-005 |
| §6.8.1 Original-error propagation | IE-E-001, IE-E-002, IE-E-006 |
| §6.8.2 Caught errors do not escape | IE-E-003 |
| §6.8.3 No special error path | IE-E-004 |
| §6.9 Middleware visibility | IE-M-001, IE-M-002, IE-M-003 |
| §6.10.1 Program-order preservation | IE-B-012 |
| §6.10.2 Serial composition | IE-B-013 |
| §6.10.4 Mixed-primitive determinism | IE-I-004, IE-RP-004J, IE-RP-007, IE-N-004 |

### 6.2 Conformance-hook coverage — Core tier

| Hook | Core tests |
|---|---|
| IH1 | IE-I-003, IE-I-004 |
| IH2 | IE-I-002J, IE-I-004 |
| IH3 | IE-B-010, IE-B-011, IE-B-014 |
| IH4 | IE-B-012, IE-B-013 |
| IH5 | IE-L-001C, IE-L-003C, IE-L-004R, IE-L-005, IE-L-006, IE-INT-SP-001C, IE-INT-SP-002, IE-INT-RS-001C, IE-INT-RS-002, IE-INT-ST-001C |
| IH6 | IE-RP-001, IE-RP-002, IE-RP-005, IE-RP-007, IE-RP-008, IE-RP-008b, IE-RP-004J |
| IH7 | IE-L-005 |
| IH8 | IE-E-001, IE-E-002, IE-E-003, IE-E-004, IE-E-006 |
| IH9 | IE-B-003, IE-B-004, IE-B-006, IE-V-001, IE-V-002, IE-V-003, IE-V-004, IE-V-006, IE-V-008 |
| IH10 | IE-I-004, IE-I-005, IE-RP-007, IE-N-001, IE-N-002, IE-N-003, IE-N-004, IE-N-005 |

### 6.3 Tier counts

| Section | Core | Extended | Diagnostic | Total |
|---|---|---|---|---|
| §3.1 Basic / inputs | 5 | 1 | 0 | 6 |
| §3.2 Identity / non-allocation | 4 | 3 | 0 | 7 |
| §3.3 No durable boundary | 5 | 0 | 0 | 5 |
| §3.4 Scope & lifetime | 5 | 3 | 0 | 8 |
| §3.5 Replay & divergence | 7 | 3 | 0 | 10 |
| §3.6 Error propagation | 5 | 1 | 0 | 6 |
| §3.7 Call-site / input rejection | 7 | 2 | 0 | 9 |
| §3.8 Middleware / transport / overlay | 5 | 2 | 0 | 7 |
| §3.9 `invoke` regression | 5 | 2 | 0 | 7 |
| §3.10 Interaction | 4 | 7 | 0 | 11 |
| §4 Diagnostic | 0 | 0 | 7 | 7 |
| **Total** | **52** | **24** | **7** | **83** |

### 6.4 Flagged clarifications

Tests explicitly flagged on non-blocking clarifications (spec §10). None affects MVP acceptance:

- **G1** (capability return across boundary): IE-L-001H, IE-L-002R, IE-L-004, IE-INT-SP-001, IE-INT-RS-001H, IE-INT-ST-001, IE-INT-ST-002.
- **G2** (inspectable primitive property): IE-V-006.
- **G3** (cancellation observability restatement): IE-L-005 assertion tightness only.
