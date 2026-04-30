# Tisyn Deterministic Peer Loop Specification

**Version:** 0.1.0
**Package:** `examples/deterministic-peer-loop`
**Depends on:** Tisyn Agent Specification, Tisyn Code Agent
Specification, Tisyn Timebox Specification,
`@tisyn/effects` effect-dispatch surface
**Realized with (MVP profiles):** Tisyn Claude Code
Specification, Tisyn Codex Specification
**Complements:** Tisyn Multi-Agent Chat Demo
**Status:** Draft

> **Implementation note (non-normative).** At the time of
> this specification's drafting, the `@tisyn/effects`
> package is being extracted from `@tisyn/agent` per
> in-flight work. This specification depends on the
> `Effects` / `dispatch` / `resolve` / `invoke` surface
> regardless of packaging. Packaging status is not a
> normative dependency.

---

### Changelog

**v0.1.1** — Journal-only durability amendment. Replaces
the file-backed DB agent with a stateless Projection
agent (§4.2) whose pure reducer operations
(`readInitialControl`, `applyControlPatch`,
`appendMessage`, `appendPeerRecord`,
`appendEffectRequest`) thread application-level state
through workflow locals. On restart, the kernel journal —
the sole durable artifact — is replayed by the runtime;
the workflow's local accumulators (`messages`, `control`,
`peerRecords`, `effectRequests`, `readOnlyReason`) are
rebuilt deterministically from the recorded return values
of Projection ops. Collapses the App agent's
per-message fan-out ops (`showMessage`, `loadChat`,
`readControl`, `setReadOnly`) into a single
`App.hydrate({ messages, control, readOnlyReason })`
called once per main-loop iteration (§4.1) plus a
`nextControlPatch` blocking-pull for browser-origin
`LoopControl` patches. Adds the post-gate control-patch
drain (§7.2 Step 2a) as the authoritative integration
point between browser-issued control patches and each
cycle's stop/pause/override checks. Adds a host-side
post-execute publish step (§7.1) to guarantee browser
hydration on terminal replay-only runs. Renames §6.10 to
LOOP-PERSIST-1 (per-turn projection) and §7.2 Step 7 to
the Projection-based append flow. Reasoning: the prior
JSON store doubled the durable surface, required
hand-kept schema parity with the workflow's own shapes,
and had already produced a concrete `usage` field
parity bug; the journal-only model is the canonical
Tisyn durability pattern.

**v0.1.0** — Initial draft. Defines the deterministic
peer-loop example: a forked variant of the multi-agent-chat
substrate that coordinates two distinct non-Taras peers
(`OpusAgent`, `GptAgent`) under a Taras-gate-first cycle,
with structured peer-turn results, browser-observable
durable loop-control state, and a capability-restricted MVP
posture in which peers emit structured effect requests
rather than using backend-native nondeterministic tools.
The optional Taras gate composes `App.elicit` inside
`timebox` rather than introducing a separate timed-elicit
operation. Serializable-payload fields (`PeerRecord.data`,
`PeerTurnResult.data`, `RequestedEffect.input`,
`EffectRequestRecord.result`) are typed as portable
Tisyn `Val` values. The YieldEvent journal is named
explicitly as the sole source of truth for replay;
application-level DB record collections are not a parallel
durability mechanism and the term "durable stream" is not
broadened. `elicit` uses an object argument shape
(`{ message }`) to leave room for prompt metadata without a
breaking signature change. Claude Code and Codex profile
specs are cited as MVP realization references, not as
hard architectural dependencies. `RecursiveState` is
owned solely by journal replay; DB reads in §7.1 are for
application hydration only and never reconstruct loop
control state. Each requested effect produces exactly one
append-only `EffectRequestRecord` carrying the final
disposition and (for executed effects) the outcome; the
DB surface has no update semantics. All four dispositions
(`"executed"`, `"deferred"`, `"rejected"`,
`"surfaced_to_taras"`) are terminal for the record they
produce; a peer that wants a deferred action on a later
cycle MUST emit a new `RequestedEffect` on a later turn.
`writeControl` replaces `appendControl` to match the
current-state semantics of `LoopControl`.

---

## 1. Overview

This specification defines the **deterministic peer-loop**
example — a Tisyn workflow that coordinates a serial,
turn-taking conversation between two distinct AI peers under
the explicit direction of a human operator (Taras). The loop
is built on the existing multi-agent-chat substrate
(`examples/multi-agent-chat`) and is realized as a fork
rather than a modification of that example.

The loop's purpose is operational, not demonstrative: it
provides a substrate on which two peers can collaboratively
design, review, and produce structured outputs in a
replayable, journaled Tisyn workflow. It is the execution
substrate for the collaboration this specification itself is
the product of.

### 1.1 Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD**,
**SHOULD NOT**, and **MAY** are used as defined in RFC 2119.

### 1.2 Normative Scope

This specification covers:

- the forked example's substrate and extension points
- the App, DB, OpusAgent, and GptAgent surfaces as they
  appear to workflow code
- the workflow-owned recursive state model
- the durable browser-observable loop-control state
- the persisted transcript, peer-record, and effect-request
  disposition streams
- the structured peer-turn input and result types
- the cycle algorithm and its normative invariants
- the capability baseline under which peers operate
- the workflow's disposition of peer-requested effects

### 1.3 What This Specification Does Not Cover

- the concrete baseline effect catalog registered with
  `@tisyn/effects` (specified separately in a future
  effect-set specification)
- the internal implementation of `@tisyn/effects` itself
  (covered by its own specification)
- any custom agent that peers may invoke for specialized
  capabilities (specified separately per agent, if any)
- the base `CodeAgent` contract surface (defined by Code
  Agent Specification; unchanged by this specification)
- Claude Code or Codex backend behavior beyond what flows
  through their published adapters
- user-directed revert-to-prior-stream-position (deferred
  future work; §10)
