# Tisyn Claude Code Plan Mode — Conformance Test Plan

**Version:** 0.3.4
**Tests:** Tisyn Claude Code Plan Mode Specification v0.2.3
**Status:** Draft

---

### Implementation Status Note

Reviewed against the implementation currently present on
this branch on 2026-04-12. The existing code exercises the
lower-level `claude-code` transport adapter contract, not
the full authored plan-mode surface described by this
conformance plan. As a result, most cases in this plan are
not yet backed by corresponding runtime, compiler, or
conformance-harness coverage on this branch.

---

### Changelog

**v0.3.4** — Initial implementation-ready release.

Validates Tisyn Claude Code Plan Mode Specification v0.2.3.
Covers 48 Core and 18 Extended tests across: session-scoped
capability (single-slot model, slot vacancy timing, fork
fallibility, committed-state snapshot); execution handle;
direct join; supervised consumption; event delivery; replay
(Case B and Case A); fork isolation; and compiler diagnostics.

---

### Coverage Summary

| Category | Core | Extended | Total |
|----------|------|----------|-------|
| Session-scoped capability | 15 | 2 | 17 |
| Execution handle | 4 | 4 | 8 |
| Direct join | 4 | 1 | 5 |
| Supervised consumption | 5 | 2 | 7 |
| Event delivery | 4 | 2 | 6 |
| Replay and durability | 7 | 2 | 9 |
| Fork / branch | 7 | 2 | 9 |
| Compiler diagnostics | 1 | 3 | 4 |
| Transport / lifecycle | 1 | 0 | 1 |
| **Total** | **48** | **18** | **66** |

---

## 1. Overview

This test plan validates the observable behavior defined
by the Tisyn Claude Code Plan Mode Specification v0.2.3.
It covers the session-scoped capability — including the
single-slot execution model (at most one in-flight plan
per session at a time), slot vacancy triggered only after
the child CloseEvent is durably journaled (TD5(a)), fork
during an in-flight execution using the committed
conversational state snapshot rule (SL6, FK2a), fork
failure aftermath semantics (FK2d), the observable-vs-
adapter-internal boundary (OB1–OB2 in spec §1.3a), and
teardown-layer separation — as well as execution handle,
direct join, supervised consumption, event delivery, replay
and durability (Case B stored-result and Case A new-
submission semantics), fork/branch behavior, and compiler
diagnostics.

---

## 2. Relationship to the Specification

This plan maps directly to the Claude Code Plan Mode
Specification v0.2.3. All spec clause IDs are accounted
for in this plan by one of three dispositions: direct test
coverage, explicit deferral, or adapter-internal / out-of-
scope (not validated by a dedicated plan test). The
observable-vs-adapter-internal boundary is defined
normatively in spec §1.3a (OB1–OB2) and governs all
assertions in this plan.

Every MUST-pass entry from the spec's §14.1 table appears
as a Core test. Every SHOULD-pass entry from §14.2 appears
as an Extended test.

Traceability from spec §14 conformance table to this plan:
|------------------|-------------|
| CC-001 | CCPM-001 |
| CC-002 | CCPM-002 |
| CC-003 | CCPM-030 |
| CC-004 | CCPM-051 |
| CC-005 | CCPM-052 |
| CC-006 | CCPM-053 |
| CC-007 | CCPM-054 |
| CC-008 | CCPM-060a |
| CC-009 | CCPM-062 |
| EH-001 | CCPM-010 |
| EH-002 | CCPM-011 |
| DJ-001 | CCPM-015 |
| DJ-002 | CCPM-016 |
| DJ-003 | CCPM-017 |
| DJ-004 | CCPM-018 |
| SV-001 | CCPM-020 |
| SV-002 | CCPM-021 |
| SV-003 | CCPM-022 |
| SV-004 | CCPM-023 |
| SV-005 | CCPM-024 |
| SC-001 | CCPM-012 |
| SC-002 | CCPM-013 |
| SC-003 | CCPM-014 |
| ED-001 | CCPM-025 |
| EV-001 | CCPM-028 |
| EV-002 | CCPM-031 |
| RD-001 | CCPM-032 |
| RD-002 | CCPM-033 |
| FK-001 | CCPM-035 |
| FK-002 | CCPM-036 |
| FK-003 | CCPM-037 |
| FK-004 | CCPM-038 |
| FK-005 | CCPM-060a, CCPM-060b, CCPM-063 |
| FK-006 | CCPM-061 |
| RP-001 | CCPM-057 |
| TW-001 | CCPM-055 |
| CC-010 | CCPM-045 |
| CC-011 | CCPM-046 |
| CC-012 | CCPM-047 |
| CC-013 | CCPM-048 |
| SV-010 | CCPM-041 |
| SV-011 | CCPM-042 |
| FK-010 | CCPM-043 |
| FK-011 | CCPM-056 |
| RD-003 | CCPM-060 |

