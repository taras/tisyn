# Tisyn Inline Invocation — Conformance Test Plan

**Tests:** `tisyn-inline-invocation-specification.md`
**Companion of.** `tisyn-inline-invocation-specification.md`
**Complements.** `tisyn-nested-invocation-test-plan.md`
**Depends on.**
  - `tisyn-scoped-effects-test-plan.md` (MR-002; RD-*)
  - `tisyn-compound-concurrency-specification.md` §4.2 (unified allocator; amended by inline-invocation §17.4)
  - `tisyn-stream-iteration-specification.md` (capability ancestry; amended by inline-invocation §17.3)

Test IDs use the prefix `IL-`.

---

## 1. Overview

### 1.1 Scope

- Primary invariant: distinct durable identity with shared lifetime (§2)
- Dual-identity model: journal coroutineId vs. owner coroutineId (§12)
- Capability ownership and counter allocation (§12)
- Owner-based counter uniqueness and replay reconstruction (§12.4, §12.5)
- Unified child allocator participation (§7.2; compound-concurrency §4.2 amendment at §17.4)
- Inline lane identity (§7)
- Call-site model (§6)
- Nested inline — in MVP (§7.6)
- Journal, replay, ordering, lifetime, error, cancellation
- Composition with three-lane replay dispatch and with `invoke`
- Scope inside inline bodies (§11.7)
- Regression

### 1.2 Out of scope

- `invoke` on its own; kernel; compiler; concurrent `invokeInline` (§16)

### 1.3 Tiers

- **Core.** MUST pass.
- **Extended.** SHOULD pass.
- **Diagnostic.** Non-normative.

### 1.4 Observability

Core = Workflow-visible or Journal-visible.

---

## 2. Primary Invariant (§2)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-PI-001 | Core | Journal + workflow | **Distinct durable identity AND shared lifetime.** | `invokeInline(fn)`: fn dispatches E, yields `resource` R. Later caller yield Y. Scope exits | (a) E under laneId. (b) R cleanup at caller teardown. (c) Y succeeds |
| IL-PI-002 | Core | Journal | **Caller cursor and lane cursor coexist.** | Yield A; inline yields B, C; triggering D; yield E. Live; replay | Byte-identical. Caller: A, D, E. Lane: B, C |
| IL-PI-003 | Core | Journal + workflow | **Resource continuity across siblings.** | Two calls. First yields `resource`. Second uses it. Exits | Distinct lanes. Cleanup at teardown. Second succeeds |

---

## 3. Basic Invocation (§6)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-B-001 | Core | Workflow | Returns `Operation<T>` | `[42]` | `42` |
| IL-B-002 | Core | Workflow | Args bind | `Add [1,2]` | `3` |
| IL-B-003 | Core | Workflow | `fn` must be `Fn` | Non-Fn | Error; zero effects |
| IL-B-004 | Core | Workflow | `args` must be array | Non-array | Error |
| IL-B-005 | Extended | Journal | `opts.label` not journaled | `{label:"x"}` | Not in journal |
| IL-B-006 | Core | Workflow | `opts.overlay` validation | Malformed | Error |

---

## 4. Inline Lane Identity and Allocator (§7, compound-concurrency §4.2 amendment)

These tests verify that `invokeInline` participates in the unified child allocator per compound-concurrency §4.2 (amended at inline-invocation §17.4), and that the allocated `parentId.{k}` ID is an inline lane — not a child scope.

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-A-001 | Core | Journal | **Advances unified allocator `+1`; allocated ID is an inline lane (no CloseEvent).** | `invokeInline(a)`, then `invoke(b)` | `.0` is inline lane (YieldEvents, no CloseEvent). `.1` is invoke child (YieldEvents + CloseEvent). Both from the same `childSpawnCount` sequence |
| IL-A-002 | Core | Journal | Lane uses `parentId.{k}` format | Inspect | Matches compound-concurrency §4.2 format |
| IL-A-003 | Core | Journal | Sequential calls → sequential IDs from unified allocator | Three `invokeInline` calls | `.0`, `.1`, `.2` — all lanes, all without CloseEvent |
| IL-A-004 | Core | Journal | Children inside body allocate from lane's own allocator | Body yields `spawn(child)` | `laneId.0` |
| IL-A-005 | Core | Journal | **I-ID: replay produces identical lane IDs.** | Live; replay | Byte-identical. Verifies I-ID applies to inline-lane allocation origin |
| IL-A-006 | Core | Journal | **Mixed `invoke`/`invokeInline` interleave in unified allocator.** | `invokeInline(a)`, `invoke(b)`, `invokeInline(c)` | `.0` (lane, no Close), `.1` (child, Close), `.2` (lane, no Close) — unified counter, interleaved origins |

