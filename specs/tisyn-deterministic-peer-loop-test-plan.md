# Tisyn Deterministic Peer Loop Test Plan

**Version:** 0.1.0
**Tests:** Tisyn Deterministic Peer Loop Specification v0.1.0
**Style reference:** Tisyn Code Agent Test Plan, Tisyn
Scoped Effects Test Plan, Tisyn Timebox Test Plan
**Status:** Draft

---

### Changelog

**v0.1.0** — Initial release. Defines the conformance test
plan for the deterministic peer-loop example. Covers all
thirteen normative invariants (LOOP-CTRL-1, LOOP-GATE-1/2,
LOOP-STEP-1, LOOP-OVERRIDE-1, LOOP-ALT-1, LOOP-RESULT-1,
LOOP-MODE-1, LOOP-DONE-1, LOOP-PERSIST-1, M2-CAP-1,
M2-EXEC-1, M2-EXEC-2), the cycle algorithm in §7.2,
type-shape conformance for all persisted records, timebox
composition for the optional Taras gate, capability
baseline enforcement, `requestedEffects` disposition
across all four terminal dispositions, and replay
conformance under the journal-authoritative source-of-truth
model. Preserves three ambiguity-surface findings outside
the normative matrix.

Post-review targeted amendments applied in this same v0.1.0
cut: DPL-EXEC-04 moved to Extended (the spec's SHOULD-level
gate-presentation guidance is not Core-enforceable) with a
new Core DPL-EXEC-10 covering the `"surfaced_to_taras"`
disposition at the record level; replay fixtures purged of
`expected_recursive_state` to honor the observable-only
observability model; DPL-CAP-01 / DPL-CAP-02 rewritten to
assert the actual invariant (no mutating action, no
filesystem mutation) rather than a specific conversational
response style; DPL-GATE-05 moved to Extended because its
assertion lives closer to authored-shape than to
loop-level observable behavior.

---

## 1. Overview

### 1.1 Purpose

This document defines the conformance test plan for the
Tisyn Deterministic Peer Loop Specification v0.1.0. It is
the test-planning companion to that specification. Every
test scenario traces to a specific section of the spec.
This plan does not add, remove, or modify normative
requirements; the specification is the authority.

### 1.2 Relationship to the Specification

The deterministic peer-loop specification is the normative
source of truth. This test plan validates observable
behavior required by the sections governing the cycle
algorithm, the peer-turn contract, persistence semantics,
and the capability baseline.

If this plan conflicts with the specification, the
specification governs.

### 1.3 Observability Model

All tests compare observable outputs only:

- **Workflow tests:** compare the sequence and content of
  agent operation dispatches (App, DB, OpusAgent,
  GptAgent) against expected sequences, using canonical
  JSON equality.
- **Persistence tests:** compare the final state of the
  four DB-persisted record collections (`TurnEntry`,
  `PeerRecord`, `EffectRequestRecord`, `LoopControl`)
  against expected states.
- **Replay tests:** on restart from a captured journal,
  verify that the next live dispatch and any asserted
  post-replay observable consequences match those of an
  uninterrupted run. `RecursiveState` is not inspected
  directly.
- **Capability-baseline tests:** verify that peer wrappers
  refuse or prevent backend-native mutating tool actions
  through their configured adapters. Verification is
  black-box: the test confirms the adapter configuration
  is applied, not specific SDK flag wiring.

No test depends on peer reasoning quality, model output
content (beyond stable fixture-driven assertions), adapter
internal topology, or the concrete wire format of the DB's
persistence layer.

### 1.4 Tiers

**Core:** Tests that every conforming implementation of the
deterministic peer loop MUST pass. An implementation is
non-conforming if any Core test fails.

**Extended:** Tests for edge cases, boundary conditions,
browser-UI behavior stability, and diagnostic quality.
Recommended but not required for initial conformance.

### 1.5 Conformance Target

The conformance target is the forked example at
`examples/deterministic-peer-loop`, specifically:

- the workflow's compiled cycle body
- the App agent's extended surface (§4.1 of the spec)
- the DB agent's extended surface (§4.2)
- the OpusAgent and GptAgent peer wrappers (§4.3, §4.4)

The conformance target is **not** the Tisyn kernel,
runtime, compiler, `@tisyn/effects`, or any adapter
profile. Those have their own conformance boundaries.

---

## 2. Scope

### 2.1 In Scope