---

## 3. Scope

### 3.1 What This Plan Covers

- Runtime behavior of `ClaudeCode().open(...)`, `cc.plan(...)`,
  `cc.fork()`, `yield* planned`, and `supervise(planned,
  handler)`
- Single-slot execution model: at most one in-flight plan
  per session at a time; concurrent calls rejected before
  adapter contact
- Slot vacancy triggered only after the child CloseEvent is
  durably journaled (TD5(a)), not on backend completion or
  event-stream close
- Session close as handle release; transport persistence
  across session close; single abort path per execution
- Execution close as distinct from session close
- Fork as a session-derivation operation not blocked by the
  session slot (SL6); fork snapshots the committed
  conversational state at the time of the call (FK2a)
- Fork fallibility: fork failure propagates; parent session,
  slot, and committed state are unchanged (FK2d)
- Observable-vs-adapter-internal boundary per spec §1.3a
  (OB1–OB2): tests MUST NOT assert session IDs, process
  IDs, connection identity, or ACP message internals
- Execution handle restricted-capability rules
- Single-consumer ownership enforcement
- Event delivery contract
- Replay semantics:
  - Case B (stored result): read from journal, no adapter
    contact, result is authoritative and immutable
  - Case A (live frontier): new plan submitted from scratch;
    prior attempt abandoned; result need not equal any prior
    value
- Replay equivalence against fresh adapter instance (Case B)
- Fork isolation, lifetime, independent execution history,
  and committed-state snapshot behavior
- Compiler static enforcement

### 3.2 What This Plan Does Not Cover

- `accept()` operation
- Durable event streaming
- Merge / promote for forked sessions
- Cross-branch communication
- Recursive forking (branch-of-branch)
- Multi-model routing
- Generic ACP abstraction
- Structured output enforcement
- Cost / token budget management
- Transport lifecycle management (§15.10)
- ACP protocol message shapes, stdio framing, session ID
  format — adapter-internal, not asserted in any test

---

## 4. Observability Model

**Tier 1 — Normative observable assertions** (determine
conformance):

- Capability shape returned by `ClaudeCode().open(...)`
  (has `plan` and `fork` methods)
- Capability shape returned by `cc.fork()` (has `plan`,
  not `fork`)
- Result value returned by `yield* planned` or
  `yield* supervise(planned, handler)`
- Event sequences observed through the `supervise` handler
- Error category and propagation behavior (by category,
  not message wording)
- Journal contents (presence/absence of YieldEvents and
  CloseEvents)
- Session capability validity after execution close
- Session capability invalidity after session close
- Subsequent `open()` success after session close (transport
  persistence)
- Session capability validity after `fork()` failure

**Explicitly NOT observable (MUST NOT be asserted in any
conformance test):**

- Session IDs, connection identifiers, or protocol handles
- OS process IDs
- Whether the same transport connection object is reused
- Internal adapter state beyond the normative public surface
- ACP message contents or framing
- The specific result produced by a Case A new live
  submission (it is the new durable result going forward,
  but is not required to equal any prior value)
- Slot-vacancy implementation details such as whether the
  CloseEvent journal write is synchronous or asynchronous
  at the adapter level. Only the sequencing effect is
  normative: `plan()` MUST be rejected before TD5(a)
  completes and MUST be accepted after TD5(a) completes.

The complete positive observable contract is spec §1.3a
(OB1). The complete non-observable list is spec §1.3a (OB2).

**Tier 2 — Reference-harness evidence** (used in the
reference suite; not normative):

- Whether the mock adapter was contacted during replay
- Mock adapter session state for fork isolation tests
- Whether the mock transport received a session-close
  notification
- Abort-signal counter per execution handle (for CCPM-059)

Tests that use Tier 2 evidence label it explicitly as
"*Harness-only evidence*".

---

## 5. Tiers

**Core:** MUST pass. Non-conforming if any Core test fails.

**Extended:** Recommended; not required for initial
conformance.

---

## 6. Test Infrastructure

### 6.1 Mock Claude Code Adapter

All runtime tests use a mock Claude Code adapter. The mock
models the following properties:

**Persistent mock transport.** The mock transport object
persists across session open/close cycles. Session close
releases the handle in the mock transport; it does not
destroy the mock transport.

**Single-slot enforcement.** The mock adapter tracks a
slot (vacant/occupied) per session handle. When `plan()`
is called:
1. If slot is occupied: reject immediately with a
   descriptive error; do NOT spawn a task; do NOT record
   adapter contact.
2. If slot is vacant: occupy slot; spawn task; proceed.
When execution closes (completion, error, cancellation):
vacate slot.

