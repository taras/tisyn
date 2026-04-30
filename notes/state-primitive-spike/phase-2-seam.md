# State Primitive Spike — Phase 2 Seam

## Seam description (one half-page)

The current peer-loop encodes "state durability" as a sequence of
yields against a synthetic `Projection` agent that is itself a pure
reducer. State enters the journal only because the kernel records
every yield's `(description, result)` pair on the way through; the
authored workflow recovers state on replay because the runtime
returns each recorded `result.value` from `ReplayIndex` without
re-firing the binding. The browser-side mirror is a separate path:
the workflow author calls `App().hydrate({...})` once per loop
iteration to push the workflow's `let` locals into the App
binding's session manager, which broadcasts them over WebSocket.

The spike's seam is the line between **"state-affecting yield"** and
**"observer broadcast"**. Today both go through agent ops that the
workflow author has to remember to call. The spike collapses both
into one primitive: the workflow yields one
`StateAgent().transition(proposal)` call per state change; that
yield records the proposal's `(description, result)` pair into the
journal exactly like a `Projection` call would, but the binding
side delegates to a host-owned `authority` module that *also*
notifies an observer subscription. The browser session manager is
just one such subscriber; the authority is seeded at host startup
by folding prior accepted-transition events out of the journal.

After the seam moves:

- `Projection` agent disappears entirely (its 5 ops collapse into 1
  `transition` op with a tagged-union proposal payload).
- `App.hydrate` disappears entirely (its 3 call sites are unneeded
  because the authority broadcasts on every accept and on first
  session attach).
- The workflow's 5 per-field locals (`messages`, `control`,
  `peerRecords`, `effectRequests`, `readOnlyReason`) collapse into
  one rolling `let state: AppState` seeded from
  `authority.getState()`.
- The workflow's 3 loop-control locals (`nextSpeaker`, `tarasMode`,
  `turnCount`) stay as separate locals — they are not projected
  state.

The seam is intentionally a **higher-level workflow primitive on
top of the existing kernel**, not a new kernel feature. If the
spike works it answers the design question "can a state primitive
live above the kernel as a vendor-supplied agent + reducer pair?"
in the affirmative. If it doesn't work, the failure mode points at
exactly which kernel/runtime constraint is the gap.

## Workflow call sites being replaced (with file:line)

All paths below are in
`examples/deterministic-peer-loop/src/workflow.ts` unless
otherwise noted.

| Site | Current call | Replacement |
|------|--------------|-------------|
| Line 201 | `let control: LoopControl = yield* Projection().readInitialControl({});` | `let state: AppState = authority.getState();` (no yield; deterministic since authority was journal-seeded at host startup) |
| Line 158 (in `drainControlPatches`) | `current = yield* Projection().applyControlPatch({ current, patch: pulled.value });` | `state = yield* acceptTransition({ tag: "apply-control-patch", patch: pulled.value });` (drainControlPatches refactored to take/return rolling `state`) |
| Lines 259-262 (consume-override clear) | `control = yield* Projection().applyControlPatch({ current: control, patch: { nextSpeakerOverride: null } });` | `state = yield* acceptTransition({ tag: "apply-control-patch", patch: { nextSpeakerOverride: null } });` |
| Line 236 (Taras-message append) | `messages = yield* Projection().appendMessage({ messages, entry });` | `state = yield* acceptTransition({ tag: "append-message", entry });` |
| Line 278 (peer-turn append) | `messages = yield* Projection().appendMessage({ messages, entry: peerEntry });` | `state = yield* acceptTransition({ tag: "append-message", entry: peerEntry });` |
| Lines 285-288 (peer record) | `peerRecords = yield* Projection().appendPeerRecord({ records: peerRecords, record: peerRecord });` | `state = yield* acceptTransition({ tag: "append-peer-record", record: peerRecord });` |
| Line 86 (`dispatchExecuted`, ok branch) | `const appended = yield* Projection().appendEffectRequest({ records, record });` | `state = yield* acceptTransition({ tag: "append-effect-request", record });` (sub-workflow takes/returns rolling state) |
| Line 97 (`dispatchExecuted`, error branch) | same as above | same |
| Line 121 (`dispatchEffect`, executed branch) | dispatched through `dispatchExecuted` | absorbed into the rewritten `dispatchExecuted` |
| Line 132 (`dispatchEffect`, deferred branch) | `const appended = yield* Projection().appendEffectRequest({ records, record });` | `state = yield* acceptTransition({ tag: "append-effect-request", record });` |
| Line 142 (`dispatchEffect`, rejected branch) | same shape | same |
| Line 211 (`peerLoop`, top of loop) | `yield* App().hydrate({ messages, control, readOnlyReason });` | **deleted** — authority subscription handles broadcast |
| Line 247 (`peerLoop`, stop path) | `yield* App().hydrate({ messages, control, readOnlyReason });` | **deleted** — final `set-read-only` transition via authority broadcasts the terminal snapshot |
| Line 305 (`peerLoop`, done path) | `yield* App().hydrate({ messages, control, readOnlyReason });` | **deleted** — same as above |