- Cycle algorithm step ordering (spec §7.2)
- All thirteen normative invariants (spec §6.1–§6.13)
- Persisted record schemas (spec §5)
- Timebox composition for the optional Taras gate
  (spec §6.3, §7.2 Step 1)
- `PeerTurnResult` structure and status-driven branching
- `LoopControl` state observation and mutation via
  browser/app substrate
- Speaker alternation and one-shot override
- Capability baseline enforcement (spec §6.11)
- `requestedEffects` four-disposition lifecycle
  (spec §6.12, §6.13)
- Single-record lifecycle for `EffectRequestRecord`
- Journal-authoritative replay behavior for the loop
- Termination via `status === "done"` and via
  `LoopControl.stopRequested`

### 2.2 Non-Goals

- Peer reasoning quality or model output content beyond
  stable fixtures
- Specific SDK flag wiring used to realize the capability
  baseline (tested black-box)
- The internal implementation of `@tisyn/effects` (covered
  by its own test plan)
- The baseline effect catalog accepted by `@tisyn/effects`
  (covered by the separate effects-spec test plan)
- Browser UI rendering details (beyond observing
  `showMessage` dispatches)
- Concrete file format used by the DB agent's persistence
- Custom-agent behavior beyond the two MVP peers
- Track A `PromptResult.usage` end-to-end semantics
  (covered by the Code Agent test plan amendment when it
  lands; this plan only verifies that `usage` fields are
  tolerated and passed through)

### 2.3 Explicit Non-Tests

The following behaviors are specified as deferred or as
implementation-defined by the spec. No conformance test is
written for them in this plan:

- `PeerTurnResult.data` taxonomy beyond Val-serializability
  (spec OQ-W1)
- Divergent per-agent peer contracts (spec OQ-W2)
- Peer-wrapper parsing strategy (spec OQ-P1): tests verify
  the `PeerTurnResult` shape the wrapper returns, not how
  it parsed it
- User-directed revert-to-prior-stream-position (spec §10.4)
- Cumulative-usage termination predicates
  (spec OQ-L2, pending Track A)
- Browser UI rendering details
- Specific peer prompt construction

---

## 3. Ambiguity Surface

During derivation, three spec passages could not be turned
into concrete Core tests and are preserved here as design
records per the Tisyn test-plan process. These are NOT
part of the normative matrix below.

- **AMB-DPL-1** — **Peer-wrapper parsing strategy
  (OQ-P1).** The spec intentionally does not normative the
  mechanism by which peer wrappers derive
  `PeerTurnResult` from underlying backend text. The plan
  verifies the returned structure, not the parser. If a
  peer wrapper uses prompt-engineered sentinels (MVP), the
  sentinel format is not test-observable; only the returned
  `PeerTurnResult` shape is.

- **AMB-DPL-2** — **Capability baseline enforcement
  mechanism (§6.11).** The spec declares that peers MUST
  operate without direct access to nondeterministic
  mutating tools, but treats the specific SDK configuration
  as an implementation concern. The plan therefore tests
  the *observable result* (a peer wrapper refuses or
  prevents mutating actions when presented with a scenario
  that would require them), not the concrete adapter flag
  values (e.g., Claude Code `permissionMode: "plan"`,
  Codex `sandbox: "read-only"`). If a future spec revision
  names specific flags, AMB-DPL-2 is retired.

- **AMB-DPL-3** — **Per-effect disposition policy
  (§6.12).** The spec declares that workflow policy governs
  the choice between `"executed"`, `"deferred"`,
  `"rejected"`, and `"surfaced_to_taras"`, but does not fix
  one policy for all effects. The plan therefore tests each
  disposition outcome under a scenario that deterministically
  triggers it (unknown effect ID forces `"rejected"`, and
  so on), not the policy itself. A future amendment MAY
  specify a default policy; this plan will then extend
  accordingly.

---

## 4. Fixture Schema

### 4.1 Workflow Fixture

```typescript
interface PeerLoopFixture {
  id: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "peer_loop_workflow";

  // Initial state
  initial_transcript?: TurnEntry[];
  initial_control?: LoopControl;
  initial_peer_records?: PeerRecord[];
  initial_effect_requests?: EffectRequestRecord[];

  // Scripted inputs
  taras_inputs: Array<
    | { at_turn: number; message: string }
    | { at_turn: number; timeout: true }
  >;
  control_mutations?: Array<{
    at_turn: number;
    patch: Partial<LoopControl>;
  }>;
  peer_scripts: {
    opus: PeerTurnResult[];
    gpt: PeerTurnResult[];
  };

  // Effect dispositions (scripted by test harness)
  effect_policy?: Record<string, {
    disposition: Disposition;
    result?: Val;
    error?: { name: string; message: string };
  }>;

  // Expected observations
  expected_operations: OperationCall[];
  expected_transcript: TurnEntry[];
  expected_peer_records: PeerRecord[];
  expected_effect_requests: EffectRequestRecord[];
  expected_final_control: LoopControl;
  expected_exit_reason?: string;
}
```