**Fork failure simulation.** `MockClaudeCodeConfig` accepts
a `forkError` field. If set, `fork()` initialization fails
with that error. The parent session handle and slot are
unaffected.

**Abort-signal counter.** The mock tracks the number of
abort signals received per execution handle. Used in
CCPM-059 to verify no duplicate abort is issued.

```typescript
// Reference fixture shape (not normative)
interface MockClaudeCodeConfig {
  events?: Array<{ type: string; data: unknown }>;
  result?: unknown;
  error?: { message: string; name?: string };
  delay?: number;
  hang?: boolean;
  sessionState?: unknown;
  forkError?: { message: string }; // if set, fork() init fails
  // Holds the CloseEvent journal write until the promise
  // resolves. While held, TD5(a) is incomplete and the session
  // slot remains occupied. Used by CCPM-062.
  delayJournal?: { release: () => void; promise: Promise<void> };
  // Count abort signals sent to the adapter per execution (Tier 2)
  trackAbortCount?: boolean;
}
```

### 6.2 Fresh Adapter Instance

For CCPM-057 and CCPM-060, the harness supports
instantiating an independent mock adapter with a
pre-populated journal. The Tier 1 assertion is result
equality (Case B) or result journaling (Case A); adapter
identity is never asserted.

### 6.3 Event Capture

```typescript
// Reference capture shape (not normative)
interface CapturedEvent {
  type: string;
  data: unknown;
  index: number;
}
```

### 6.4 Replay Harness

Supports pre-populating a journal, re-executing the same
workflow IR, tracking mock adapter contact (Tier 2), and
comparing replayed results.

---

## 7. Test Categories and Detailed Matrix

### 7.1 Session-Scoped Capability

**Layer:** Runtime (CCPM-005 Runtime + Adapter; CCPM-049,
CCPM-050, CCPM-055 Runtime + Adapter)

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-001 | Core | `ClaudeCode().open(...)` returns capability with `plan` and `fork` | CC1, §3.1 | Call `open()`. Inspect returned value. | Has callable `plan` and `fork` methods. |
| CCPM-002 | Core | Session close releases handle; transport remains available | CC3, TD1–TD3, TW4 | `open()` in `scoped()`. Exit scope. Call `open()` on same mock transport. | *Tier 1:* First session capability rejected after scope exit. Second `open()` returns valid capability. *Harness-only:* session-close notification received; transport not destroyed. |
| CCPM-003 | Core | Session capability invalid after session close | CC4 | `open()` in `scoped()`. Exit scope. Attempt `plan()` from outside. | Runtime rejects with descriptive error. |
| CCPM-004 | Core | Branch capability follows restricted-capability rules (runtime backstop) | CC8a | Hand-constructed IR passes branch capability in agent effect dispatch. | Runtime rejects. |
| CCPM-049 | Core | Session close does not terminate transport; further open() succeeds | TW4, LO1 | `open()` in `scoped()`. Exit scope. Call `open()` on same mock transport. Plan. | *Tier 1:* Second `open()` plan returns result normally. |
| CCPM-050 | Core | Branch close does not affect parent session or transport | TW5, FK9 | Open, fork in nested scope, exit nested scope, plan on parent. | *Tier 1:* Parent `plan()` returns result normally. |
| CCPM-051 | Core | `plan()` after session close produces descriptive error | SL3 | `open()` in `scoped()`. Exit scope. Attempt `plan()`. | Descriptive error indicating session is closed. |
| CCPM-052 | Core | `fork()` after session close produces descriptive error | SL4 | `open()` in `scoped()`. Exit scope. Attempt `fork()`. | Descriptive error indicating session is closed. |
| CCPM-053 | Core | Concurrent `plan()` rejected before adapter contact | SL5, PL1 | Open session. Dispatch `plan()` with `hang: true` (slot occupied). Immediately dispatch second `plan()`. | *Tier 1:* Second `plan()` throws descriptive error; prior in-flight execution is unaffected and eventually returns its result. *Harness-only:* mock adapter contacted exactly once (first plan only); slot occupied during rejection. |
| CCPM-054 | Core | Session capability remains valid after execution close | TD6(a)–(c) | Open, plan, join. Inspect session. Plan again. | Second `plan()` returns result normally. |
| CCPM-060a | Core | `fork()` failure: error catchable at call site; parent session valid | FK2d(i)–(iv) | Configure mock with `forkError`. Open session. `try { yield* cc.fork() } catch(e) { recordError(e) }`. Then call `plan()` on parent. | *Tier 1:* Error caught by `try/catch`. Parent `plan()` returns result normally (session still valid). No child branch capability produced. |
| CCPM-060b | Core | Failed fork leaves parent committed state unchanged | FK2d(v) | Configure mock with `forkError`. Open session. Plan (result R1) — establishes committed state. Attempt `fork()` — fails. Plan again (result R2). | *Tier 1:* R1 and R2 are both returned normally. The failed fork does not corrupt conversational context visible to subsequent plans. *Harness-only:* mock parent session state unchanged between the two plans. |
| CCPM-061 | Core | `fork()` during in-flight execution: child sees only committed state | SL6, FK2a | Open session. `plan()` with `hang: true` (slot occupied). While plan is in flight, call `fork()`. In the branch, call `plan()`. Release hang on parent. Join both. | *Tier 1:* `fork()` succeeds while parent slot is occupied (SL6). Branch plan result reflects only the committed state at fork time (pre-in-flight history), not any effect of the in-flight parent execution. *Harness-only:* branch mock session state matches parent's committed state snapshot. |
| CCPM-062 | Core | Session slot vacates only after CloseEvent is journaled (TD5(a)) | TD5(a), SL1 | Open session. `plan()` with `delayJournal` set (backend completes but journal write is held). While journal write is held: attempt second `plan()`. Release journal write (TD5(a) completes). Attempt second `plan()` again. | *Tier 1:* Second `plan()` MUST be rejected while journal write is held (slot occupied). Second `plan()` MUST be accepted after journal write is released (slot vacant). |
| CCPM-063 | Core | Failed fork does not affect future `plan()` or `fork()` calls | FK2d(vi) | Configure mock with `forkError`. Open session. Catch fork error. Call `plan()` on parent: succeeds. Call `fork()` on parent: succeeds. Call `plan()` on new branch: succeeds. | *Tier 1:* All three subsequent operations return results normally. The failed fork is inert with respect to future operations. |
| CCPM-005 | Extended | Session reconstructed on replay reflects full execution history | CC5, RP1–RP3 | Execute with session + two sequential plans (results A, B). Pre-populate journal. Replay. | Replay produces A then B. *Harness-only:* mock adapter NOT re-contacted for completed plans; slot tracking shows sequential occupancy, not concurrent. |
| CCPM-006 | Extended | Session configuration passed to adapter | CC9 | `open({ cwd: "/test", model: "test-model" })`. Inspect mock init. | Mock receives configuration values. |