In addition to per-site rewrites, the rolling-state refactor adds
one transition site that today is implicit: **after the workflow
sets `readOnlyReason = "stopped"` or `readOnlyReason = "done"`**
(workflow.ts:246, 304), the spike issues
`acceptTransition({ tag: "set-read-only", reason })` so the
authority sees and broadcasts the terminal state instead of
relying on the now-deleted hydrate call.

## App-binding consumer side being replaced

All paths below are in
`examples/deterministic-peer-loop/src/browser-agent.ts` unless
otherwise noted.

- `browser-agent.ts:120-122` — `hydrate` handler: **deleted**.
- `browser-agent.ts:89-99` — `applySnapshot` helper inside the
  binding: **moved** into `browser-session.ts` as a session method
  consolidating `loadChat`/`publishControl`/`setReadOnly`.
- `browser-agent.ts:154-156` — `publishFinalSnapshot` non-agent
  method called by `main.ts:21-32`: **deleted**. Replaced by the
  `createBinding()`-owned subscription that pushes
  `session.applySnapshot(authority.getState())` on first session
  attach (covers the late-attach late-replay case from Phase 1's
  hypothesis-#5 nuance).

## Code paths intentionally left untouched

- Peer dispatch via `OpusAgent`/`GptAgent` (out of scope; not state
  projection).
- Effect policy + queue + handler via `Policy`/`EffectsQueue`/
  `EffectHandler` (out of scope; the effect dispositions still flow
  through the workflow's call to `acceptTransition({ tag:
  "append-effect-request", ... })` but the dispatch shape doesn't
  change).
- Browser ingress via `App.elicit` and `App.nextControlPatch` —
  these are user-input channels, not state-projection channels;
  they stay exactly as today.
- The post-gate control-patch drain (`drainControlPatches` shape
  in `workflow.ts:149-167`) stays. Only the inner
  `applyControlPatch` *implementation* moves into the authority
  via `StateAgent.transition`. The outer
  `App().nextControlPatch`/`timebox` peek-and-drain shape is
  preserved.
- Workflow locals `nextSpeaker`, `tarasMode`, `turnCount` —
  loop-control state, not projected `AppState`.
- The runtime's replay path
  (`packages/runtime/src/execute.ts` replay-bypass) — no kernel
  changes.
- `runDescriptorLocally` (`packages/cli/src/run-descriptor.ts`) —
  no hook needed (Phase 1 step 5 confirmed `FileStream` is public,
  so `main.ts` reads the journal directly before calling
  `runDescriptorLocally`).

## Summary

11 `Projection` call sites + 3 `App.hydrate` call sites in
`workflow.ts` collapse into **N+1 `acceptTransition` sites**, where
N = the count of distinct state mutations (one per Projection site)
and the +1 is the explicit `set-read-only` transition that replaces
the implicit "let-local update + hydrate" pattern at the
stop/done branches. The 3 hydrate sites disappear.

`projection-agent.ts` deletes entirely (with `mergeControlPatch`
copied first into `state-authority.ts`). The `App.hydrate`
operation is removed from `App` and from the binding handler set.
`publishFinalSnapshot` is removed. The 5 projected workflow locals
collapse into 1 rolling `state: AppState`.

Phase 3 can now build the new modules and Phase 4 can perform the
deletions.
