# State Primitive Spike — Phase 1 Confirmation

Verifying the seven working hypotheses from the spike prompt against
the actual peer-loop code on `state-primitive-spike` at commit
`80fa0f0` (branched from `origin/deterministic-peer-loop-impl`,
post-rebase onto current `origin/main` which carries PR #145
payload-sensitive replay). All file:line citations are against this
worktree.

The note is read-only diagnosis — no code is changed in Phase 1.

## Substrate prerequisite (Phase 1 step 5)

**Verdict — `@tisyn/durable-streams` exposes the public surface the
spike needs.** The spike's host driver can read the journal directly
without adding any hook to `runDescriptorLocally`.

- `packages/durable-streams/package.json` — single root export `.`
  with `types`/`import` pointing at `./dist/index.js`.
- `packages/durable-streams/src/index.ts:1-3`:
  ```ts
  export { type DurableStream, InMemoryStream } from "./stream.js";
  export { FileStream } from "./file-stream.js";
  export { ReplayIndex, type YieldEntry } from "./replay-index.js";
  ```
  `FileStream`, `InMemoryStream`, `ReplayIndex`, `DurableStream`,
  and `YieldEntry` are all public.
- `packages/durable-streams/src/file-stream.ts` — `FileStream`
  takes an absolute path in its constructor and exposes
  `append`/`readAll` returning `DurableEvent[]`.
- `packages/kernel/src/events.ts:3-28` — `DurableEvent` is the
  union `YieldEvent | CloseEvent`. **Post-rebase**, `YieldEvent`
  carries `description: { type, name, input?, sha? }` (PR #145
  added the `input` and `sha` fields) and `result: { status,
  value? }`. The `description.input` and `description.sha`
  fields are not used by the spike's *implementation* (per
  Decision #6: spike uses result-based fold), but the Phase 5
  report MUST evaluate whether a future design could fold from
  `description.input` instead.

**Implication for Phase 3.5:** the example's `main.ts` can do

```ts
const stream = new FileStream(resolve(JOURNAL_PATH));
const events = yield* stream.readAll();
const seedTransitions = events.flatMap(e =>
  e.type === "yield"
    && e.description.type === "__state"
    && e.description.name === "transition"
    && e.result.status === "ok"
    ? [e.result.value as AcceptedTransition]
    : []
);
authority.seed(seedTransitions);
```

Phase 3.5's "fallback hook on `runDescriptorLocally`" is **not
needed**. The spike stays fully example-local for the runner seam.
The fallback remains documented but unused.

## Hypotheses

### 1. Projection is pure and exists mainly to journal state transitions

**Verdict: confirmed.**

Evidence — `examples/deterministic-peer-loop/src/projection-agent.ts`:

- File-level docstring (lines 1-8) calls out the contract:
  > "Holds no cross-call state, performs no I/O, does not read the
  > journal. Every operation is a pure function of its inputs..."
- Five binding handlers (lines 60-76): every one is a generator
  that takes its full prior state as a parameter and returns a
  derived value with no module-level mutation, no captured closure
  vars, no I/O.
  - `readInitialControl` returns `DEFAULT_LOOP_CONTROL` (a constant).
  - `applyControlPatch` delegates to the pure `mergeControlPatch`
    helper (lines 43-56).
  - `appendMessage` returns `[...messages, entry]`.
  - `appendPeerRecord` returns `[...records, record]`.
  - `appendEffectRequest` returns `[...records, record]`.
- `createBinding` at lines 58-78 takes a `_config` it ignores and
  returns the binding object. No state crosses calls.

The agent's only effect is being part of the journal trace. Each
call lands as a `YieldEvent` whose recorded result is the projected
value the workflow keeps. On replay the runtime returns the
recorded value without re-firing the binding (replay-bypass at
`packages/runtime/src/execute.ts`, verified during plan-phase
exploration). The agent is therefore a journaling vehicle with no
semantic content of its own.

### 2. App.hydrate exists mainly to push workflow-owned state into the browser/session mirror

**Verdict: confirmed.**

Evidence — `examples/deterministic-peer-loop/src/browser-agent.ts`:

