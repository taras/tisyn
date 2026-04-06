# Claude Code Plan Mode Handoff

## Goal

Implement the minimum Claude Code Plan Mode surface described by the imported source docs without weakening the existing runtime/compiler model.

The result should add:

- `ClaudeCode().open(...)` as a session-scoped, resource-backed capability
- `cc.plan(...)` returning a restricted execution handle
- `yield* planned` direct-join semantics
- `yield* supervise(planned, handler)` supervised event consumption
- `cc.fork()` returning an isolated branch capability with `plan()` only
- durable final results with ordinary replay
- live-only, non-durable event delivery

## Source Documents

Imported into this worktree:

- `claude-code-plan-mode-spec.source.md`
- `claude-code-plan-mode-test-plan.source.md`

Treat those as the source of truth for scope and conformance intent. This handoff narrows them to the current repo and current implementation seams.

## Repo Facts To Preserve

1. There is no existing Claude Code / Plan Mode surface in the repo yet.
   No `ClaudeCode`, `supervise`, or plan-handle implementation exists today. This is a new feature track, not an adjustment to existing public behavior.

2. Resource-backed capability lifetimes already have a runtime/compiler model.
   The repo already supports authored `resource(...)` / `provide(...)`, scoped teardown, and replayed re-entry boundaries. Reuse that model for `ClaudeCode().open(...)` rather than inventing a parallel lifecycle mechanism.

3. Joinable restricted handles already have a nearby precedent.
   `spawn(...)` and `yield* task` already model a restricted joinable capability with compiler/runtime rules. The plan execution handle is not the same type, but it should borrow the same compiler-first / runtime-backstop discipline.

4. Durable replay already exists generically in the runtime.
   `packages/runtime/src/execute.ts` owns YieldEvent journaling, replay matching, and DivergenceError behavior. Final `plan()` results should use that machinery instead of bespoke persistence.

5. Remote routing and protocol serving already exist generically.
   `installRemoteAgent`, `useTransport`, `createProtocolServer`, and `session.ts` already establish the ordinary host/remote dispatch path. Any Claude Code adapter should fit that stack rather than bypass it.

6. Compiler setup/body partitioning already matters.
   `packages/compiler/src/emit.ts` already treats setup forms (`useTransport`, middleware) specially inside `scoped()`. New authored forms must fit coherently into that compiler model instead of smuggling setup through expression lowering.

7. Existing conformance style uses narrow, behavior-first tests.
   The repo already splits compiler acceptance/rejection, runtime replay/journal, and transport/protocol tests. Keep the Claude Code work close to those existing seams.

## Non-Goals

Do not:

- implement `accept()`
- add durable workflow-consumed event streaming
- implement merge/promote or cross-branch communication
- implement branch-of-branch recursion
- add generic ACP abstractions beyond what this feature needs
- couple the runtime to a specific provider SDK or transport backend
- redesign the existing resource, replay, or transport architecture

## Required Outcome

Land one bounded v1 pass that covers the Core behavior from the imported conformance plan.

That means:

1. `ClaudeCode().open(...)` returns a scoped capability with `plan()` and `fork()`.
2. `cc.fork()` returns a scoped branch capability with `plan()` only.
3. `cc.plan(...)` returns a single-consumer restricted handle.
4. `yield* planned` returns the final durable result.
5. `supervise(planned, handler)` delivers buffered ordered events and then the final result.
6. Events are never journaled and are never replayed.
7. Replay of completed plans returns stored final results without re-contacting the adapter.
8. Runtime backstops dynamic misuse that the compiler cannot reject statically.

## Likely Code Areas

Primary authored-surface and diagnostics work:

- `packages/compiler/src/emit.ts`
- `packages/compiler/src/compiler.test.ts`
- `packages/compiler/src/compiler-runtime.test.ts`

Primary runtime/orchestration work:

- `packages/runtime/src/execute.ts`
- `packages/runtime/src/replay.test.ts`
- `packages/runtime/src/resource.test.ts`
- `packages/runtime/src/spawn.test.ts`
- `packages/runtime/src/scope.test.ts`

Primary transport / mock-adapter work:

- `packages/transport/src/install-remote.ts`
- `packages/transport/src/session.ts`
- `packages/transport/src/protocol-server.ts`
- `packages/transport/src/transports/inprocess.ts`

You do not have to use those exact filenames for every new test, but keep changes near the current compiler/runtime/transport split.