---

## 5. Call-Site Model (§6.2)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-V-001 | Core | Workflow + journal | **Rejected outside MW; allocator unchanged.** | Root generator calls `invokeInline` | Error; no allocator advancement; no journal entry |
| IL-V-002 | Core | Workflow | Rejected from agent handler | | Error; zero effects |
| IL-V-003 | Core | Workflow | Rejected from resolve MW | | Error |
| IL-V-004 | Core | Workflow | Rejected from facade MW | | Error |
| IL-V-005 | Extended | Workflow | Stale context | | Error |
| IL-V-006 | Core | Workflow | Primitive distinguishability | Both errors | Distinguishable |
| IL-V-007 | Core | Workflow | Direct from Fn body | | Impossible or rejected; zero effects |

---

## 6. Capability Ownership and Counter Allocation (§12, IH13)

### 6.1 Sibling and caller reuse

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-CO-001 | Core | Workflow + journal | **Subscription from A usable in B.** | A subscribes → H. B uses H | Ancestry passes via shared owner. Events under respective lanes |
| IL-CO-002 | Core | Workflow + journal | **Nested inner subscription usable by caller.** | Inner subscribes → H. Caller uses after both return | Ancestry passes. H owner = original caller |

### 6.2 Journal vs. ownership identity

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-CO-003 | Core | Journal | **Journal under lane, not caller.** | Inline subscribes | `coroutineId = laneId` |
| IL-CO-004 | Core | Workflow | **Ancestry via owner.** | Inline acquires H. Caller uses | Passes |

### 6.3 Child-bearing primitive exclusion

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-CO-005 | Core | Workflow + journal | **`invoke` child caps child-owned.** | Child subscribes → H2. Caller uses | FAILS. H2 owned by child |

### 6.4 Capture-and-propagate

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-CO-006 | Core | Workflow | **Owner at every level.** | Two levels. Inner acquires H. Outer uses | Succeeds |
| IL-CO-008 | Core | Workflow | **Inner inherits outer's owner = caller.** | Verify H owner = C | Not lane |

### 6.5 Owner runtime-only

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-CO-007 | Core | Journal | **Not in journal.** | Inspect YieldEvent | No `ownerCoroutineId` field |
| IL-CO-009 | Core | Journal + workflow | **Replay reconstructs owner.** | Inline acquires H. Live; replay. Caller uses on replay | Passes |

### 6.6 Ordinary values

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-CO-010 | Extended | Workflow | **Ordinary `Val` unaffected.** | Agent returns `{x:42}`. Caller uses | Usable |

### 6.7 Owner-based counter allocation (§12.4)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-CO-011 | Core | Journal + workflow | **Shared counter: unique tokens across caller + two lanes.** | Caller subscribes (T0). Inline A subscribes (T1). Inline B subscribes (T2) | T0, T1, T2 distinct. Sequential under one owner counter. Events under respective coroutineIds |
| IL-CO-012 | Core | Workflow + journal | **Sibling reuse with shared counter.** | A subscribes → T1, H. B subscribes → T2. B uses H | T1≠T2. Ancestry passes |
| IL-CO-013 | Core | Journal + workflow | **Replay counter reconstruction.** | Inline A subscribes (T1, replayed). After frontier, inline B subscribes live (T2) | T2≠T1. Owner counter advanced during replay. Deterministic |
| IL-CO-014 | Core | Workflow + journal | **Child uses own counter.** | `invoke(child)` subscribes → TC. Then inline subscribes → TI | TC from child's counter. TI from owner's. Different namespaces |