### 4.2 Replay Fixture

```typescript
interface PeerLoopReplayFixture {
  id: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "peer_loop_replay";

  // Journal prefix produced by a previous live run
  journal_prefix: JournalEvent[];

  // Expected next observable dispatch after replay
  expected_next_operation: OperationCall;

  // Optional additional expected observable effects
  // (subsequent dispatches, persisted records after one
  // more cycle, etc.) depending on the scenario
  expected_subsequent_operations?: OperationCall[];
  expected_post_replay_records?: {
    transcript?: TurnEntry[];
    peer_records?: PeerRecord[];
    effect_requests?: EffectRequestRecord[];
    control?: LoopControl;
  };
}
```

Replay fixtures assert only on observable dispatches and
their observable consequences. `RecursiveState` is
workflow-internal per the spec; replay conformance is
verified by observing that the next live dispatch after
replay matches the dispatch an uninterrupted run would
produce, not by inspecting reconstructed internal state.

### 4.3 Observable-Operation Record

```typescript
type OperationCall =
  | { agent: "App"; op: "elicit"; args: { message: string };
      wrapped_in_timebox?: { ms: number } }
  | { agent: "App"; op: "showMessage"; args: { speaker; content } }
  | { agent: "App"; op: "loadChat"; args: { messages } }
  | { agent: "App"; op: "readControl"; args: Record<string, never> }
  | { agent: "App"; op: "setReadOnly"; args: { reason } }
  | { agent: "DB"; op: string; args: Val }
  | { agent: "OpusAgent" | "GptAgent"; op: "takeTurn";
      args: { input: PeerTurnInput } };
```

Tests assert on the sequence of `OperationCall` values
captured by an instrumented harness, not on adapter-internal
state.

---

## 5. Test Categories

| ID prefix | Category | Spec section |
|---|---|---|
| DPL-GATE | Taras gate + timebox composition | §6.2, §6.3, §7.2 Step 1 |
| DPL-CTRL | Control-state re-read and observation | §6.1, §7.2 Step 2–4 |
| DPL-STEP | Single-peer-step-per-cycle | §6.4, §7.2 Step 6 |
| DPL-OVR | One-shot speaker override | §6.5, §7.2 Step 5 |
| DPL-ALT | Default speaker alternation | §6.6 |
| DPL-RES | Structured peer-result requirement | §6.7, §7.2 Step 6 |
| DPL-MODE | Deterministic `tarasMode` transition | §6.8 |
| DPL-DONE | Loop termination on `done` | §6.9, §7.2 Step 9 |
| DPL-PER | Per-turn persistence | §6.10, §7.2 Step 7 |
| DPL-CAP | Capability baseline | §6.11, §4.3, §4.4 |
| DPL-EXEC | `requestedEffects` disposition lifecycle | §6.12, §6.13, §7.2 Step 8 |
| DPL-INIT | Initial-state reconstruction | §7.1 |
| DPL-RPL | Replay semantics | §7.3 |
| DPL-TYPE | Type-shape conformance for persisted records | §5 |

---

## 6. Test Matrix

### 6.1 DPL-GATE — Taras gate + timebox composition

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-GATE-01 | Core | §6.3 (required mode) | When `tarasMode === "required"`, the Taras gate dispatches `App.elicit({ message })` directly. No `timebox` wraps it. |
| DPL-GATE-02 | Core | §6.3 (optional mode, completed) | When `tarasMode === "optional"` and Taras sends input before the deadline, `timebox` returns `{ status: "completed", value }` with `value` equal to the Taras message. Workflow branches on the tag and persists the message. |
| DPL-GATE-03 | Core | §6.3 (optional mode, timeout) | When `tarasMode === "optional"` and the deadline elapses with no input, `timebox` returns `{ status: "timeout" }`. Workflow proceeds to Step 2 without persisting a Taras turn. |
| DPL-GATE-04 | Core | §6.3 + Timebox TB-S1 | Timeout MUST NOT trigger a thrown error caught by `try/catch` around the gate. A conforming workflow does not use `try/catch` to observe the timeout path. |
| DPL-GATE-05 | Extended | §6.3 + Timebox §5.2 | When the gate timeout is sourced from configuration via an effect, the workflow binds it in a prior statement-position `yield*` before passing to `timebox`. Extended because the test asserts on dispatch ordering between the configuration-read effect and the `timebox`-wrapped elicit, which is closer to authored-shape conformance than to loop behavior. |
| DPL-GATE-06 | Extended | §6.3 | Gate timeout default is 180000 ms when no configuration is supplied. |
| DPL-GATE-07 | Extended | §6.3 | Configurable override: a test-configured `timeoutMs` value drives the `timebox` duration observed. |