## Implementation Direction

### 1. Model `open()` as a real scoped resource

Do not implement `ClaudeCode().open(...)` as a plain value constructor or a fake agent call.

The imported spec makes this a resource-backed capability with scope-bound lifetime and replay reconstruction. The cleanest fit is to reuse the repo's resource orchestration model so session acquisition/teardown participates in existing structured concurrency and replay boundaries.

### 2. Treat the plan handle as a new restricted capability category

Do not pretend the result of `cc.plan(...)` is just a spawn task or stream handle.

It needs:

- direct join
- supervised event consumption
- single-consumer ownership
- compiler restrictions on escape/misuse
- runtime rejection for dynamic misuse that bypasses the compiler

Borrow the enforcement style from existing restricted handles, but keep the type/category distinct.

### 3. Keep final durability generic and events live-only

The final plan result should flow through ordinary YieldEvent persistence and replay.

Event delivery should remain ephemeral:

- buffered from execution start
- delivered only through `supervise(...)`
- absent from the journal
- absent during replay
- cancelled if the supervising handler fails

Do not add new durable event record types for plan events.

### 4. Keep the adapter boundary narrow

The conformance plan explicitly allows mock-adapter evidence and expects Runtime + Adapter coverage, but the public surface should stay backend-neutral.

Implement a minimal mock Claude Code transport/adapter fixture that can:

- open a session
- emit configured event envelopes
- return a configured final result
- return a configured error
- support forked isolated session state
- report whether replay contacted it

Do not bind the runtime directly to a provider SDK.

### 5. Compiler work should stay semantic, not syntax-heavy

The spec calls for new authored forms and restrictions, but it does not require overcommitting to a single lowering shape where the current architecture can preserve semantics with implementation freedom.

Compiler work should focus on:

- recognizing valid authored forms
- rejecting invalid escape/misuse patterns
- preserving scope/lifetime semantics
- lowering to the runtime substrate in a way that keeps replay and teardown behavior correct

### 6. Unknown event types must pass through

The imported spec/test plan explicitly corrected this obligation: the runtime must treat event types as an open set and deliver unknown types without rejecting them. Handler behavior for unknown types is up to user code.

## Test Bar

Cover the Core behavior from `claude-code-plan-mode-test-plan.source.md`.

At minimum, the implementation must prove:

- open returns the correct capability shape
- branch capability shape omits `fork()`
- plan returns a restricted handle
- direct join returns the final result
- supervise observes ordered buffered events and then returns the final result
- events have `type` and `data`
- events are not journaled
- events are not replayed
- replayed completed plans return stored results without adapter contact
- handle/capability escape restrictions are enforced
- duplicate or mixed consumption is rejected
- supervisor failure cancels the plan execution
- forked sessions are isolated from parent session progression
- branch replay rebuilds state from replayed history, not a side snapshot

Extended tests can wait unless they fall out naturally while implementing the Core surface.

## Suggested Execution Order

1. Add the minimal runtime/adapter fixture needed to open a session, plan, emit events, and fork.
2. Add the smallest runtime tests for final result durability and replay.
3. Add supervised event delivery tests proving buffering, ordering, non-durability, and replay absence.
4. Add compiler acceptance/rejection coverage for valid authored forms and restricted-handle misuse.
5. Add fork isolation and branch replay coverage.
6. Do a final pass to remove any accidental provider-specific assumptions from runtime-facing code.

## Guardrails

If you hit ambiguity, prefer these rules:

- reuse existing resource/replay infrastructure over new persistence machinery
- compiler-first restriction enforcement with runtime backstops
- backend-neutral runtime/transport boundaries over SDK-specific shortcuts
- live-only observation over durable streaming
- Core conformance intent over extended edge cases

## Deliverables

Produce:

1. The implementation patch.
2. Imported source docs kept in this worktree.
3. Compiler, runtime, and adapter/mock tests covering the new Core behavior.
4. A short change summary that names the chosen session-resource and event-delivery strategy.

## Done Means

The branch is done when a reader can verify that:

- Claude Code Plan Mode is exposed through authored `open`, `plan`, `supervise`, direct-join, and `fork` surfaces
- session lifetime is resource-backed and scope-bound
- final results replay through the ordinary durable path
- events are buffered live observations only
- restricted capabilities do not escape their intended scope
- forked branches are isolated and replay-reconstructed from durable history
- no provider-specific runtime architecture was introduced