- the generic Tisyn browser transport contract (defined
  separately in Browser Contract Specification; this
  example's browser surface is example-specific)

### 1.4 Relationship to Other Specifications

This specification has two tiers of relationship to other
specifications.

**Hard architectural dependencies** — this specification
cannot be realized without them:

- the Agent Specification, for agent declaration and
  dispatch semantics
- the Code Agent Specification, for the `prompt` operation
  and the `PromptResult` type that peer wrappers build on
- the Timebox Specification, for the composition
  primitive used to bound the optional Taras gate (§6.3)
- the `@tisyn/effects` effect-dispatch surface, for the
  primitives used to dispose peer-requested effects

**MVP realization references** — profile specifications
that describe the concrete adapters the MVP example uses
to realize the capability baseline of §6.11:

- the Claude Code Specification (used by `OpusAgent`)
- the Codex Specification (used by `GptAgent`)

These realization references are not load-bearing
semantically. Future amendments MAY substitute different
adapter profiles without altering this specification's
normative content, provided the substitute profile
conforms to the Code Agent Specification and the
capability baseline of §6.11.

This specification does not amend the kernel, runtime,
compiler, durable streams, transport, protocol, config,
scoped-effects, or timebox specifications. It does not
amend the `CodeAgent` contract or any adapter profile.

---

## 2. Terminology

**Taras** — The human operator directing the loop.
Throughout this specification Taras is a named role, not a
literal person. Any human operator assuming that role
satisfies the requirements attached to "Taras."

**Peer** — A non-Taras participant in the loop. The loop
defines exactly two peers: `OpusAgent` and `GptAgent`.

**OpusAgent** — The peer backed by the `@tisyn/claude-code`
SDK adapter.

**GptAgent** — The peer backed by the `@tisyn/codex` SDK
adapter configured to use GPT 5.4 as the model. The
adapter, runtime, and model identities remain distinct: the
adapter is Codex; the runtime is Codex via ACP; the model
is GPT 5.4. This specification never refers to a "GPT 5.4
adapter."

**Cycle** — One iteration of the loop: a Taras gate
followed by at most one peer step followed by recursion.

**Taras gate** — The opening phase of every cycle, during
which the workflow offers Taras an opportunity to intervene
(or requires Taras input) before any peer step is
dispatched.

**`tarasMode`** — A workflow-owned state bit indicating
whether the current Taras gate is optional (with timeout)
or required (without timeout).

**Peer step** — The workflow's dispatch of a `takeTurn`
operation on `OpusAgent` or `GptAgent`, producing a
`PeerTurnResult`.

**`PeerTurnResult`** — The structured return value of a
peer step. Carries a display projection, a loop-control
status, optional workflow-visible data, optional
peer-requested effects, and optional token-usage summary.

**Requested effect** — A structured request by a peer for
the workflow to execute a deterministic effect on its
behalf. Requested effects are not executed by the peer
itself.

**Disposition** — The workflow's decision for how to handle
a requested effect on the turn it was requested: execute,
defer, reject, or surface to Taras.

**Capability baseline** — The MVP restriction under which
peers operate without direct access to nondeterministic
mutating backend tools. See §6.11.

**Substrate** — The App agent, Projection agent, compiled
workflow entrypoint, and WebSocket transport that
collectively host the loop. Derived from
`examples/multi-agent-chat` by forking.

---

## 3. Substrate

### 3.1 Fork Target

The example MUST be realized as a fork of
`examples/multi-agent-chat` at directory
`examples/deterministic-peer-loop`. The fork MUST NOT
modify the original `examples/multi-agent-chat` example.
The original example's acceptance criteria are preserved
unchanged.

Code reuse from the original example is encouraged. The
fork MUST preserve the original's topology:

- browser WebSocket client
- App agent as browser boundary (extended per §4.1)
- compiled workflow executed via `tsn run`
- Projection agent as pure-reducer boundary (§4.2) in
  place of a persistence-owning DB agent; durable state
  lives in the kernel journal and is reconstructed by
  runtime replay

### 3.2 Replaced Components

The original example's single LLM agent is replaced by two
distinct peer agents: `OpusAgent` and `GptAgent` (§4.3,
§4.4).

The original example's App-side transcript and loop-control
fan-out is replaced by a single `hydrate` operation that
carries the full per-iteration snapshot (§4.1).

The original example's file-backed DB agent is replaced by
a stateless Projection agent (§4.2). The example no longer
maintains a secondary JSON store; the kernel journal is
the sole durable artifact, and the workflow rebuilds its
application-level view (transcript, control, peer records,
effect-request records) from journal replay of
Projection-op return values.

### 3.3 Added Components

The App agent gains a blocking-pull `nextControlPatch`
operation for browser-origin control updates and a
`hydrate` operation for per-iteration state push (§4.1).
The Projection agent adds pure-reducer operations for
transcript, control, peer-record, and effect-request
projection (§4.2).

### 3.4 Execution Model

The workflow MUST be compiled from TypeScript via
`tsn generate` and executed via `tsn run` (or a
functionally equivalent programmatic host driver when a
post-execute publish step is needed — see §7.1). No
imperative host orchestrator participates in the loop's
control flow. The workflow is the sole control-flow
orchestrator of the peer loop. Substrate behaviors (App
and Projection agent lifecycle, WebSocket session
management, browser connect/reconnect, kernel journal
I/O) remain the responsibility of their respective
components; this specification does not claim they are
inside the workflow.

The deployment target is single-machine local execution.
Taras runs `tsn run` (or the host driver) locally. Both
peer adapters run as local subprocesses or in-process. The
durable journal is a local NDJSON file written by the
kernel.

---

## 4. Agent Surfaces

### 4.1 App Agent

The App agent is the browser boundary. It exposes the
following operations to the workflow:

| Operation | Purpose |
|---|---|
| `elicit({ message })` | Block for a Taras-origin message |
| `nextControlPatch()` | Block for the next browser-origin `LoopControl` patch |
| `hydrate({ messages, control, readOnlyReason })` | Push the current post-replay snapshot to attached browsers |

**`elicit`** — Blocks indefinitely for a user message from
Taras's connected browser. The input argument is an object
with a `message` field carrying the prompt text; the
object shape leaves room for prompt metadata to be added
in future amendments without a breaking signature change.
Bounded waits are composed from `elicit` and `timebox` per
the Timebox Specification; no separate `elicitWithTimeout`
operation is defined. Used directly (unbounded) when
`tarasMode` is `"required"` and wrapped in `timebox` when
`tarasMode` is `"optional"` (see §6.3).

**`nextControlPatch`** — Blocking-pull on a
browser-origin queue of `BrowserControlPatch` values (a
partial shape of `LoopControl` where an absent field
preserves the current value and `nextSpeakerOverride: null`
clears the current override). Returns one patch per call.
The workflow composes `nextControlPatch` with
`timebox(0, ...)` to drain the queue non-blockingly when
it needs the complete set of browser-issued patches since
the last drain (see §7.2 Step 2a).

**`hydrate`** — The workflow's "push current state to the
browser" step. The workflow calls `hydrate` once per main
loop iteration after its local accumulators settle,
passing the complete current snapshot
`{ messages, control, readOnlyReason }`. The App agent MUST
overwrite its in-memory session mirror with the incoming
snapshot and fan the snapshot out to attached owner and
observer sessions as transcript / control / read-only
WebSocket frames. `hydrate` is the sole App-side channel
for transcript display, control fan-out, and read-only
state; no per-message or per-control-field operations
exist on the App surface.

`hydrate` is journaled like any agent-op. On replay, each
pre-frontier `hydrate` call returns its recorded void
result from the journal without re-dispatching to the
binding; the first post-frontier `hydrate` dispatches live
and is what attached browsers observe after a host
restart. Terminal replay-only runs (a journal that
replays to completion without any live dispatch) are
covered by a host-side post-execute publish step that
forwards the workflow's final return value into the App
binding; this publish step is not an agent operation and
does not participate in replay.

The App agent's other responsibilities (session identity,
owner vs observer semantics, connect/reconnect hydration,
pending-prompt re-send) are inherited unchanged from the
original multi-agent-chat substrate.

The App agent surface defined here is example-specific. It
is not the generic Tisyn browser transport contract
(specified separately in the Browser Contract
Specification, and intentionally narrower).

### 4.2 Projection Agent

The Projection agent is a pure reducer over values the
workflow threads through its local accumulators. It holds
no cross-call state, performs no I/O, and does not consult
the journal directly. It exposes the following operations
to the workflow:

| Operation | Purpose |
|---|---|
| `readInitialControl({})` | Return the initial `LoopControl` used to seed the workflow's `control` local at startup |
| `applyControlPatch({ current, patch })` | Return the result of merging `patch` onto `current` |
| `appendMessage({ messages, entry })` | Return `[...messages, entry]` |
| `appendPeerRecord({ records, record })` | Return `[...records, record]` |
| `appendEffectRequest({ records, record })` | Return `[...records, record]` |