### 6.2 DPL-CTRL — Control-state re-read

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-CTRL-01 | Core | §6.1, §7.2 Step 2 | Before every non-Taras peer dispatch the workflow calls `App.readControl()` in the same cycle. |
| DPL-CTRL-02 | Core | §6.1, §7.2 Step 3 | If `stopRequested === true`, the workflow calls `App.setReadOnly(...)` and returns without dispatching a peer step. |
| DPL-CTRL-03 | Core | §6.1, §7.2 Step 4 | If `paused === true`, the workflow does not dispatch a peer step this cycle; it recurses with `tarasMode === "optional"`. |
| DPL-CTRL-04 | Core | §6.1 | A control value read on an earlier cycle is NOT used to gate a later cycle. Each cycle re-reads. |
| DPL-CTRL-05 | Extended | §6.1 | When both `paused` and `stopRequested` are true, `stopRequested` wins (stop precedes pause). |

### 6.3 DPL-STEP — Single-peer-step-per-cycle

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-STEP-01 | Core | §6.4 | A non-paused, non-stopped cycle dispatches exactly one peer step (either `OpusAgent.takeTurn` or `GptAgent.takeTurn`). |
| DPL-STEP-02 | Core | §6.4 | A paused cycle dispatches zero peer steps. |
| DPL-STEP-03 | Core | §6.4 | A stopped cycle dispatches zero peer steps. |
| DPL-STEP-04 | Core | §6.4 | No cycle dispatches two peer steps. Violated if a test harness observes two `takeTurn` calls in a single cycle. |

### 6.4 DPL-OVR — One-shot speaker override

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-OVR-01 | Core | §6.5, §7.2 Step 5 | When `LoopControl.nextSpeakerOverride === "gpt"` and default alternation would select `"opus"`, the peer dispatched is `GptAgent`. |
| DPL-OVR-02 | Core | §6.5 | After an override is consumed, `LoopControl.nextSpeakerOverride` is cleared via `DB.writeControl(...)` in the same cycle. |
| DPL-OVR-03 | Core | §6.5 | A subsequent cycle (absent new override) selects the speaker per default alternation, not per the stale prior override. |
| DPL-OVR-04 | Core | §6.5 | An override equal to the default alternation target still clears after consumption (no special case). |

### 6.5 DPL-ALT — Default speaker alternation

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-ALT-01 | Core | §6.6 | First peer step (absent override) dispatches `OpusAgent` when initial `nextSpeaker === "opus"`. |
| DPL-ALT-02 | Core | §6.6 | After an Opus step (no override), `nextSpeaker` toggles to `"gpt"`. |
| DPL-ALT-03 | Core | §6.6 | After a Gpt step (no override), `nextSpeaker` toggles to `"opus"`. |
| DPL-ALT-04 | Core | §6.6 | `nextSpeaker` toggling happens regardless of the peer step's `status` outcome. |

### 6.6 DPL-RES — Structured peer result

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-RES-01 | Core | §6.7 | Every observed peer step returns a `PeerTurnResult` with required fields `display: string` and `status: "continue" \| "needs_taras" \| "done"`. |
| DPL-RES-02 | Core | §6.7 | The workflow's control decisions are driven by `PeerTurnResult.status`, not by raw `display` text. Verified by scripting a peer whose `display` contains the literal substring `"done"` but whose `status === "continue"`: workflow MUST NOT terminate. |
| DPL-RES-03 | Core | §6.7 + §5.6 | `data?`, when present, is a Val (JSON-serializable). Non-Val values are rejected at the peer-wrapper boundary. |
| DPL-RES-04 | Core | §6.7 + §5.6 | `requestedEffects?`, when present, is a readonly array of `RequestedEffect`. Each entry has `id: string` and `input: Val`. |