- File-level docstring (lines 9-13):
  > "`hydrate({messages, control, readOnlyReason})` pushes the
  > current workflow-owned snapshot into the session-manager mirror
  > and broadcasts to attached browsers. Called once per main-loop
  > iteration; during replay all but the frontier `hydrate` are
  > replayed from the journal and never reach the binding."
- `hydrate` operation declaration at lines 41-48: input is the
  full triple `{messages, control, readOnlyReason}`; return is
  `void`. No data flows from binding back to workflow.
- Handler at lines 120-122 calls `applySnapshot(snapshot)`.
- `applySnapshot` at lines 89-99 calls `session.loadChat`,
  `session.publishControl`, and conditionally `session.setReadOnly`
  — all three methods are pure broadcasts to attached owner +
  observer WebSockets (`browser-session.ts:101-149`).

The `void` return type makes it syntactically impossible for the
binding to feed information back to the workflow through this op.

The non-agent `publishFinalSnapshot` method (lines 154-156) is the
same `applySnapshot` call, exposed for the post-replay terminal-
state broadcast `main.ts` performs after `runDescriptorLocally`
returns.

### 3. State enters the journal through Projection yields, not through a first-class state primitive

**Verdict: confirmed.**

Evidence — `examples/deterministic-peer-loop/src/workflow.ts`:

- Line 201: `let control: LoopControl = yield* Projection().readInitialControl({});`
- Line 158 (in `drainControlPatches`):
  `current = yield* Projection().applyControlPatch({ current, patch: pulled.value });`
- Lines 259-262 (consume-override clear inside `peerLoop`):
  `control = yield* Projection().applyControlPatch({ current: control, patch: { nextSpeakerOverride: null } });`
- Line 236 (Taras-message append): `messages = yield* Projection().appendMessage({ messages, entry });`
- Line 278 (peer-turn append): `messages = yield* Projection().appendMessage({ messages, entry: peerEntry });`
- Lines 285-288: `peerRecords = yield* Projection().appendPeerRecord({ records: peerRecords, record: peerRecord });`
- Five `Projection().appendEffectRequest(...)` calls in
  `dispatchExecuted` and `dispatchEffect` (workflow.ts lines 86,
  97, 121, 132, 142).

Every state-affecting step in the workflow goes through a
`Projection` agent yield. There is no other path by which state is
journaled. There is no first-class "state" primitive — `Projection`
*is* the first-class primitive for state in the current design.

The three `App().hydrate` call sites (lines 211, 247, 305) are
observer broadcasts, not state durability — hydrate is `void`-
returning and the workflow never re-reads its result.

### 4. Workflow-visible state is threaded through closure locals

**Verdict: confirmed.**

Evidence — `peerLoop` body, `workflow.ts:200-207`:

```ts
let messages: TurnEntry[] = [];
let control: LoopControl = yield* Projection().readInitialControl({});
let peerRecords: PeerRecord[] = [];
let effectRequests: EffectRequestRecord[] = [];
let readOnlyReason: string | null = null;
let nextSpeaker: PeerSpeaker = "opus";
let tarasMode: "optional" | "required" = "optional";
let turnCount = 0;
```

Eight `let` locals carry every piece of mutable workflow state.
The first five (`messages`, `control`, `peerRecords`,
`effectRequests`, `readOnlyReason`) are the *projected* fields
the spike's `AppState` envelope replaces. The last three
(`nextSpeaker`, `tarasMode`, `turnCount`) are loop-control fields
the spike intentionally leaves on the workflow stack (decision
#7).

### 5. Replay correctness does not depend on a separate persistence authority

**Verdict: confirmed, with one important nuance.**

Evidence:

- The example deletes its old separate persistence layer
  (`src/store.ts`, `src/db-agent.ts`, `src/file-journal-stream.ts`)
  in PR #119; correctness is now derived purely from the kernel
  journal.
- The runtime's replay invocation site
  (`packages/runtime/src/execute.ts`) consults
  `ReplayIndex.peekYield(coroutineId)` and returns the recorded
  result directly when one exists. No binding is consulted; no
  second authority is read.
- The example's tests (`test/replay/journal-replay.test.ts` and
  the 27 conformance tests) pass without any external authority
  besides the journal file.