The Projection agent's role is twofold:

1. It supplies the initial loop-control seed through a
   real agent-op (`readInitialControl`) so both production
   and replay paths go through the same journaled call. In
   production the binding returns `DEFAULT_LOOP_CONTROL`
   unconditionally; tests override the same op to seed a
   non-default starting control.
2. It validates and shapes reducer inputs (via TypeBox)
   and returns their deterministic output. The workflow
   passes each returned value back into its own local
   accumulator, replacing the prior value. No Projection
   op retains state between calls.

**`applyControlPatch({ current, patch })`** returns a new
`LoopControl` value: fields absent in `patch` preserve
`current`; fields present in `patch` overwrite `current`;
`patch.nextSpeakerOverride === null` clears the override
from `current`.

**`appendMessage` / `appendPeerRecord` /
`appendEffectRequest`** return a new array constructed as
`[...collection, entry]`. The input arrays MUST NOT be
mutated.

The four application-level record collections —
transcript, current `LoopControl`, peer records, and
effect-request records — live in the workflow's local
variables. They are rebuilt on restart by kernel replay
of the Projection-op return values recorded in the
journal. No Projection binding reads or writes a
persistence file. The kernel journal is the sole durable
artifact and the sole source of truth for replay (§6.10,
§7.3).

Record schemas are defined in §5.

### 4.3 OpusAgent

The OpusAgent is a peer-level wrapper around the
`@tisyn/claude-code` SDK adapter. It exposes one operation
to the workflow:

| Operation | Purpose |
|---|---|
| `takeTurn(input)` | Execute one peer turn, return a structured result |

**`takeTurn(input: PeerTurnInput): PeerTurnResult`** — The
OpusAgent wrapper:

1. Receives `PeerTurnInput` from the workflow.
2. Constructs a backend prompt from the input.
3. Calls `prompt(...)` on the underlying `@tisyn/claude-code`
   adapter.
4. Parses the backend's `PromptResult.response` into a
   `PeerTurnResult` per §6.9.
5. Returns the structured `PeerTurnResult`.

The OpusAgent MUST configure its underlying
`@tisyn/claude-code` adapter to operate under the capability
baseline (§6.11). The concrete configuration is an
implementation note; the normative requirement is the
baseline, not any specific adapter flag.

The OpusAgent MUST NOT expose, extend, or amend the base
`CodeAgent` contract. It MUST NOT introduce new operations
on its underlying Code Agent.

### 4.4 GptAgent

The GptAgent is a peer-level wrapper around the
`@tisyn/codex` SDK adapter configured to use GPT 5.4 as the
model. It exposes one operation to the workflow:

| Operation | Purpose |
|---|---|
| `takeTurn(input)` | Execute one peer turn, return a structured result |

**`takeTurn(input: PeerTurnInput): PeerTurnResult`** — The
GptAgent wrapper behaves symmetrically to the OpusAgent
wrapper (§4.3) against its Codex-backed adapter.

The GptAgent MUST configure its underlying `@tisyn/codex`
adapter under the capability baseline (§6.11). As with the
OpusAgent, the concrete configuration is an implementation
note.

The GptAgent MUST NOT expose, extend, or amend the base
`CodeAgent` contract.

### 4.5 Peer Distinctness

The two peer agents are distinct. This specification does
not claim that OpusAgent and GptAgent are interchangeable
or that they must remain schema-identical in future
revisions. Default alternation between them (§6.6) is a
control policy, not an assertion of symmetry.

Future amendments MAY specialize either peer's operation
set, prompt construction, or result shape. This
specification does not reserve or restrict that future
direction beyond the shared `takeTurn(PeerTurnInput) ->
PeerTurnResult` contract adopted in MVP.

---

## 5. Types

All types in this specification MUST belong to the portable
serializable data domain defined by the Tisyn Config
Specification §3.1. Peer agents and the workflow exchange
values that are Val-serializable.

### 5.1 TurnEntry

```typescript
interface TurnEntry {
  speaker: "taras" | "opus" | "gpt";
  content: string;
  usage?: UsageSummary;
}
```

A persisted transcript record. One `TurnEntry` is written
per message that appears in the browser transcript —
Taras-origin user messages and peer-origin assistant
messages alike.

`content` is the human-readable message text. For peer
turns, `content` is derived from `PeerTurnResult.display`
(§5.5).

`usage` is the optional portable token-usage summary
defined by Track A of this design work. Its presence
depends on Track A's base-contract amendment landing
(parked as of this specification version). If absent,
workflow code MUST tolerate its absence.

### 5.2 LoopControl

```typescript
interface LoopControl {
  paused: boolean;
  stopRequested: boolean;
  nextSpeakerOverride?: "opus" | "gpt";
}
```

The durable, browser-writable, workflow-observable
loop-control state. Threaded through the workflow's local
`control` accumulator and reconstructed on restart by
replaying recorded `Projection.readInitialControl` and
`Projection.applyControlPatch` return values. Re-read by
the workflow before every peer step per LOOP-CTRL-1.

`paused` — When `true`, the workflow MUST NOT dispatch a
peer step on the current cycle. Instead it MUST elicit
Taras (i.e., re-enter the Taras gate in `"optional"` mode
for the next cycle).

`stopRequested` — When `true`, the workflow MUST exit the
loop per LOOP-CTRL-1 and LOOP-DONE-1 by calling
`setReadOnly(...)` and returning.

`nextSpeakerOverride` — When present, supplies the speaker
for the next peer step regardless of default alternation.
One-shot: MUST be cleared from `LoopControl` within the
same cycle in which it is consumed (LOOP-OVERRIDE-1).

### 5.3 RecursiveState

```typescript
interface RecursiveState {
  nextSpeaker: "opus" | "gpt";
  tarasMode: "optional" | "required";
  turnCount: number;
}
```

Workflow-owned state carried as the recursive parameter of
the loop body. Not persisted as a separate entity;
reconstructed by standard journal replay from the sequence
of dispatched effect results.

`nextSpeaker` — The default speaker for the next peer
step. Toggled between `"opus"` and `"gpt"` after each peer
step per LOOP-ALT-1, subject to override per
LOOP-OVERRIDE-1.

`tarasMode` — Whether the upcoming Taras gate is
`"optional"` (with timeout per LOOP-GATE-2) or `"required"`
(without timeout). Set deterministically by
LOOP-MODE-1 from the prior turn's status.

`turnCount` — Monotonically non-decreasing count of peer
steps executed. Increments by one per peer step.
Scaffolding for future budget-based termination predicates;
not used by any MVP invariant.

### 5.4 PeerRecord

```typescript
interface PeerRecord {
  turnIndex: number;
  speaker: "opus" | "gpt";
  status: "continue" | "needs_taras" | "done";
  data?: Val;
}
```

A structured record of one peer step's workflow-visible
output. Projected into the workflow's local peer-record
accumulator via `Projection.appendPeerRecord(...)`; the
accumulator is rebuilt from replayed return values on
restart.

`turnIndex` corresponds to the `turnCount` at which the
step executed.

`data`, when present, MUST be a portable Tisyn-serializable
value (Val) per Config Specification §3.1. Its shape is
peer-defined; this specification does not constrain the
taxonomy of valid `data` shapes beyond serializability. A
future amendment MAY introduce a typed taxonomy; until
then, workflow code that consumes `data` must tolerate any
Val-shaped value.