### 6.7 DPL-MODE — `tarasMode` transition

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-MODE-01 | Core | §6.8 | After a peer step with `status === "needs_taras"`, the next cycle's `tarasMode === "required"`. |
| DPL-MODE-02 | Core | §6.8 | After a peer step with `status === "continue"`, the next cycle's `tarasMode === "optional"`. |
| DPL-MODE-03 | Core | §6.8 | After a peer step with `status === "done"`, the loop exits; `tarasMode` for a subsequent cycle is not observed (no subsequent cycle). |
| DPL-MODE-04 | Core | §6.8 | `tarasMode` is NOT influenced by `LoopControl` content, transcript content, or any source other than the most recent `PeerTurnResult.status`. |

### 6.8 DPL-DONE — Termination on `done`

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-DONE-01 | Core | §6.9 | On `status === "done"`, the workflow persists the turn (both `TurnEntry` and `PeerRecord`) before exiting. |
| DPL-DONE-02 | Core | §6.9 | On `status === "done"`, any `requestedEffects` on that turn are disposed per §6.12 before exit. |
| DPL-DONE-03 | Core | §6.9 | On `status === "done"`, `App.setReadOnly("done")` is dispatched. |
| DPL-DONE-04 | Core | §6.9 | No further cycles execute after a `done` termination. |

### 6.9 DPL-PER — Per-turn persistence

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-PER-01 | Core | §6.10, §7.2 Step 7 | Every peer step persists exactly one `TurnEntry` via `DB.appendMessage` with `speaker` matching the dispatched peer. |
| DPL-PER-02 | Core | §6.10 | The persisted `TurnEntry.content` equals `PeerTurnResult.display`. |
| DPL-PER-03 | Core | §6.10 | Every peer step persists exactly one `PeerRecord` via `DB.appendPeerRecord` with matching `turnIndex`, `speaker`, `status`, `data`. |
| DPL-PER-04 | Core | §6.10 | Every Taras-origin message at the gate persists exactly one `TurnEntry` with `speaker: "taras"`. |
| DPL-PER-05 | Core | §6.10 | No `PeerRecord` is written for Taras-origin messages. |
| DPL-PER-06 | Core | §5.1 | When `PeerTurnResult.usage` is absent, the persisted `TurnEntry.usage` is also absent. When present, it is copied through unchanged. |
| DPL-PER-07 | Core | §6.10 | `App.showMessage({ speaker, content })` dispatches for every persisted message, both Taras-origin and peer-origin. |

### 6.10 DPL-CAP — Capability baseline

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-CAP-01 | Core | §6.11, §4.3 | `OpusAgent.takeTurn` operates under the capability baseline: over the course of a full turn, no filesystem mutation occurs and no backend-native mutating tool action is performed. The turn completes by returning a `PeerTurnResult` through the wrapper contract. No conformance claim is made about the specific conversational strategy the peer uses to stay within the baseline. |
| DPL-CAP-02 | Core | §6.11, §4.4 | `GptAgent.takeTurn` operates under the capability baseline: over the course of a full turn, no filesystem mutation occurs and no backend-native mutating tool action is performed. The turn completes by returning a `PeerTurnResult` through the wrapper contract. No conformance claim is made about the specific conversational strategy the peer uses to stay within the baseline. |
| DPL-CAP-03 | Core | §6.11 | Across a full peer turn (either peer), no filesystem mutation occurs within the harness sandbox. Verified by comparing a pre-turn and post-turn filesystem snapshot. |
| DPL-CAP-04 | Extended | §6.11 | The invariant holds independent of the specific adapter configuration flag names used to realize it. Verified by an integration test that swaps configuration mechanisms without changing observed behavior. |