---

## 7. Nested Inline (§7.6, IH14)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-NI-001 | Core | Journal | **Inner subtree.** | Outer→inner | `caller.{k}.{m}` |
| IL-NI-002 | Core | Journal | **Both no CloseEvent.** | | None |
| IL-NI-003 | Core | Journal | **Replay independently.** | Live; replay | Byte-identical |
| IL-NI-004 | Core | Journal + workflow | **Resource from inner at caller scope.** | Inner `resource` R. Caller uses. Exits | R at caller teardown |
| IL-NI-005 | Core | Journal | **Crash recovery through nested.** | Crash after inner's first yield | Replays; transitions |
| IL-NI-006 | Core | Workflow | **Only from valid MW.** | Fn body tries | Rejected |
| IL-NI-007 | Core | Workflow + journal | **`invoke` child in nested: child-owned.** | Child R2. Returns. R2 gone | At child close |

---

## 8. Journal Model (§8)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-J-001 | Core | Journal | Under lane | Two effects | Under laneId |
| IL-J-002 | Core | Journal | Triggering after lane | | Lane first |
| IL-J-003 | Core | Journal | No CloseEvent | Normal | None |
| IL-J-004 | Core | Journal | No event for call | A; no-op; B | Caller: 0, 1 |
| IL-J-005 | Core | Journal | Algebra unchanged | | `{Yield, Close}` |
| IL-J-006 | Core | Journal | CloseEvent distinguishes | `invokeInline(a)`, `invoke(b)` | `.0` none; `.1` Close |

---

## 9. Primitive-Specific Child Semantics (§11, IH6)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-CS-001 | Core | Journal | `invoke` CloseEvent | Returns | Close under `laneId.{m}` |
| IL-CS-002 | Core | Workflow + journal | `invoke` scope — child-owned | R gone after | At child close |
| IL-CS-003 | Core | Workflow | `invoke` wraps errors | Throws | Reified |
| IL-CS-004 | Core | Journal | `resource` CloseEvent | Exits | Child Close. Caller teardown |
| IL-CS-005 | Core | Journal + workflow | `resource` provide in caller | After, uses | Usable |
| IL-CS-006 | Core | Journal | `spawn` CloseEvent | Exits | Child Close |
| IL-CS-007 | Core | Journal | Spawn at caller | Exits | Before caller Close |
| IL-CS-008 | Core | Journal | **Only lane has "no Close + shared"** | `resource`, `invoke`, `spawn` | Lane: none. All children: Close |
| IL-CS-009 | Extended | Journal | `timebox` | Timeout | Children Close |
| IL-CS-010 | Core | Journal | **Nested inline no CloseEvent** | Outer→inner | Neither |

---

## 10. Replay (§9)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-R-001 | Core | Journal | Byte-identical | Live; replay | Identical |
| IL-R-002 | Core | Journal | Durable Yield Rule | Fails live | Succeeds |
| IL-R-003 | Core | Journal | Cursor independent | Mixed | Independent |
| IL-R-004 | Core | Journal | Crash recovery | After first yield | Replays; transitions |
| IL-R-005 | Core | Workflow + journal | Divergence under lane | Different effect | Under laneId |
| IL-R-006 | Core | Journal | Mixed deterministic | Live; replay | Identical |
| IL-R-007 | Core | Journal | Crash mid-body | After B, before D | B replays; D caller |
| IL-R-008 | Core | Journal | Children per own specs | `invoke`, `resource` | Each cursor |

---

## 11. Ordering (§10)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-O-001 | Core | Journal | Lane before triggering | I; E | I first |
| IL-O-002 | Core | Journal | Sequential serialized | X; Y | X first |
| IL-O-003 | Core | Journal | yieldIndex contiguous | A; B(lane); C(trigger); D | Caller: 0,1,2. Lane: 0 |
| IL-O-004 | Core | Journal | Caller Close after lane | Normal | Correct |

---