`PeerRecord` complements `TurnEntry`: the transcript
carries display text for the browser, and `PeerRecord`
carries structured control data for the workflow. The two
are persisted independently.

### 5.5 PeerTurnInput

```typescript
interface PeerTurnInput {
  transcript: ReadonlyArray<TurnEntry>;
  tarasMode: "optional" | "required";
}
```

The input a peer receives when the workflow dispatches
`takeTurn` on it.

`transcript` is the current conversation history as
observed at the time the peer step begins. Peers MAY use
it to construct their prompt context.

`tarasMode` informs the peer whether the next cycle's
Taras gate will wait indefinitely for Taras's input (when
`"required"`) or will time out (when `"optional"`). Peers
MAY use this to calibrate how much they ask of Taras.

Future amendments MAY add peer-specific input fields. This
specification does not reserve or restrict that direction
beyond the shared surface adopted in MVP.

### 5.6 PeerTurnResult

```typescript
interface PeerTurnResult {
  display: string;
  status: "continue" | "needs_taras" | "done";
  data?: Val;
  requestedEffects?: ReadonlyArray<RequestedEffect>;
  usage?: UsageSummary;
}
```

The structured return value of `takeTurn`.

`display` — The human-readable message text. MUST be
persisted as `TurnEntry.content` for the peer turn.

`status` — The loop-control signal. Drives
LOOP-MODE-1, LOOP-DONE-1, and ultimately the next cycle's
`tarasMode`.

`data`, when present, MUST be a portable Tisyn-serializable
value (Val) per Config Specification §3.1. Persisted as
`PeerRecord.data`. Not displayed. Peer-defined shape.

`requestedEffects` — The optional list of effect requests
the peer asks the workflow to dispose. Each entry is a
`RequestedEffect` (§5.7). Disposed per §6.12.

`usage` — Optional per-turn token-usage summary, shaped by
Track A's base-contract amendment when that amendment
lands. Absent otherwise.

### 5.7 RequestedEffect

```typescript
interface RequestedEffect {
  id: string;
  input: Val;
}
```

A peer's request for the workflow to dispatch a
deterministic effect on its behalf.

`id` — The effect identifier as registered with
`@tisyn/effects`. The set of accepted identifiers is
defined by the separate effects-spec track referenced in
§8.4. This specification does not enumerate effect IDs.

`input` — The effect-specific input payload. MUST be a
portable Tisyn-serializable value (Val) per Config
Specification §3.1.

### 5.8 EffectRequestRecord

```typescript
interface EffectRequestRecord {
  turnIndex: number;
  requestor: "opus" | "gpt";
  effect: RequestedEffect;
  disposition: "executed" | "deferred"
             | "rejected" | "surfaced_to_taras";
  dispositionAt: number;
  result?: Val;
  error?: { name: string; message: string };
}
```

A workflow-level disposition record for a requested
effect. Projected into the workflow's local
effect-request accumulator via
`Projection.appendEffectRequest(...)`; the accumulator is
rebuilt from replayed return values on restart.

**Single-record lifecycle.** Each requested effect
produces exactly one `EffectRequestRecord`. The record is
appended after the workflow has chosen a disposition —
and, for the `"executed"` disposition, after the execution
attempt has completed (returning a value or throwing). The
record is never mutated after being appended. The
Projection surface is append-only; this specification
does not introduce update semantics.

`turnIndex` corresponds to the `turnCount` at which the
effect was requested. `dispositionAt` corresponds to the
`turnCount` at which the disposition was finalized and the
record was appended; MUST be equal to or greater than
`turnIndex`.

`result` is populated only when `disposition === "executed"`
and the effect execution returned a value. When populated,
`result` MUST be a portable Tisyn-serializable value (Val).

`error` is populated only in two cases: (a) when
`disposition === "rejected"`, where `error` carries the
rejection reason; or (b) when `disposition === "executed"`
and the execution attempt threw, where `error` carries the
thrown error's name and message. A single record carries
at most one of `result` and `error`.

**Not authoritative for replay.** `EffectRequestRecord` is
a workflow-level observability and review artifact. It MUST
NOT be treated as the source of truth for whether an effect
executed. The YieldEvent journal produced by
`@tisyn/effects` dispatch remains the sole source of truth
for executed-effect semantics. An `EffectRequestRecord`
whose `disposition === "executed"` describes what the
workflow decided; the journal describes what actually ran.
Replay correctness depends on the journal, never on
`EffectRequestRecord`.

Applications MAY consume `EffectRequestRecord` for audit,
review, or policy inspection. Applications MUST NOT rely on
it for correctness properties that are already covered by
journal replay.

---

## 6. Normative Invariants

### 6.1 LOOP-CTRL-1 — Control-state re-read

Before dispatching any non-Taras assistant step, the
workflow MUST apply every browser-origin control patch
that has arrived since the prior application. Patches are
pulled via `App.nextControlPatch()` (blocking) composed
with `timebox(0, ...)` to drain the queue
non-blockingly, and each pulled patch is merged into the
workflow's local `control` variable via
`Projection.applyControlPatch({ current, patch })` (see
§7.2 Step 2a). After the drain, if
`control.stopRequested` is `true`, the workflow MUST set
`readOnlyReason = "stopped"`, call `hydrate` once so the
browser sees the terminal state, and exit the loop
without dispatching a peer step. If `control.paused` is
`true`, the workflow MUST NOT dispatch a peer step on this
cycle; it MUST elicit Taras (returning to the Taras gate)
with `tarasMode = "optional"` instead.

The drain-and-merge MUST occur within the same cycle as
the potential peer dispatch. A `control` value computed on
an earlier cycle MUST NOT be used to gate a later cycle's
dispatch.

### 6.2 LOOP-GATE-1 — Taras gate at cycle start

Every cycle MUST begin with a Taras gate.

At the Taras gate the workflow presents the current
transcript state to Taras and waits for Taras input per
LOOP-GATE-2. If a Taras-origin input is received, the
workflow MUST persist it as a `TurnEntry` with
`speaker: "taras"` and proceed to the cycle's peer step.
If no Taras input is received within the gate's timeout
(optional mode), the workflow MUST proceed to the cycle's
peer step without a Taras-origin message.

### 6.3 LOOP-GATE-2 — Gate timeout semantics

When `RecursiveState.tarasMode === "required"`, the Taras
gate MUST be realized as `App.elicit({ message })` called
directly. The gate MUST block indefinitely; no timeout is
composed around it.

When `RecursiveState.tarasMode === "optional"`, the Taras
gate MUST be realized as `App.elicit({ message })` composed
inside `timebox(timeoutMs, ...)` per the Timebox
Specification. The default `timeoutMs` is 180000 (three
minutes); the value is a configurable workflow parameter.
The composition yields a `TimeboxResult<T>` tagged value
per Timebox Specification §5.3:

- `{ status: "completed", value: <Taras message> }` when
  Taras input arrives before the deadline
- `{ status: "timeout" }` when the deadline fires first

The workflow MUST branch on the tag. Timeout is a returned
outcome, not a thrown error (Timebox Specification
TB-S1, §9.2). The workflow MUST NOT use `try/catch` to
observe the timeout path.

When the duration is sourced from configuration via an
effect, the workflow MUST bind it in a prior statement-
position `yield*` before passing it to `timebox`, per
Timebox Specification §5.2.