### 6.11 DPL-EXEC — `requestedEffects` lifecycle

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-EXEC-01 | Core | §6.12 | A `requestedEffect` with disposition `"executed"` results in a single `EffectRequestRecord` with `disposition === "executed"` and populated `result` field; the effect is dispatched through `@tisyn/effects` producing journal YieldEvents. |
| DPL-EXEC-02 | Core | §6.12 | A `requestedEffect` with disposition `"deferred"` results in a single `EffectRequestRecord` with `disposition === "deferred"`. No execution occurs. No follow-up record for this instance is written on a later cycle. |
| DPL-EXEC-03 | Core | §6.12 | A `requestedEffect` with disposition `"rejected"` results in a single `EffectRequestRecord` with populated `error`. No execution occurs. |
| DPL-EXEC-04 | Extended | §6.12 | A `requestedEffect` with disposition `"surfaced_to_taras"` results in a single `EffectRequestRecord` with `disposition === "surfaced_to_taras"`. The spec's SHOULD-level guidance that the effect be presented to Taras via the next Taras gate is not required at Core; this Extended test verifies the recommended presentation behavior when the implementation chooses to follow it. |
| DPL-EXEC-05 | Core | §6.12 | A `requestedEffect` whose `id` is not registered with `@tisyn/effects` is rejected with `"rejected"` disposition. |
| DPL-EXEC-06 | Core | §6.13, §5.8 | Exactly one `EffectRequestRecord` is appended per requested effect. The record is not mutated after append. |
| DPL-EXEC-07 | Core | §6.13, §5.8 | On `"executed"` disposition that throws, the single record carries populated `error` (not `result`). |
| DPL-EXEC-08 | Core | §5.8 | `EffectRequestRecord.dispositionAt >= EffectRequestRecord.turnIndex`. |
| DPL-EXEC-09 | Core | §6.13 | A peer that wants a deferred action on a later cycle emits a new `RequestedEffect` on a later turn; the workflow does NOT carry deferred requests forward from prior records. |
| DPL-EXEC-10 | Core | §6.12 | A `requestedEffect` with disposition `"surfaced_to_taras"` results in a single `EffectRequestRecord` with `disposition === "surfaced_to_taras"` and no execution. No further conformance claim is made about how the effect is subsequently presented. |

### 6.12 DPL-INIT — Initial state

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-INIT-01 | Core | §7.1 | On very first launch (empty journal), initial `RecursiveState` equals `{ nextSpeaker: "opus", tarasMode: "optional", turnCount: 0 }`. |
| DPL-INIT-02 | Core | §7.1 | DB reads at launch (`loadMessages`, `loadControl`, `loadPeerRecords`) are for hydration only. They do not contribute to `RecursiveState` reconstruction. |
| DPL-INIT-03 | Core | §7.1 | Absent `LoopControl` is initialized to `{ paused: false, stopRequested: false }` and persisted via `DB.writeControl(...)`. |
| DPL-INIT-04 | Core | §7.1 | `App.loadChat` is dispatched with the `TurnEntry` array returned by `DB.loadMessages`. |

### 6.13 DPL-RPL — Replay semantics

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-RPL-01 | Core | §7.3 | Given a captured journal prefix from a partial run, the next live dispatch after replay matches the dispatch an uninterrupted run would produce at the same frontier. Observed via the harness's captured `OperationCall` sequence; not via internal state inspection. |
| DPL-RPL-02 | Core | §7.3 | After replay, the workflow's next live dispatch matches the dispatch it would have made in an uninterrupted run. |
| DPL-RPL-03 | Core | §7.3 | Replay does not re-execute `@tisyn/effects` dispatches that are present in the journal; they resolve from journaled YieldEvent results. |
| DPL-RPL-04 | Core | §7.1 + §7.3 | If DB-persisted data and journal-reconstructed state could disagree, a conforming workflow consults the journal for control state and the DB for application hydration; no reconciliation is attempted. Verified by a test where DB state is externally tampered after journal capture: the workflow continues per the journal. |
| DPL-RPL-05 | Extended | §7.3 | Replay is deterministic: two replays of the same journal prefix produce identical next-dispatch observations. |

### 6.14 DPL-TYPE — Persisted record type shapes

| ID | Tier | Spec ref | Assertion |
|---|---|---|---|
| DPL-TYPE-01 | Core | §5.1 | Every persisted `TurnEntry` has `speaker` in `{ "taras", "opus", "gpt" }` and `content: string`. `usage` is absent or a `UsageSummary`. |
| DPL-TYPE-02 | Core | §5.2 | Every persisted `LoopControl` has `paused: boolean`, `stopRequested: boolean`. `nextSpeakerOverride` is absent or in `{ "opus", "gpt" }`. |
| DPL-TYPE-03 | Core | §5.4 | Every persisted `PeerRecord` has `turnIndex: number` (integer), `speaker` in `{ "opus", "gpt" }`, `status` in the three-value enum. `data`, when present, is a Val. |
| DPL-TYPE-04 | Core | §5.8 | Every persisted `EffectRequestRecord` has `turnIndex`, `requestor`, `effect`, `disposition`, `dispositionAt`. At most one of `result` / `error` is populated. `dispositionAt >= turnIndex`. |
| DPL-TYPE-05 | Core | §5 | All Val-typed fields (`PeerRecord.data`, `PeerTurnResult.data`, `RequestedEffect.input`, `EffectRequestRecord.result`) round-trip through JSON serialization without loss. |