## 12. Lifetime (§11)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-L-001 | Core | Journal | Resource at caller exit | `resource`. Exits | Teardown |
| IL-L-002 | Core | Journal | A→B reuse | Session | Succeeds |
| IL-L-003 | Core | Journal | Spawn at caller | Exits | Before caller |
| IL-L-004 | Core | Journal | No scope boundary | Acquires; returns; uses | No isolation |
| IL-L-005 | Core | Journal | Reverse teardown | R1; A R2; B R3 | R3→R2→R1 |

---

## 13. Error (§13)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-E-001 | Core | Workflow | Original | `MyError` | `MyError` |
| IL-E-002 | Core | Workflow | Contrast | Both | Original vs reified |
| IL-E-003 | Core | Workflow | Caught | try/catch | Resolves |
| IL-E-004 | Core | Workflow | Flow-through | Not caught | Terminates |
| IL-E-005 | Core | Journal | No CloseEvent | Throws | None |
| IL-E-006 | Core | Workflow | Non-Error | String | Propagates |
| IL-E-007 | Core | Workflow | `invoke` child reified | Throws | Reified |

---

## 14. Cancellation (§14)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-X-001 | Core | Journal | Propagates | Suspended; cancelled | Caller Close; no lane Close |
| IL-X-002 | Core | Workflow | No detached | Returns | No continuation |

---

## 15. Replay-Dispatch (§9.3, IH11)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-RD-001 | Core | Journal | Three-lane | Max; dispatches. Live; replay | Max reruns; doesn't refire |
| IL-RD-002 | Core | Workflow | Via lane cursor | E. Live; replay | Lane cursor |
| IL-RD-003 | Core | Journal | Resource-body inside inline | Init dispatches. Live; replay | Doesn't refire |
| IL-RD-004 | Core | Journal | Nested three-lane | Inner dispatches | Inner cursor |

---

## 16. `invoke` Regression (IH10)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-N-001 | Core | Journal | CloseEvent | Single | Close |
| IL-N-002 | Core | Workflow + journal | Scope | Child resource; returns | At child close |
| IL-N-003 | Core | Journal | Error shape | Throws | Reified |
| IL-N-004 | Core | Journal | Mixed | Three calls | Two Close; zero inline |

---

## 17. Interaction

| ID | Tier | Obs. | Expected |
|---|---|---|---|
| IL-INT-SP-001 | Core | Journal | Spawn at caller exit |
| IL-INT-SP-002 | Core | Journal | ID `laneId.{m}` |
| IL-INT-RS-001 | Core | Journal | Resource cleanup at caller exit |
| IL-INT-RS-002 | Core | Journal | ID `laneId.{m}` |
| IL-INT-TB-001 | Extended | Journal | Per spec |
| IL-INT-ST-001 | Core | Journal | Subscription replays correctly |

---

## 18. Scope Inside Inline Body (§11.7)

Test IDs use the prefix `IL-SC-`. Tests cover the lifting of `scope` from rejection to ordinary child-bearing primitive inside inline bodies: scope-child allocation from the lane's `inlineChildSpawnCount`, owner identity transition (scope child uses `childId` for both journal and owner), transport-binding/middleware isolation, scope-installed middleware calling `invokeInline`, replay equivalence, error routing through `kernel.throw`, composition with other inline-body compounds, and regression that other compounds remain unaffected.

### 18.1 Core behavior (§11.7)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-SC-001 | Core | Workflow + Journal | Scope inside inline body creates isolated child scope with CloseEvent. | Inline body contains `scope` with no handler, no bindings, body returns literal. | Scope child ID `laneId.{m}` has `CloseEvent(ok)`. Inline lane has no `CloseEvent`. Return value propagates to inline body. |
| IL-SC-002 | Core | Journal | Scope child ID allocated from lane's own counter. | `invokeInline` → body yields `scope`. | Child ID = `laneId.{inlineChildSpawnCount}`. Counter advanced by +1. |
| IL-SC-003 | Core | Journal | Scope body effects journal under scope child ID. | Inline body contains `scope` whose body dispatches agent effect. | `YieldEvent` under scope child ID, not under inline lane ID or caller ID. |
| IL-SC-004 | Core | Workflow | Scope handler middleware intercepts effects inside scope body. | `scope` with handler that short-circuits effect ID `"test.probe"` to return `"intercepted"`. Body dispatches `"test.probe"`. | Inline body receives `"intercepted"`. Handler does not affect effects dispatched outside the scope. |