### 6.4 LOOP-STEP-1 — At most one peer step per cycle

Each cycle MUST dispatch at most one peer step. A cycle MAY
dispatch zero peer steps if LOOP-CTRL-1 directs otherwise
(paused or stop-requested). A cycle MUST NOT dispatch two
or more peer steps.

### 6.5 LOOP-OVERRIDE-1 — One-shot speaker override

If `control.nextSpeakerOverride` is present when the
workflow selects the speaker for the current cycle's peer
step, the override value MUST supply the speaker and the
`nextSpeakerOverride` field MUST be cleared in `control`
within the same cycle. The clear MUST be applied via
`Projection.applyControlPatch({ current: control, patch: { nextSpeakerOverride: null } })`
so that replay reconstructs the cleared state identically.

After an override is consumed, subsequent cycles MUST
select the speaker per default alternation (LOOP-ALT-1)
unless a new override arrives via a `nextControlPatch`
drain on a later cycle.

### 6.6 LOOP-ALT-1 — Default alternation

Absent `LoopControl.nextSpeakerOverride`, the workflow MUST
select the speaker for the current cycle's peer step from
`RecursiveState.nextSpeaker`.

After a peer step completes, the workflow MUST toggle
`RecursiveState.nextSpeaker` between `"opus"` and `"gpt"`
for the next cycle's default selection.

### 6.7 LOOP-RESULT-1 — Peer steps return PeerTurnResult

Every peer step MUST return a `PeerTurnResult`. The
workflow MUST NOT consume the underlying
`CodeAgent.prompt` response directly for loop control. All
control decisions — next `tarasMode`, loop termination,
speaker selection — MUST derive from the structured
`PeerTurnResult`, not from the raw backend text.

The mapping from backend output to `PeerTurnResult` is the
peer wrapper's responsibility (§6.10).

### 6.8 LOOP-MODE-1 — Deterministic `tarasMode`

After a peer step completes, the workflow MUST set the
next cycle's `RecursiveState.tarasMode`:

- to `"required"` if the peer step returned
  `PeerTurnResult.status === "needs_taras"`
- to `"optional"` otherwise (i.e., for
  `"continue"` or `"done"`)

The next cycle's `tarasMode` MUST be determined solely by
the most recent `PeerTurnResult.status`. The workflow MUST
NOT derive `tarasMode` from any other source.

### 6.9 LOOP-DONE-1 — Loop termination on done

If a peer step returns `PeerTurnResult.status === "done"`,
the workflow MUST:

1. Project the turn per LOOP-PERSIST-1.
2. Dispose any `requestedEffects` per §6.12.
3. Set the local `readOnlyReason = "done"` and invoke
   `App.hydrate({ messages, control, readOnlyReason })`
   so the terminal read-only state reaches attached
   browsers (and is journaled for any later replay).
4. Return the final snapshot
   `{ messages, control, readOnlyReason }` from the loop
   body.

No further cycles execute after a `"done"` termination.
The terminal `hydrate` MUST be dispatched AFTER the
per-turn Projection appends so that replay reconstructs
the terminal snapshot identically on restart.

### 6.10 LOOP-PERSIST-1 — Per-turn projection

Durability for the four application-level record
collections is achieved exclusively by recording the
return values of Projection agent operations in the kernel
journal. On restart, the runtime replays the journal and
the workflow's local accumulators (`messages`, `control`,
`peerRecords`, `effectRequests`, `readOnlyReason`) are
rebuilt deterministically from the replayed Projection
return values. No secondary persistence file is
maintained, consulted, or reconciled.

For every peer step, the workflow MUST project both of the
following, independently:

- a `TurnEntry` with `speaker` set to `"opus"` or `"gpt"`
  corresponding to the dispatched peer, `content` equal to
  `PeerTurnResult.display`, and `usage` copied from
  `PeerTurnResult.usage` if present. The workflow passes
  its current `messages` local and the new entry to
  `Projection.appendMessage({ messages, entry })` and
  replaces its local `messages` with the returned array.
- a `PeerRecord` with the matching `turnIndex`, `speaker`,
  `status`, and `data`. The workflow passes its current
  `peerRecords` local and the new record to
  `Projection.appendPeerRecord({ records, record })` and
  replaces its local `peerRecords` with the returned
  array.

For every Taras-origin message received at the Taras gate,
the workflow MUST project a `TurnEntry` with
`speaker: "taras"` and `content` equal to the received
message via `Projection.appendMessage(...)`. No
`PeerRecord` is written for Taras-origin messages.

The workflow MUST call `App.hydrate(...)` once per main
loop iteration after the above projections settle so that
the journaled snapshot — and thus the live post-frontier
dispatch observed by attached browsers — reflects the
iteration's accumulated state.

### 6.11 M2-CAP-1 — Peer capability baseline

In MVP, peers MUST operate without direct access to
nondeterministic mutating backend tools. Any
workflow-relevant action beyond pure reasoning and
structured output emission MUST be requested through
`PeerTurnResult.requestedEffects`.

The concrete mechanism by which this restriction is
enforced is an implementation detail of each peer wrapper.
The normative requirement is the baseline, not any specific
adapter configuration flag. If a future backend release
renames or restructures the mechanism used to enforce the
baseline, the invariant still holds.

The baseline's MVP posture is a design decision of this
specification version, not a permanent architectural
claim. Future specification versions MAY amend the baseline
once deterministic effects of sufficient function exist
(§10).

### 6.12 M2-EXEC-1 — `requestedEffects` is the action surface

`PeerTurnResult.requestedEffects`, when present, is the
workflow-visible action surface. For each entry, the
workflow MAY:

- **execute** the effect by dispatching it through
  `@tisyn/effects` (producing ordinary YieldEvent journal
  entries); on success, record the disposition as
  `"executed"` with `result` populated from the effect's
  return value; on failure, record as `"executed"` with
  `error` populated
- **defer** the effect, recording the disposition as
  `"deferred"`; this disposition is terminal for this
  requested-effect record. A peer that still wants the
  action on a later cycle MUST emit a new
  `RequestedEffect` instance on a later turn; the
  workflow does not carry deferred requests forward.
- **reject** the effect with a reason, recording the
  disposition as `"rejected"` with `error` populated
- **surface to Taras**, recording the disposition as
  `"surfaced_to_taras"`; the workflow SHOULD present the
  effect to Taras via the next Taras gate so he may
  execute it manually

Every disposition is terminal for the requested-effect
record it produces. No disposition introduces a follow-up
record for the same requested-effect instance; the
single-record lifecycle of §5.8 is preserved for all four
dispositions.

The choice of disposition for a given effect is governed
by workflow policy. This specification does not fix one
disposition policy for all effects. Per-effect policy MAY
be defined by the separate effects-spec track (§8.4) and
consulted by the workflow.

The workflow MUST NOT execute an effect whose `id` is not
registered with `@tisyn/effects`. Such effects MUST be
rejected per the `"rejected"` disposition.

### 6.13 M2-EXEC-2 — Effect-request durability

Every requested effect MUST result in exactly one
`EffectRequestRecord` (§5.8) projected into the workflow's
local `effectRequests` accumulator via
`Projection.appendEffectRequest({ records, record })`
after the workflow has finalized the disposition. For the
`"executed"` disposition, the record is appended after
the execution attempt has completed (returning a value or
throwing).