### 7.2 Execution Handle

**Layer:** Runtime

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-010 | Core | `cc.plan(...)` returns an execution handle | EH1 | Call `plan()`. Inspect returned value. | Has `__tisyn_execution` string token. |
| CCPM-011 | Core | Execution handle token is deterministic | EH5–EH7 | Execute same IR twice with same initial state. Compare tokens. | Same token. |
| CCPM-012 | Core | Second consumption rejected: join then join | SC1, SC3 | Create handle. Join. Attempt join again. | "execution handle already consumed." |
| CCPM-013 | Core | Second consumption rejected: supervise then join | SC1, SC3 | Create handle. Supervise. Attempt join after. | "execution handle already consumed." |
| CCPM-014 | Extended | Second consumption rejected: join then supervise | SC1, SC3 | Create handle. Join. Attempt supervise after. | "execution handle already consumed." |
| CCPM-040 | Extended | Unconsumed handle: execution runs; result journaled | SC4 | Create handle. Never consume. Let scope exit. Inspect journal. | Child CloseEvent present with result. |
| CCPM-044 | Extended | Handle token incorporates parent coroutineId | EH7 | Create handles from different parent coroutines. Compare tokens. | Tokens differ; each incorporates its parent coroutineId. |
| CCPM-039 | Extended | Handle cannot cross agent boundary | EH4 | Attempt to pass handle as agent argument. | Runtime rejects. |

### 7.3 Direct Join

**Layer:** Runtime

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-015 | Core | `yield* planned` returns plan's final result | DJ1, DJ2 | Mock with `result: { proposal: "refactor" }`. Plan, join. | Returns `{ proposal: "refactor" }`. |
| CCPM-016 | Core | Join returns immediately if execution already completed | DJ7 | Mock `delay: 0`. Plan, insert delay, join. | Returns immediately with stored result. |
| CCPM-017 | Core | Execution failure propagates through join | DJ3, DJ8 | Mock with `error: { message: "backend error" }`. Plan, join. | Throws "backend error". CloseEvent `status: "err"`. |
| CCPM-018 | Core | Direct join does not observe events | DJ4 | Mock with 3 events + result. Plan, join. No `supervise`. | Returns result. No handler invoked. *Harness-only:* events produced internally, not user-visible. |
| CCPM-019 | Extended | Join waits for slow execution | DJ1, DJ5 | Mock `delay: 200`, `result: { done: true }`. | Join suspends; returns `{ done: true }`. |