**Nuance:** there is a subtle late-attach concern that PR #119
addresses with `publishFinalSnapshot` (`browser-agent.ts:154-156`,
`main.ts:21-32`): if the journal contains a *completed* run
(workflow returned `done`/`stopped`), replay completes
end-to-end without any hydrate ever firing live, so a browser
attaching after restart would see nothing. The fix is a host-side
non-journaled publish step that pulls the workflow's final
return value from `runDescriptorLocally`'s continuation and
broadcasts it.

The spike's authority-subscription model covers this naturally: in
`createBinding()`, on first session attach, the binding pushes
`session.applySnapshot(authority.getState())` so a late-arriving
browser sees the post-seed state. The nuance is operationally
benign.

### 6. The reducer/fold logic is already pure or nearly pure

**Verdict: confirmed.**

Evidence — `projection-agent.ts:43-56` (`mergeControlPatch`) and
the five binding handlers (lines 60-76):

- `mergeControlPatch`: pure function of `(current, patch)` →
  returns a new object; no mutation of inputs; explicit handling
  of three cases for `nextSpeakerOverride`.
- `appendMessage` / `appendPeerRecord` / `appendEffectRequest`:
  literal `[...prev, item]` with no side effects.
- `readInitialControl`: returns `DEFAULT_LOOP_CONTROL`, a frozen-
  by-convention constant.

The reducer logic transports cleanly into `state-authority.ts` by
copying `mergeControlPatch` verbatim and inlining the three
append cases as `accept` arms. No purification work needed.

### 7. Browser control mutations enter through a deterministic queued-patch path

**Verdict: confirmed.**

Evidence:

- Browser-side ingress: `browser-agent.ts:76-87` constructs a
  `controlPatches: BrowserControlPatch[]` array and a
  `patchReady` signal; the session-manager hook
  (`onUpdateControl(patch)`) pushes onto the queue and pulses
  the signal.
- Workflow-side blocking pull: `browser-agent.ts:113-119`
  `nextControlPatch` handler — blocks on `patchReady` until
  `controlPatches.length > 0`, then `shift()`s one patch.
- Workflow-side drain: `workflow.ts:149-167` `drainControlPatches`
  uses `timebox(0, ...)` to peek the queue non-blockingly, drains
  every available patch through `Projection().applyControlPatch`,
  and exits on the first `expired` outcome. The drain runs
  exactly once per main-loop iteration, immediately after the
  Taras gate, before stop/paused/override checks read `control`.
- Determinism: FIFO queue, exhaustive drain, fixed point in the
  loop. Replay determinism comes from each `nextControlPatch`
  outcome being journaled as a normal `YieldEvent`.

The spike preserves this path unchanged. Only the
`applyControlPatch` *implementation* moves into
`state-authority.ts`; the queue + drain shape stays.

## Summary

| # | Hypothesis | Verdict |
|---|------------|---------|
| 1 | Projection is pure and exists mainly to journal state | confirmed |
| 2 | App.hydrate pushes workflow state into browser mirror | confirmed |
| 3 | State enters journal through Projection yields, not first-class primitive | confirmed |
| 4 | Workflow-visible state threaded through closure locals | confirmed |
| 5 | Replay correctness does not depend on separate authority | confirmed (with late-attach nuance noted) |
| 6 | Reducer/fold logic is pure or nearly pure | confirmed |
| 7 | Browser control mutations enter through deterministic queued-patch path | confirmed |
| substrate | `@tisyn/durable-streams` exposes public file-stream constructor | confirmed |

**Spike scope stands unchanged.** Every load-bearing assumption in
the plan holds. The runner-seam decision can be tightened: Phase
3.5 will use `new FileStream(JOURNAL_PATH)` from
`@tisyn/durable-streams` directly, with no `runDescriptorLocally`
hook required. The plan's fallback option remains documented but
is not the chosen path.

Phase 2 (seam description) can begin without scope adjustments.