The `EffectRequestRecord` is never mutated after being
appended. The Projection surface is append-only; this
specification introduces no update semantics.

`EffectRequestRecord` is a workflow-level disposition log.
It does not itself provide execution durability. Execution
durability for effects dispatched through `@tisyn/effects`
rides the ordinary YieldEvent journal produced by
dispatch; reconstruction of the `effectRequests`
accumulator on restart rides the journaled Projection
return values (§6.10, §7.3). This specification does not
introduce a parallel durability mechanism for effect
execution.

---

## 7. Cycle Algorithm

This section specifies the normative cycle algorithm in
step form. The algorithm MAY be realized as a recursive
workflow, a `while`-lowered loop body, or any authoring
form compiled to equivalent IR per the Tisyn Compiler
Specification §2.1. The authoring form is not normative;
the step sequence and invariants are.

### 7.1 Initial State

The loop body's `RecursiveState` (§5.3) and application-
level accumulators (`messages`, `control`, `peerRecords`,
`effectRequests`, `readOnlyReason`) are ordinary workflow-
execution state: they live in workflow-local variables,
flow through the kernel as part of the recursive
parameter/locals of each cycle, and are reconstructed on
restart by ordinary Tisyn journal replay per the Kernel
Specification's external-effect resumption path. The
runtime journal is the sole source of truth for every
reconstructed value.

This specification does not introduce a secondary
reconstruction mechanism. No application-data store is
consulted, read, or reconciled; no JSON file outside the
journal is maintained.

At the workflow's very first entry (the initial launch,
before any journal entries exist for this loop), the
workflow MUST initialize `RecursiveState` to:

- `nextSpeaker`: `"opus"`
- `tarasMode`: `"optional"`
- `turnCount`: `0`

The workflow MUST initialize its application-level
accumulators to:

- `messages`: `[]`
- `control`: the value returned by
  `Projection.readInitialControl({})` — in production the
  Projection binding returns `DEFAULT_LOOP_CONTROL =
  { paused: false, stopRequested: false }`; tests override
  this op to seed a non-default starting control. The
  return value is journaled like any agent-op result, so
  replay reconstructs the same starting control
  deterministically.
- `peerRecords`: `[]`
- `effectRequests`: `[]`
- `readOnlyReason`: `null`

No initial `App` operation is invoked before the main
loop's first iteration; the first `App.hydrate` call at
the top of the first iteration is what drives the browser
into its initial state.

On restart, replay returns the recorded result of
`Projection.readInitialControl` and every subsequent
Projection/agent op without re-dispatching to bindings,
and the workflow's local accumulators are rebuilt
identically. The first post-frontier `App.hydrate`
dispatches live and pushes the current snapshot to
attached browsers on the first wire trip after restart.

**Host-side post-execute publish.** A completed journal
(one ending in `readOnlyReason = "done"` or `"stopped"`)
can replay end-to-end without any live dispatch — the
runtime returns immediately and no `hydrate` ever reaches
the binding. To cover this case, the host driver that
invokes `execute(...)` MUST, after `execute` returns,
forward the workflow's final return value — the snapshot
`{ messages, control, readOnlyReason }` — into the App
binding via a non-agent publish method. This publish step
is NOT journaled and does NOT participate in replay. It
exists solely to guarantee that late-attaching browsers
observe the terminal state after a replay-only restart.
The publish step is idempotent against the live-hydrate
path.

### 7.2 Cycle Body

Per cycle, the workflow MUST execute the following steps in
order:

**Step 0. Hydrate.** Call
`App.hydrate({ messages, control, readOnlyReason })` so
the App binding's mirror reflects the state the workflow
locals finished building on the previous iteration (or the
initial state on the first iteration). On replay, prior
`hydrate` calls return from the journal and do not reach
the binding; the first post-frontier `hydrate` dispatches
live and drives attached browsers to the current state.

**Step 1. Taras gate.** Per LOOP-GATE-1 and LOOP-GATE-2:

- If `RecursiveState.tarasMode === "required"`, call
  `App.elicit({ message })` directly. The result is the
  Taras-origin message string.
- Otherwise, bind `timeoutMs` from configuration in a
  prior statement-position effect if needed, then call
  `timebox(timeoutMs, function* () { return yield* App.elicit({ message }); })`.
  The result is a `TimeboxResult<string>`:
  - If `status === "completed"`, `value` is the
    Taras-origin message string.
  - If `status === "timeout"`, no Taras-origin message
    arrived.

If a Taras-origin message is received (either branch),
project a `TurnEntry` with `speaker: "taras"` and
`content` equal to the received message via
`Projection.appendMessage({ messages, entry })` and
replace the local `messages` with the returned array. If
the gate timed out, proceed to Step 2a without projecting
a Taras-origin turn.

**Step 2a. Post-gate control-patch drain.** Per
LOOP-CTRL-1, drain every browser-origin control patch
that has arrived since the prior drain (including ones
that arrived while the Taras gate was blocking):

```
while (true) {
  const pulled = yield* timebox(0, function* () {
    return yield* App.nextControlPatch({});
  });
  if (pulled.status === "completed") {
    control = yield* Projection.applyControlPatch({
      current: control, patch: pulled.value,
    });
  } else {
    break;
  }
}
```

`timebox(0, ...)` peeks the `nextControlPatch` signal
non-blockingly; buffered patches are drained in order and
merged into `control`; once the queue is empty the drain
exits. Every subsequent step observes a `control` value
that incorporates every patch the browser has sent during
this iteration.

**Step 3. Stop check.** If `control.stopRequested`, set
`readOnlyReason = "stopped"`, call
`App.hydrate({ messages, control, readOnlyReason })`, and
return the final snapshot
`{ messages, control, readOnlyReason }` from the loop. No
peer step executes.

**Step 4. Pause check.** If `control.paused`, recurse
with `RecursiveState.tarasMode = "optional"`, `turnCount`
unchanged. No peer step executes this cycle.

**Step 5. Speaker selection.** Per LOOP-OVERRIDE-1 and
LOOP-ALT-1:
- If `control.nextSpeakerOverride` is present,
  `currentSpeaker = control.nextSpeakerOverride` and
  clear the override via
  `control = yield* Projection.applyControlPatch({ current: control, patch: { nextSpeakerOverride: null } })`.
- Otherwise, `currentSpeaker = RecursiveState.nextSpeaker`.

**Step 6. Peer dispatch.** Per LOOP-STEP-1 and
LOOP-RESULT-1:
- Construct `PeerTurnInput` from the current `messages`
  and `RecursiveState.tarasMode`.
- Dispatch `OpusAgent.takeTurn(input)` or
  `GptAgent.takeTurn(input)` as selected in Step 5.
- Receive `result: PeerTurnResult`.

**Step 7. Project turn.** Per LOOP-PERSIST-1:
- `messages = yield* Projection.appendMessage({ messages, entry: { speaker: currentSpeaker, content: result.display, ...(result.usage ? { usage: result.usage } : {}) } })`.
- `peerRecords = yield* Projection.appendPeerRecord({ records: peerRecords, record: { turnIndex: RecursiveState.turnCount, speaker: currentSpeaker, status: result.status, data: result.data } })`.

The peer `TurnEntry` MUST omit the `usage` key (not carry
a present-but-undefined value) when
`PeerTurnResult.usage` is absent.

**Step 8. Dispose requested effects.** Per M2-EXEC-1 and
M2-EXEC-2, for each entry in `result.requestedEffects`:

1. The workflow determines the disposition by policy:
   `"executed"`, `"deferred"`, `"rejected"`, or
   `"surfaced_to_taras"`.
2. If the disposition is `"executed"`, dispatch the
   effect through `@tisyn/effects`. If the dispatch
   returns a value, capture it; if the dispatch throws,
   capture the thrown error's name and message.
3. Project exactly one `EffectRequestRecord` via
   `effectRequests = yield* Projection.appendEffectRequest({ records: effectRequests, record })`
   carrying the final disposition and (for `"executed"`)
   the captured `result` or `error`. Records are
   append-only and are not mutated after appending.

Execution durability for effects dispatched in Step 8
rides the ordinary YieldEvent journal per §8.1; the
projected `EffectRequestRecord` is a workflow-level
audit/review artifact and is not the replay substrate.

**Step 9. Termination check.** Per LOOP-DONE-1, if
`result.status === "done"`, set `readOnlyReason = "done"`,
call `App.hydrate({ messages, control, readOnlyReason })`,
and return the final snapshot
`{ messages, control, readOnlyReason }` from the loop.

**Step 10. Next-state computation.** Per LOOP-MODE-1 and
LOOP-ALT-1:
- `nextTarasMode = result.status === "needs_taras" ? "required" : "optional"`.
- `nextSpeaker = currentSpeaker === "opus" ? "gpt" : "opus"`.
- `nextTurnCount = RecursiveState.turnCount + 1`.

**Step 11. Recurse.** Recurse with
`RecursiveState = { nextSpeaker, tarasMode: nextTarasMode, turnCount: nextTurnCount }`.

### 7.3 Replay Behavior

The loop participates in ordinary Tisyn kernel replay per
the external-effect resumption path (Kernel Specification
§4.3). On restart, the runtime reconstructs workflow state
by replaying the journal to the live frontier; the next
cycle then executes live against the reconstructed state.

The kernel journal is the sole durable artifact. Every
Projection-op return value is recorded as part of the
workflow's yield trace, and on replay the runtime returns
those recorded values without dispatching to the
Projection binding. The workflow's local accumulators
(`messages`, `control`, `peerRecords`, `effectRequests`,
`readOnlyReason`) are rebuilt deterministically from the
replayed return values. No secondary store is consulted,
maintained, or reconciled.

`App.hydrate` calls before the replay frontier are
similarly satisfied from the journal without re-dispatching;
the first post-frontier `hydrate` call dispatches live and
is observed by attached browsers. Terminal replay-only
runs rely on the host-side post-execute publish step
described in §7.1.

This specification does not introduce any replay semantics
beyond the existing external-effect path.

---

## 8. Relationship to Other Specifications

### 8.1 Preserved Invariants

This specification preserves the following invariants from
the existing Tisyn corpus:

| Specification | Preserved invariant |
|---|---|
| Kernel Specification | Durable stream algebra is `YieldEvent \| CloseEvent` only. No new event kinds. The journal is the sole source of truth for effect execution. |
| Runtime Specification | No new runtime plane. The loop is a workflow. |
| Compiler Specification | No new IR node. Recursive workflow lowering per §2.1. |
| Agent Specification | Progress notifications remain non-durable. Loop control does not ride progress. |
| Code Agent Specification | Base contract unchanged. Peer wrappers use `prompt` as specified. |
| Claude Code Specification | Adapter unchanged at the contract level. |
| Codex Specification | Adapter unchanged at the contract level. |
| Timebox Specification | `timebox` is the composition primitive for bounded waits. The loop uses `timebox` to bound the optional Taras gate per §6.3. Timeout is a returned tagged value (TB-S1), not a thrown error. No amendment to the Timebox Specification. |
| Browser Contract Specification | Generic transport contract unchanged. This example's App agent is example-specific. |
| Transport Specification | No new transport messages. |
| Protocol Specification | No new protocol messages. |
| Config Specification | No new config surface. Gate timeout is example workflow config. Portable value domain (Val) is reused for all serializable fields per §3.1. |
| Scoped Effects Specification | No amendment. |

### 8.2 Dependencies

This specification depends on the existence of the
`@tisyn/effects` effect-dispatch surface: the `Effects`,
`dispatch`, `resolve`, and `invoke` primitives. The
packaging and extraction of that surface is specified
separately. This specification does not itself define or
amend the `@tisyn/effects` public surface.

This specification depends on the base `CodeAgent`
contract for the underlying `prompt` operation. The
contract is unchanged by this specification.

This specification depends on `timebox` (Timebox
Specification §5) as the composition primitive for bounded
waits. The composition is used in §6.3 and §7.2 Step 1.

### 8.3 Adjacent Parked Amendment

An amendment to the base Code Agent Specification adding
an optional `PromptResult.usage` field (the "Track A"
amendment produced during the design work preceding this
specification) is ready to commit but parked pending
separate review. This specification's `PeerTurnResult.usage`
and `TurnEntry.usage` fields are forward-compatible with
that amendment: once the amendment lands, peer wrappers
MAY populate `usage` by propagating the underlying
`PromptResult.usage`, and the MVP `usage?: UsageSummary`
fields defined here receive values whose shape is
controlled by the Code Agent Specification.

Until the Track A amendment lands, `usage` fields in this
specification remain optional and unpopulated. The loop
workflow MUST tolerate `usage` absence on all records.

### 8.4 Effects Specification (Referenced, Not Defined Here)

The concrete baseline effect catalog registered with
`@tisyn/effects` is specified in a separate effects
specification (not yet drafted at this version). That
specification defines the set of `RequestedEffect.id`
values the loop workflow will accept and dispatch.

This specification does not enumerate the effect catalog,
does not constrain its composition, and does not reserve
specific effect IDs. The loop spec's correctness does not
depend on any particular effect's existence; peers that
emit `requestedEffects` referencing IDs unknown to
`@tisyn/effects` have their requests rejected per M2-EXEC-1.

Per Taras's direction, `@tisyn/effects` is intended as the
smallest common durable base. Capabilities beyond that
base SHOULD be exposed via custom agents invoked through
the normal agent contract surface, not by expanding
`@tisyn/effects`.

---

## 9. Required Amendments and Companion Documents

### 9.1 Companion Test Plan

A companion test plan
(`tisyn-deterministic-peer-loop-test-plan.md`) MUST be
drafted and reviewed before this specification is
implementation-ready. The test plan is produced after this
specification's adversarial review resolves.

### 9.2 Architecture Specification

The Tisyn Architecture Specification's package map table
SHOULD be updated to include the new
`examples/deterministic-peer-loop` example. This is a
package-map maintenance change, not a normative amendment.

### 9.3 Multi-Agent Chat Demo

The existing `examples/multi-agent-chat` demo MUST NOT be
modified by this specification. The fork is a separate
example. No amendment to the multi-agent-chat
specification text is required.

### 9.4 Other Specifications

No other specification requires amendment.

---

## 10. Open Questions and Deferred Items

### 10.1 OQ-L2 — Termination predicate composition (partial)

MVP termination is driven by three signals:
`status === "done"`, `LoopControl.stopRequested`, and
`App.setReadOnly(...)`. Additional termination predicates
(e.g., cumulative `usage.outputTokens` threshold,
turn-count budget) compose naturally with the existing
structure via `RecursiveState.turnCount` and
`TurnEntry.usage`, but are not required by MVP and are not
specified here. Deferred.