### 7.4 Supervised Consumption

**Layer:** Runtime (CCPM-042 Runtime + Adapter)

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-020 | Core | `supervise` returns final result | SV7 | Mock 2 events + `{ ok: true }`. No-op handler. | Returns `{ ok: true }`. |
| CCPM-021 | Core | Handler invoked for each event in order; conforming envelope | EV1, SV5, SV6 | Mock events `[{type:"a",data:{x:1}}, ...]`. Capture invocations. | Invoked 3×; order a,b,c; each has `type` string and `data` field. |
| CCPM-022 | Core | Handler failure cancels execution; session valid | SV9, TD6 | Mock 5 slow events + result. Handler throws on event 2. After `supervise` throws, call `plan()`. | *Tier 1:* `supervise` throws handler error. Subsequent `plan()` returns result normally (session NOT closed; slot vacated). Events 3–5 not delivered. *Harness-only:* execution cancelled; mock session handle open; abort counter = 1. |
| CCPM-023 | Core | Execution failure during supervision propagates | SV10 | Mock 1 event then errors. No-op handler. | `supervise` throws. Handler invoked for event 1 only. |
| CCPM-024 | Core | No-events path returns result immediately | SV11 | Mock `events: []`, `result: { empty: true }`. | Returns `{ empty: true }`. Handler never invoked. |
| CCPM-041 | Extended | Handler may perform `yield*` effects | SV2 | Mock 1 event + result. Handler performs `yield*` effect. | Handler completes. `supervise` returns result. |
| CCPM-042 | Extended | Unknown event types delivered without rejection | EV2 | Mock event `type: "custom_unknown_xyz"`. Handler records. | Handler receives event. No runtime error. `type` and `data` fields intact. |

### 7.5 Event Delivery

**Layer:** Runtime (CCPM-029 Runtime + Adapter)

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-025 | Core | Events before `supervise` are delivered | ED1, ED2 | Mock emits 3 events immediately. Delay before supervise. Capture. | All 3 delivered in order before any live events. |
| CCPM-026 | Core | Backpressure: next event waits for handler | SV5 | Mock emits rapidly. Handler `yield* sleep(50)`. Record timestamps. | Each handler start follows previous handler end. |
| CCPM-028 | Core | Events not in journal after execution | EV4 | Mock 3 events + result. Execute. Inspect journal. | Journal: YieldEvents + CloseEvent only. No event entries. |
| CCPM-029 | Core | Direct-join path discards undrained buffer | ED4 | Mock 3 events + result. Join. Let scope exit. | Returns result. No error from undrained buffer. |
| CCPM-027 | Extended | Event ordering across buffered/live boundary | ED2 | Mock 3 buffered then 3 live. Capture. | Received 1,2,3,4,5,6 in order. |
| CCPM-034 | Extended | Events not preserved across crash/recovery | EV6(a) | Crash before final result. Replay. Supervise with recording handler. | Handler receives zero events from prior attempt. |

### 7.6 Replay and Durability

**Layer:** Runtime (except CCPM-059 which is Runtime +
Adapter: the abort-counter assertion in its expected column
is Tier 2 harness evidence, but the Tier 1 assertion —
execution is cancelled and session is torn down — is Runtime)

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-030 | Core | Replay reconstructs session capability at same program point | CC5, RD5(B), RP1–RP3 | Pre-populate journal with session init + two sequential plan results. Replay same IR. | Replay produces same capability. Both results from journal. *Harness-only:* mock adapter NOT re-contacted; slot tracking shows sequential occupancy. |
| CCPM-031 | Core | Events not produced during replay (Case B) | EV5, RD5(B) | Pre-populate journal with complete execution. Replay. Supervise. | Handler never invoked. Result from journal. *Harness-only:* no event-producing execution occurred. |
| CCPM-032 | Core | Final result journaled as child CloseEvent | PL9, RD1 | Execute plan to completion. Inspect journal. | CloseEvent under child coroutineId with `status: "ok"` and result value. |
| CCPM-033 | Core | Replay Case B: stored result returned without re-execution | RD5(B), EH8, RP6 | Pre-populate journal with plan CloseEvent. Replay. | Stored result returned. Handle reconstructed at same program point. *Harness-only:* mock NOT contacted. |
| CCPM-057 | Core | Replay Case B: equivalent result against fresh adapter instance | RP2, RP6 | Execute with adapter A; record journal. Replay with fresh adapter B (no prior state) using same journal. | *Tier 1:* Adapter B returns same final result as recorded in journal. Session IDs, connection IDs, adapter object identity NOT asserted. *Harness-only:* adapter B NOT contacted for the plan (result comes from journal). |
| CCPM-059 | Core | Session close causes exactly one execution-abort at adapter | TD2, TD2f | Open session. `plan()` with `hang: true`. Exit session scope before completion. | *Tier 1:* Execution is cancelled; session capability is torn down. *Harness-only:* mock adapter abort-signal counter for the execution = 1 (not 0, not 2+). |
| CCPM-060 | Core | Replay Case A: new plan submitted; prior attempt abandoned; new result journaled | RD5(A), RP4, RP5(e) | Pre-populate journal with session init + plan dispatch YieldEvents but NO plan CloseEvent. Configure fresh mock with `result: X`. Replay. | *Tier 1:* Replay reaches live frontier. New plan submitted. Result X journaled as new CloseEvent. *Harness-only:* mock adapter IS contacted for new submission; no prior-attempt events delivered; prior attempt events are NOT reproduced. |
| CCPM-034b | Extended | Case A replay: new plan independent of prior attempt | RD5(A), RP4, RP5 | Same setup as CCPM-060 with `result: Y` (Y ≠ any prior value). | *Tier 1:* Y journaled as new durable result. No assertion that Y equals any prior value. *Harness-only:* mock contacted; transport NOT restarted. |
| CCPM-034c | Extended | Case A replay does not restart transport process | RP4, TW1 | Same setup as CCPM-060. After replay completes, call `open()` on same mock transport. | *Tier 1:* Second `open()` returns valid capability. Transport not terminated during replay. |