### 18.2 Transport binding and middleware isolation (§11.7)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-SC-005 | Core | Workflow | Transport bindings inside scope do not leak to inline lane. | `scope` with transport binding for agent A. After scope exits, inline body dispatches to agent A. | Agent A dispatch fails (no binding) after scope exits. Binding was active inside scope body. |
| IL-SC-006 | Core | Workflow | Transport shutdown on scope exit. | `scope` with transport binding. Scope body completes normally. | Transport shut down before inline body continues. |
| IL-SC-007 | Core | Workflow | Middleware installed inside scope does not leak to inline lane. | `scope` with handler that denies `"test.op"`. After scope exits, inline body dispatches `"test.op"`. | `"test.op"` succeeds after scope exit. Denied inside scope body. |

### 18.3 Owner identity transition — restricted capability ownership (§11.7, §12)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-SC-019 | Core | Journal | Stream subscription inside inline-body scope uses scope child's owner, not inline caller's owner. | Inline body contains `scope`. Scope body dispatches `stream.subscribe`. Inline body (outside scope) also dispatches `stream.subscribe`. | Scope-body subscription token = `sub:<scopeChildId>:0`. Inline-body subscription token = `sub:<callerOwner>:N`. Owner segments differ. |
| IL-SC-020 | Core | Journal | Subscription counter inside scope body is independent of inline lane's shared owner counter. | One `stream.subscribe` in inline body before the scope. Two `stream.subscribe` calls inside inline-body scope. | Pre-scope token = `sub:<callerOwner>:0`. Scope-body tokens = `sub:<scopeChildId>:0`, `sub:<scopeChildId>:1`. Post-scope inline token = `sub:<callerOwner>:1`. |
| IL-SC-021 | Core | Journal + Workflow | `stream.next` ancestry check inside scope body uses scope child coroutineId. | Scope body subscribes to stream, then calls `stream.next` on the subscription handle. | Ancestry check passes: handle owner = scope child, dispatch context owner = scope child. |

### 18.4 Scope-installed middleware calling `invokeInline` (§11.7, §12.3)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-SC-022 | Core | Journal | `invokeInline` from middleware inside inline-body scope allocates from scope child's allocator. | Inline body contains `scope`. Scope body dispatches effect E. Middleware handling E calls `invokeInline(innerFn)`. | Nested inline lane ID = `scopeChildId.{m}`, NOT `laneId.{m}` or `callerId.{m}`. Lane has no `CloseEvent`. |
| IL-SC-023 | Core | Journal | Nested inline lane from scope-body middleware captures scope child as owner. | Same setup as IL-SC-022. `innerFn` dispatches `stream.subscribe`. | Subscription token = `sub:<scopeChildId>:N`. Owner is scope child, not inline caller. |
| IL-SC-024 | Core | Journal | Replay byte-identical for scope-body `invokeInline`. | Live run of IL-SC-022 setup; replay from journal. | Journals byte-identical. Scope child's child allocator reconstructed deterministically. Nested lane cursor independent. |

### 18.5 Determinism and replay (§11.7, blocking-scope §8)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-SC-008 | Core | Journal | Replay byte-identical: scope inside inline body. | Live run; replay from journal. | Journals byte-identical. Scope body effects replayed via scope child cursor. Lane cursor independent. |
| IL-SC-009 | Core | Journal | Scope child CloseEvent replayed correctly. | Live run with scope inside inline. Replay. | `CloseEvent` for scope child present in both runs. Inline lane has no `CloseEvent` in either. |
| IL-SC-010 | Core | Journal | Crash recovery: incomplete scope inside inline. | Partial journal: scope child has YieldEvents but no CloseEvent. Recover. | Scope body replays from cursor, transitions to live at frontier. Scope child produces `CloseEvent` on completion. |