---

## 7. Coverage Matrix

Every normative rule in the specification maps to at least
one Core test.

| Spec rule | Spec § | Test IDs |
|---|---|---|
| LOOP-CTRL-1 | §6.1 | DPL-CTRL-01, DPL-CTRL-02, DPL-CTRL-03, DPL-CTRL-04 |
| LOOP-GATE-1 | §6.2 | DPL-GATE-01, DPL-GATE-02, DPL-GATE-03 |
| LOOP-GATE-2 | §6.3 | DPL-GATE-01, DPL-GATE-02, DPL-GATE-03, DPL-GATE-04 |
| LOOP-STEP-1 | §6.4 | DPL-STEP-01, DPL-STEP-02, DPL-STEP-03, DPL-STEP-04 |
| LOOP-OVERRIDE-1 | §6.5 | DPL-OVR-01, DPL-OVR-02, DPL-OVR-03, DPL-OVR-04 |
| LOOP-ALT-1 | §6.6 | DPL-ALT-01, DPL-ALT-02, DPL-ALT-03, DPL-ALT-04 |
| LOOP-RESULT-1 | §6.7 | DPL-RES-01, DPL-RES-02, DPL-RES-03, DPL-RES-04 |
| LOOP-MODE-1 | §6.8 | DPL-MODE-01, DPL-MODE-02, DPL-MODE-03, DPL-MODE-04 |
| LOOP-DONE-1 | §6.9 | DPL-DONE-01, DPL-DONE-02, DPL-DONE-03, DPL-DONE-04 |
| LOOP-PERSIST-1 | §6.10 | DPL-PER-01, DPL-PER-02, DPL-PER-03, DPL-PER-04, DPL-PER-05, DPL-PER-06, DPL-PER-07 |
| M2-CAP-1 | §6.11 | DPL-CAP-01, DPL-CAP-02, DPL-CAP-03 |
| M2-EXEC-1 | §6.12 | DPL-EXEC-01, DPL-EXEC-02, DPL-EXEC-03, DPL-EXEC-05, DPL-EXEC-09, DPL-EXEC-10 |
| M2-EXEC-2 | §6.13 | DPL-EXEC-06, DPL-EXEC-07, DPL-EXEC-09 |
| Cycle algorithm §7.2 | §7.2 | All DPL-* categories; end-to-end orchestration inferred from sequence-of-operations assertions |
| Initial state §7.1 | §7.1 | DPL-INIT-01, DPL-INIT-02, DPL-INIT-03, DPL-INIT-04, DPL-RPL-04 |
| Replay §7.3 | §7.3 | DPL-RPL-01, DPL-RPL-02, DPL-RPL-03, DPL-RPL-04 |
| Type shapes §5 | §5 | DPL-TYPE-01 through DPL-TYPE-05 |
| Preserved invariants §8.1 | §8.1 | Implicit; preserved by the above not probing kernel/runtime internals |

### 7.1 Coverage Confirmation

Every rule with MUST-level normative language in the spec
maps to at least one Core test. No Core rule is left
uncovered.

---

## 8. Test Count Summary

| Category | Core | Extended | Total |
|---|---|---|---|
| DPL-GATE | 4 | 3 | 7 |
| DPL-CTRL | 4 | 1 | 5 |
| DPL-STEP | 4 | 0 | 4 |
| DPL-OVR | 4 | 0 | 4 |
| DPL-ALT | 4 | 0 | 4 |
| DPL-RES | 4 | 0 | 4 |
| DPL-MODE | 4 | 0 | 4 |
| DPL-DONE | 4 | 0 | 4 |
| DPL-PER | 7 | 0 | 7 |
| DPL-CAP | 3 | 1 | 4 |
| DPL-EXEC | 9 | 1 | 10 |
| DPL-INIT | 4 | 0 | 4 |
| DPL-RPL | 4 | 1 | 5 |
| DPL-TYPE | 5 | 0 | 5 |
| **Total** | **64** | **7** | **71** |

---

## 9. Harness Requirements

### 9.1 Instrumentation

The test harness MUST capture every agent operation
dispatch as an `OperationCall` record with its arguments.
Capture occurs at the workflow's agent-dispatch boundary.
Capture MUST NOT alter dispatch semantics.

### 9.2 Peer Scripting