### 7.7 Fork / Branch

**Layer:** Runtime

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-035 | Core | `cc.fork()` returns `ClaudeCodeBranch` with `plan` not `fork` | FK3, FK10 | Call `fork()`. Inspect returned value. | Has `plan`. Does NOT have `fork`. |
| CCPM-036 | Core | Branch planning does not mutate parent state | FK4, FK2a–FK2b | Open, fork, plan on branch (X), plan on parent (Y). | Parent result reflects Y context only. *Harness-only:* parent session state excludes branch history. |
| CCPM-037 | Core | Parent planning does not mutate branch state | FK5, FK2a | Open, fork, plan on parent (X), plan on branch (Y). | Branch result reflects pre-fork context + Y. *Harness-only:* branch state excludes post-fork parent history. |
| CCPM-038 | Core | Branch close releases branch session; parent and transport unaffected | FK9, TW5, TD1–TD3 | Open, fork in nested scope, exit nested scope, plan on parent. | *Tier 1:* Parent `plan()` returns result normally. *Harness-only:* parent session handle active; transport not destroyed. |
| CCPM-035b | Core | Branch lifetime bounded by enclosing scope | FK7, FK8 | Open, fork in `scoped()`, exit scope, attempt to use branch. | Attempt to use branch results in error. |
| CCPM-056 | Core | Fork produces independent execution history | FK4, FK5 | Open, plan parent (PA), fork, plan branch (BA), plan parent again (PA2). | BA excludes PA2 context. PA2 excludes BA context. Both derived from pre-fork state. |
| CCPM-058 | Core | `fork()` failure propagates; parent session remains valid | FK2d | Configure mock with `forkError`. Attempt `yield* cc.fork()`. After failure, call `plan()` on parent. | *Tier 1:* `fork()` throws. Parent `plan()` returns result normally. Parent session NOT closed. Parent slot unaffected. |
| CCPM-043 | Extended | Multiple forks from same parent are independent | FK6 | Fork twice. Plan differently on each. | Each branch has independent state. |
| CCPM-043b | Extended | Fork replay reconstructs branch capability | FK11, FK12 | Execute with fork + branch plan. Pre-populate journal. Replay. | Branch capability reconstructed. Branch plan result from journal. |

### 7.8 Compiler Diagnostics

**Layer:** Compiler

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-048 | Core | Compiler warns on unconsumed handle | SC4 | Source creates handle but never consumes. | Warning diagnostic emitted. |
| CCPM-045 | Extended | Compiler rejects handle passed as agent argument | EH4 | Source passes handle as agent argument. | Compiler rejects; diagnostic identifies EH4. |
| CCPM-046 | Extended | Compiler rejects handle returned from workflow | EH4 | Source returns handle. | Compiler rejects; diagnostic identifies EH4. |
| CCPM-047 | Extended | Compiler rejects handle stored in object | EH4 | Source stores handle in object literal. | Compiler rejects; diagnostic identifies EH4. |

### 7.9 Transport / Lifecycle

**Layer:** Runtime + Adapter

| ID | Tier | Description | Spec ref | Setup | Expected |
|----|------|-------------|----------|-------|----------|
| CCPM-055 | Core | Multiple sequential sessions share the configured transport | TW1, LO1, SL1–SL2 | Instantiate mock transport. Open session 1, plan, close. Open session 2, plan, close. | *Tier 1:* Both plans return results normally. Session 2 succeeds without reinitializing mock transport. Session IDs and connection identity NOT asserted. |