### 18.6 Failure modes (§11.7, blocking-scope §7)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-SC-011 | Core | Workflow | Scope body error propagates to inline body via kernel.throw. | `scope` body throws. Inline body has `try/catch`. | Error caught by inline body's `try/catch`. Scope teardown completes before catch runs (T14). |
| IL-SC-012 | Core | Journal | Scope binding evaluation failure produces CloseEvent(error). | `scope` with binding expression that fails structurally. | `CloseEvent(error)` for scope child. Error propagates to inline body. |
| IL-SC-013 | Core | Workflow | Cancellation of inline caller tears down scope. | Caller cancelled while scope body is running inside inline body. | Scope body cancelled. Scope teardown runs. Scope child `CloseEvent(cancelled)`. |

### 18.7 Composition (§11.7 + §11.4–§11.6)

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-SC-014 | Core | Journal | Mixed scope + other compounds in same inline body. | Inline body: `scope(...)`, then `spawn(...)`, then agent effect. | Three allocations from lane counter: `.0` (scope, CloseEvent), `.1` (spawn child, CloseEvent), agent effect YieldEvent under lane. |
| IL-SC-015 | Extended | Journal | Nested scope inside inline-body scope. | Inline body contains `scope` whose body contains another `scope`. | Outer scope child `.0`, inner scope child `.0.0`. Both produce CloseEvents. |
| IL-SC-016 | Extended | Workflow | `invokeInline` from middleware inside inline-body scope (full round-trip). | Scope body dispatches effect. Middleware handling it calls `invokeInline`. Inner inline body dispatches agent effect and returns. | Scope child has CloseEvent. Nested inline lane has no CloseEvent. All effects journal under correct coroutineIds. |
| IL-SC-017 | Core | Workflow | Scope inside nested inline. | Outer `invokeInline` body dispatches E. Middleware calls inner `invokeInline` whose body contains `scope`. | Scope child allocated from inner lane's counter. Full scope semantics preserved. |

### 18.8 Regression

| ID | Tier | Obs. | Description | Setup | Expected |
|---|---|---|---|---|---|
| IL-SC-018 | Core | Workflow | Existing resource/spawn/timebox/all/race inside inline body unaffected. | Run existing IL-CS-*, IL-L-*, compound tests. | All pass unchanged. |

---

## 19. Regression

| ID | Tier | Obs. | Expected |
|---|---|---|---|
| IL-EX-001 | Core | Journal | Crash-replay: identical |
| IL-EX-002 | Core | Journal | Resource-recovery: identical |
| IL-EX-003 | Core | Journal | Nested-invocation: identical |
| IL-EX-004 | Core | Journal | RD-*: identical |

---

## 20. Minimum Acceptance Subset

All 31 must pass. Tests 1–3: primary invariant. Tests 4–11: capability ownership and counter. Tests 12–15: nested inline. Tests 16–18: child semantics.

| # | ID | What it proves |
|---|---|---|
| **1** | **IL-PI-001** | **Primary invariant** |
| **2** | **IL-PI-002** | **Cursors coexist** |
| **3** | **IL-PI-003** | **Resource continuity** |
| **4** | **IL-CO-001** | **Subscription A usable in B** |
| **5** | **IL-CO-002** | **Nested inner subscription usable by caller** |
| **6** | **IL-CO-003** | **Journal under lane, not caller** |
| **7** | **IL-CO-005** | **`invoke` child caps child-owned** |
| **8** | **IL-CO-008** | **Capture-and-propagate** |
| **9** | **IL-CO-009** | **Replay reconstructs owner** |
| **10** | **IL-CO-011** | **Shared counter: unique tokens** |
| **11** | **IL-CO-013** | **Replay counter reconstruction** |
| **12** | **IL-NI-001** | **Inner subtree** |
| **13** | **IL-NI-003** | **All lanes replay independently** |
| **14** | **IL-NI-004** | **Resource from inner at caller scope** |
| **15** | **IL-NI-007** | **`invoke` child in nested: child-owned** |
| **16** | **IL-CS-001** | **`invoke` CloseEvent** |
| **17** | **IL-CS-002** | **`invoke` child scope** |
| **18** | **IL-CS-008** | **Only lane has "no Close + shared"** |
| 19 | IL-B-001 | Returns `Operation<T>` |
| 20 | IL-A-001 | Allocator + distinct lane (allocator amendment) |
| 21 | IL-A-006 | Mixed allocator |
| 22 | IL-J-001 | Effects under lane |
| 23 | IL-J-003 | No CloseEvent |
| 24 | IL-R-001 | Pure replay |
| 25 | IL-R-004 | Crash recovery |
| 26 | IL-E-001 | Error as original |
| 27 | IL-V-001 | Invalid call site (no allocator advance) |
| 28 | IL-V-007 | Direct from Fn body |
| 29 | IL-RD-001 | Three-lane replay |
| 30 | IL-CO-014 | Child uses own counter |
| 31 | IL-EX-001 | Crash-replay green |