For Core tests the peer agents are replaced with scripted
stubs that return fixture-defined `PeerTurnResult` values
on each `takeTurn` call. This isolates loop conformance
from live model behavior.

A separate integration-tier suite (Extended) MAY wire
actual Claude Code and Codex adapters and verify only that
the peer-step pipeline (dispatch, persist, display) is
intact. Integration-tier tests are not part of Core
conformance.

### 9.3 Effect Dispatch

For Core tests `@tisyn/effects` dispatches are replaced
with scripted stubs that return fixture-defined values or
throw fixture-defined errors. This isolates loop
conformance from effect-registry content.

### 9.4 Browser Substrate

For Core tests the browser is replaced with a simulated
WebSocket client that emits scripted `userMessage` events
and observes `showMessage` / `loadChat` / `setReadOnly`
dispatches. See `examples/multi-agent-chat/test/e2e.test.ts`
for the pattern; the fork uses the same pattern.

### 9.5 Replay Harness

Replay tests capture a journal prefix from a partial run,
restart the workflow against that journal, and observe the
next dispatch. The runtime's standard external-effect
replay path (Kernel §4.3) is the substrate; the test plan
does not introduce a custom replay mechanism.

### 9.6 Filesystem Snapshot

DPL-CAP tests require a pre-turn and post-turn filesystem
snapshot. The harness snapshots a sandboxed working
directory, not the real repository. Sandbox isolation is
the harness's responsibility; this plan does not prescribe
the snapshot mechanism.

---

## 10. Acceptance Criteria

### 10.1 Core Acceptance

An implementation of the deterministic peer loop is
Core-conforming if:

1. All 64 Core tests in this plan pass against an
   instrumented fork of `examples/deterministic-peer-loop`.
2. No test in this plan crashes, hangs, or produces an
   unexpected error not accounted for in the fixture.
3. The harness's captured `OperationCall` sequences match
   expected sequences exactly where asserted, and match
   as sets where set-equality is asserted.
4. No Core test probes kernel, runtime, compiler, or
   `@tisyn/effects` internals.

### 10.2 Extended Acceptance

Passing all Core tests plus all Extended tests is
Extended-conforming. Extended conformance is recommended
for releases intended as reference implementations.

### 10.3 Non-Acceptance

An implementation that fails any Core test is
non-conforming, regardless of Extended test results.

---

## 11. Relationship to Other Test Plans

### 11.1 Code Agent Test Plan

The base `CodeAgent` contract's test plan covers
`prompt`, `newSession`, `closeSession`, `fork`, and
`openFork` conformance. The deterministic peer-loop plan
treats those as verified prerequisites and does not re-test
them. The peer wrappers' `takeTurn` operations are
tested as new surface in this plan.

### 11.2 Claude Code / Codex Profile Test Plans

Profile test plans verify adapter-specific behavior. This
plan does not duplicate those assertions. DPL-CAP tests
verify the peer-loop *uses* the adapters in a
capability-restricted posture; they do not verify the
adapter implementations themselves.

### 11.3 Timebox Test Plan

The Timebox test plan verifies `timebox` orchestration.
This plan relies on that verification. DPL-GATE tests
verify the loop's *composition* with `timebox` (the
tagged-result branching behavior, duration sourcing), not
`timebox` itself.

### 11.4 Multi-Agent Chat Demo Tests

The existing chat demo has its own acceptance-criteria
suite. This plan does not amend or re-run it. The fork is
tested as a separate example.

---

## 12. Open Items

These are not part of the normative matrix. They are
flagged for future plan amendments.

### 12.1 Track A Integration

When the base Code Agent `PromptResult.usage` amendment
lands, DPL-PER-06 and DPL-TYPE-01 will be strengthened
from "tolerated and passed through" to normative usage
assertions. The existing scaffolding (`usage?` fields
already tested as present-or-absent) makes this extension
non-breaking.

### 12.2 Effects Catalog Integration

When the separate effects-spec lands with a concrete
baseline effect catalog, DPL-EXEC tests will be extended
with per-effect behavior fixtures. The disposition-lifecycle
tests in this plan remain valid without per-effect
extension.

### 12.3 Taras-as-Agent Integration

When the "Taras as an agent role" direction (spec OQ beyond
§10) is designed, new tests for that integration will be
added. Current plan assumes Taras is external to the
workflow.

### 12.4 Revert-to-Prior-Stream Integration

When user-directed revert (spec §10.4) is specified, a new
DPL-RVT category will be added.

---

*End of test plan.*