---

## 8. Layer Summary

| Layer | Core tests | Extended tests | Total |
|-------|-----------|---------------|-------|
| Runtime | 42 | 13 | 55 |
| Runtime + Adapter | 5 | 2 | 7 |
| Compiler | 1 | 3 | 4 |
| **Total** | **48** | **18** | **66** |

> **Non-observable properties note.** Tests MUST NOT assert
> session IDs, process IDs, connection object identity, or
> ACP message contents. All Tier 1 assertions use only:
> returned values, capability shape, event sequences, error
> categories, journal contents, session validity, and slot
> state (vacant/occupied).

> **Single-slot topology note.** Tests MUST NOT assume or
> imply multiple concurrent execution children under one
> session. The topology is: one slot per session, one
> execution in the slot at a time, sequential history only.
> Replay tests that pre-populate two plan results in the
> journal represent two sequential executions (A completed,
> slot vacated, B dispatched), not concurrent siblings.

---

## 9. Acceptance Criteria

The Claude Code Plan Mode implementation is conforming when:

1. All 48 Core tier tests pass:
   CCPM-001, CCPM-002, CCPM-003, CCPM-004,
   CCPM-010, CCPM-011, CCPM-012, CCPM-013,
   CCPM-015, CCPM-016, CCPM-017, CCPM-018,
   CCPM-020, CCPM-021, CCPM-022, CCPM-023, CCPM-024,
   CCPM-025, CCPM-026, CCPM-028, CCPM-029,
   CCPM-030, CCPM-031, CCPM-032, CCPM-033,
   CCPM-035, CCPM-035b, CCPM-036, CCPM-037, CCPM-038,
   CCPM-048, CCPM-049, CCPM-050, CCPM-051, CCPM-052,
   CCPM-053, CCPM-054, CCPM-055, CCPM-056, CCPM-057,
   CCPM-058, CCPM-059, CCPM-060, CCPM-060a, CCPM-060b,
   CCPM-061, CCPM-062, CCPM-063.

2. No Core tier test produces an unexpected error, hang,
   or crash.

3. The mock adapter is sufficient for all Core tier tests.
   No real Claude Code backend is required.

4. Journal assertions use YieldEvents and CloseEvents only.

5. Replay Case B is Core. Replay Case A (CCPM-034b) is
   Extended and recommended but not required for initial
   conformance.

6. No test asserts on session IDs, process IDs, or
   connection object identity.

---

## 10. Deferred / Future Tests

| Area | Reason |
|------|--------|
| `accept()` operation | Deferred (§15.1) |
| Durable event streaming | Deferred (§15.2) |
| Merge / promote for branches | Deferred (§15.3) |
| Cross-branch communication | Deferred (§15.4) |
| Recursive forking | Deferred (§15.5, FD4) |
| Multi-model routing | Deferred (§15.6) |
| Structured output enforcement | Deferred (§15.8) |
| Cost / token budget management | Deferred (§15.9) |
| Transport lifecycle management | Deferred (§15.10) |
| Compiler single-consumer exhaustiveness across `if` | SC5 deferred |
| Compiler `let` reassignment enforcement | EH4 partial, deferred |
| Transport-level reconnection recovery | TD9 adapter-internal, deferred |

---

## 11. Spec Clause Coverage