---

## 21. Coverage Summary

### Conformance-hook coverage

| Hook | Core tests |
|---|---|
| IH1 Allocator (§4.2 amendment) | IL-A-001–006, IL-V-001 |
| IH2 Distinct identity | IL-PI-001, IL-PI-002, IL-J-001, IL-J-002, IL-A-002, IL-NI-001, IL-CO-003 |
| IH3 No CloseEvent | IL-J-003, IL-J-006, IL-E-005, IL-X-001, IL-CS-008, IL-CS-010, IL-NI-002 |
| IH4 No event for call | IL-J-004 |
| IH5 Shared lifetime | IL-PI-001, IL-PI-003, IL-L-001–005, IL-CS-005, IL-CS-007, IL-NI-004 |
| IH6 Primitive-specific | IL-CS-001–010, IL-R-008, IL-E-007, IL-NI-007, IL-CO-005, IL-CO-014 |
| IH7 Replay | IL-PI-002, IL-R-001–008, IL-NI-003, IL-NI-005, IL-CO-009, IL-CO-013 |
| IH8 Error | IL-E-001–007 |
| IH9 Invalid sites (no allocator) | IL-B-003, IL-B-004, IL-B-006, IL-V-001–007 |
| IH10 Composition | IL-A-006, IL-N-001–004 |
| IH11 Replay-dispatch | IL-RD-001–004 |
| IH12 Call-site | IL-V-001–007, IL-NI-006 |
| IH13 Caps + counter | IL-CO-001–014 |
| IH14 Nested MVP | IL-NI-001–007, IL-CS-010, IL-CO-002, IL-CO-006, IL-CO-008 |
| IH15 Scope inside inline | IL-SC-001–024 |

### Tier counts

| Category | Core | Extended | Diagnostic | Total |
|---|---|---|---|---|
| Primary invariant | 3 | 0 | 0 | 3 |
| Basic | 5 | 1 | 0 | 6 |
| Allocator (§4.2 amendment) | 6 | 0 | 0 | 6 |
| Call-site | 6 | 1 | 0 | 7 |
| Capability ownership | 9 | 1 | 0 | 10 |
| Owner counter | 4 | 0 | 0 | 4 |
| Nested inline | 7 | 0 | 0 | 7 |
| Journal | 6 | 0 | 0 | 6 |
| Child semantics | 8 | 2 | 0 | 10 |
| Replay | 8 | 0 | 0 | 8 |
| Ordering | 4 | 0 | 0 | 4 |
| Lifetime | 5 | 0 | 0 | 5 |
| Error | 7 | 0 | 0 | 7 |
| Cancellation | 2 | 0 | 0 | 2 |
| Replay-dispatch | 4 | 0 | 0 | 4 |
| `invoke` regression | 4 | 0 | 0 | 4 |
| Interaction | 5 | 1 | 0 | 6 |
| Scope inside inline body | 22 | 2 | 0 | 24 |
| Existing regression | 4 | 0 | 0 | 4 |
| **Total** | **119** | **8** | **0** | **127** |