### 10.2 OQ-L9 — GPT-side adapter classification

Per the design decision recorded during spec development,
the GptAgent uses the `@tisyn/codex` adapter configured to
use GPT 5.4 as its backing model. This remains the
accepted MVP configuration. A future amendment MAY
introduce a distinct adapter profile for the GPT-5.4
conversational API (if one is developed). Until then, the
Codex-configured-for-GPT-5.4 path is the conforming one.
Deferred.

### 10.3 OQ-E1 — Baseline effect catalog

The concrete set of `RequestedEffect.id` values accepted
by `@tisyn/effects` is deferred to the separate effects
specification (§8.4). This specification's normative
correctness does not depend on any specific effect set.

### 10.4 OQ-L11 — Revert-to-prior-stream-position

User-directed revert to a prior point in the durable
stream is reserved future work. It is expected to compose
with the existing journal substrate without requiring a
new event kind or runtime primitive, but its exact shape
is not specified here. Deferred.

### 10.5 OQ-P1 — Peer-wrapper parsing strategy

The peer wrappers' method for translating backend
`PromptResult.response` into `PeerTurnResult` is an
implementation concern. MVP uses a prompt-engineered
sentinel format (the peer instructs the underlying agent
to emit a fenced structured block). A future amendment
MAY upgrade to tool-call-native structured output from the
backends without altering this specification's contract.
The parsing strategy is not normative.

### 10.6 OQ-W1 — `PeerTurnResult.data` taxonomy

MVP constrains `data` to portable serializable values
(Val) without prescribing a shape taxonomy. A future
amendment MAY introduce a typed taxonomy for common
handoff shapes (e.g., proposed code changes, proposed
specifications, review comments). No reservation is made
here; any taxonomy introduced later MUST remain within the
Val domain.

### 10.7 OQ-W2 — Divergent per-agent peer contracts

MVP shares one contract shape between the two peers:
`takeTurn(PeerTurnInput) -> PeerTurnResult`. Future
amendments MAY specialize per-agent input or output
shapes per §4.5. No specific divergence is reserved or
forbidden.

---

## 11. Rejected Alternatives

### 11.1 `converge`-based loop body

An earlier design considered using the `converge`
primitive as the loop's control abstraction. Rejected
because:

- The loop is a serial turn-taking state machine, not a
  probe-until-convergence problem.
- `converge` introduces surface (`probe`, `until`,
  `interval`, `timeout`) not needed for MVP.
- Explicit recursive workflow structure makes the cycle
  algorithm (§7.2) inspectable and composable with
  future extensions.

`converge` remains available as a Tisyn primitive; this
specification simply does not use it.

### 11.2 File-based `LoopIO` contract

An earlier design proposed a bespoke single-agent
`LoopIO` contract with file-backed `readTask`,
`appendTurn`, and `checkStop` operations. Rejected in
favor of forking the existing multi-agent-chat substrate,
which already provides equivalent functionality through
the App and Projection agents and adds browser-interactive
control affordances not available through files.

### 11.2.1 JSON-file DB agent (earlier MVP sketch)

An earlier pass of this specification kept a stateful DB
agent that persisted transcript / control / peer-record /
effect-request collections to a JSON file parallel to the
kernel journal. Rejected because:

- It doubled the durable surface (journal plus JSON file)
  and required hand-kept schema parity between them. A
  concrete bug (a peer `TurnEntry` carrying a
  present-but-undefined `usage` key) came from the store
  schema rejecting a shape the workflow was free to
  produce.
- It diverged from the kernel's design, where the
  journal IS the source of truth and downstream state is
  rebuilt from it by runtime replay.
- The JSON store's contribution — rehydration at startup
  — is subsumed by replay of Projection-op return
  values, so the store added cost without adding
  correctness.

The journal-only model (Projection reducer + App hydrate,
§4) replaced it.

### 11.3 Separate `EffectAgent` contract

An earlier design proposed a separate `EffectAgent`
contract with an `execute(effect)` operation for
disposing peer-requested effects. Rejected because
`@tisyn/effects` provides the dispatch boundary directly.
Effects are not an agent category; they are primitives in
the effect algebra. The workflow disposes requested
effects by calling `yield* dispatch(id, input)` through
`@tisyn/effects` — producing ordinary YieldEvent journal
entries — with no new agent contract required.

### 11.4 Native backend tools behind peer wrappers (M1)

An earlier design considered allowing backend-native
nondeterministic tools to operate behind peer wrappers as
a transitional concession, on the theory that wrappers
would "quarantine" the nondeterminism. Rejected because:

- The elimination invariant Taras stated has no caveats;
  a softened MVP misrepresents it.
- Wrapper quarantine preserves control-flow determinism
  but not world-state determinism: backend-native tools
  can mutate files, and the workflow replay would not
  reflect those mutations.
- Capability-restricting the backends at the adapter
  configuration layer (M2-CAP-1) achieves the same MVP
  goals without accepting silent mutation.

M2 (capability-restricted peers; structured effect
requests as the action surface) was adopted instead.

### 11.5 `requestedEffects` as advisory-only

An earlier variant of M2 treated `requestedEffects` as
advisory metadata — durably recorded but not executable
in MVP. Rejected because peers must have some path to
effect change for the loop to be useful beyond pure
design conversation, and `requestedEffects` is the only
architecturally clean path consistent with M2-CAP-1.
`requestedEffects` is therefore the active action surface
from MVP, disposed per M2-EXEC-1, rather than a
forward-compatibility slot.

### 11.6 Dedicated loop primitive

Introducing a new kernel or runtime primitive for the
loop was rejected at every stage on MVP-discipline and
strict-kernel-boundary grounds. The loop is a workflow.

### 11.7 Separate `elicitWithTimeout` operation

An earlier draft of this specification proposed a distinct
`elicitWithTimeout(prompt, timeoutMs)` operation on the App
agent. Rejected because Tisyn provides `timebox` as a
settled primitive (Timebox Specification §5, §9; Compiler
Specification §2.1) for composing bounded waits around any
effect. Introducing a second elicit-shaped operation would
duplicate the timeout vehicle, inflate the App agent
surface, and create two idioms for the same composition.
Composing `elicit` inside `timebox` is the Tisyn-idiomatic
form and is the only form this specification defines.

---

## 12. Conformance Observable Boundary

The following are normative and observable:

- the cycle algorithm's step ordering (§7.2)
- the invariants in §6.1 through §6.13
- the type shapes in §5
- the agent operation signatures in §4
- the record schemas projected by the Projection agent
  and carried in the workflow's local accumulators
  (`TurnEntry`, `PeerRecord`, `EffectRequestRecord`,
  `LoopControl`)
- the `App.hydrate` snapshot schema
  (`{ messages, control, readOnlyReason }`) as the
  observable per-iteration boundary between workflow and
  browser

The following are NOT normative (implementation-defined):

- the concrete adapter configuration flags used to realize
  the capability baseline (§6.11)
- the peer wrappers' prompt construction details (§4.3,
  §4.4)
- the peer wrappers' `PromptResult.response` parsing
  strategy (OQ-P1)
- the internal representation of `LoopControl` in the
  browser UI
- the kernel journal's NDJSON encoding details (governed
  by the Kernel Specification, not this one)
- the WebSocket framing details
- per-effect disposition policy (§6.12; governed by
  workflow policy, not this specification)

---

*End of specification.*