| Spec clause | Test IDs | Coverage |
|-------------|----------|----------|
| CC1 | CCPM-001 | Core |
| CC3 | CCPM-002, CCPM-049 | Core |
| CC4 | CCPM-003, CCPM-051 | Core |
| CC5 | CCPM-005, CCPM-030 | Extended, Core |
| CC6–CC7 | CCPM-004 (via CC8a) | Core |
| CC8a | CCPM-004 | Core |
| CC9 | CCPM-006 | Extended |
| CC10–CC11 | CCPM-001 | Core |
| OB1–OB2 | §4 observability model; all tests bound by this | — |
| SL1 | CCPM-053, CCPM-054, CCPM-062 | Core |
| SL2 | CCPM-054, CCPM-005 | Core, Extended |
| SL3 | CCPM-051 | Core |
| SL4 | CCPM-052 | Core |
| SL5 | CCPM-053 | Core |
| SL6 | CCPM-061 | Core |
| LO1 | CCPM-049, CCPM-055 | Core |
| LO2 | CCPM-022, CCPM-054 | Core |
| LO3 | CCPM-022 | Core |
| LO4 | CCPM-038, CCPM-050 | Core |
| EH1 | CCPM-010 | Core |
| EH4 | CCPM-039, CCPM-045–047 | Extended |
| EH5–EH7 | CCPM-011, CCPM-044 | Core, Extended |
| EH8–EH9 | CCPM-033 | Core |
| EH10 | CCPM-012, CCPM-013 | Core |
| SC1, SC3 | CCPM-012–014 | Core, Extended |
| SC4 | CCPM-040, CCPM-048 | Extended, Core |
| SC5 | Deferred | — |
| SC6 | CCPM-012, CCPM-013 | Core |
| DJ1–DJ2 | CCPM-015 | Core |
| DJ3 | CCPM-017 | Core |
| DJ4 | CCPM-018 | Core |
| DJ5 | CCPM-019 | Extended |
| DJ7 | CCPM-016 | Core |
| DJ8 | CCPM-017 | Core |
| SV1–SV3 | CCPM-041 | Extended |
| SV5 | CCPM-021, CCPM-026 | Core |
| SV6 | CCPM-021 | Core |
| SV7 | CCPM-020 | Core |
| SV8 | CCPM-013 | Core |
| SV9 | CCPM-022 | Core |
| SV10 | CCPM-023 | Core |
| SV11 | CCPM-024 | Core |
| SV12–SV13 | CCPM-042 (partial) | Extended |
| ED1–ED2 | CCPM-025, CCPM-027 | Core, Extended |
| ED3 | CCPM-025 | Core |
| ED4 | CCPM-029 | Core |
| ED5 | Not tested (future) | — |
| EV1 | CCPM-021 | Core |
| EV2 | CCPM-042 | Extended |
| EV3 | CCPM-021 | Core |
| EV4 | CCPM-028 | Core |
| EV5 | CCPM-031 | Core |
| EV6 | CCPM-034, CCPM-029 | Extended, Core |
| EV7 | CCPM-028 | Core |
| EV8–EV9 | Adapter-internal | — |
| PL1 | CCPM-053 | Core |
| PL2–PL3 | CCPM-015, CCPM-018, CCPM-053 | Core |
| PL3(d) | CCPM-062 | Core |
| PL4 | CCPM-022 (via TD6) | Core |
| PL5 | CCPM-015 | Core |
| PL8–PL9 | CCPM-032 | Core |
| PL10 | CCPM-028 | Core |
| FK1 | CCPM-035, CCPM-061 | Core |
| FK2, FK2a | CCPM-036, CCPM-037, CCPM-056, CCPM-061 | Core |
| FK2b | CCPM-036, CCPM-037, CCPM-060b | Core |
| FK2c | Not tested (adapter-internal) | — |
| FK2d(i)–(iv) | CCPM-060a | Core |
| FK2d(v) | CCPM-060b | Core |
| FK2d(vi) | CCPM-063 | Core |
| FK2e | §4 observability constraint | — |
| FK3 | CCPM-035 | Core |
| FK4 | CCPM-036, CCPM-056 | Core |
| FK5 | CCPM-037, CCPM-056 | Core |
| FK6 | CCPM-043 | Extended |
| FK7–FK8 | CCPM-035b | Core |
| FK9 | CCPM-038, CCPM-050 | Core |
| FK10 | CCPM-035 | Core |
| FK11–FK12 | CCPM-043b | Extended |
| FK13 | CCPM-043b (partial) | Extended |
| RD1 | CCPM-032 | Core |
| RD2 | CCPM-028, CCPM-031 | Core |
| RD3–RD4 | CCPM-028 | Core |
| RD5(A) | CCPM-060, CCPM-034b | Core, Extended |
| RD5(B) | CCPM-033 | Core |
| RD6 | CCPM-033, CCPM-011 | Core |
| RD7 | CCPM-033 | Core |
| RP1 | CCPM-030, CCPM-057 | Core |
| RP2 | CCPM-057 | Core |
| RP3 | CCPM-011, CCPM-033 | Core |
| RP4 | CCPM-060, CCPM-034b | Core, Extended |
| RP5 | CCPM-034, CCPM-060 | Extended, Core |
| RP6 | CCPM-033, CCPM-057 | Core |
| TD1–TD3 | CCPM-002, CCPM-049, CCPM-051, CCPM-052 | Core |
| TD2f | CCPM-059 | Core |
| TD4–TD6 | CCPM-022, CCPM-054, CCPM-062 | Core |
| TD5(a) | CCPM-062 | Core |
| TD7–TD9 | Adapter-internal; CCPM-034c (Extended) | — |
| TW1 | CCPM-049, CCPM-055 | Core |
| TW2 | CCPM-002, CCPM-022, CCPM-038 | Core |
| TW3 | Adapter-internal | — |
| TW4 | CCPM-002, CCPM-049 | Core |
| TW5 | CCPM-038, CCPM-050 | Core |
