# Tisyn Scoped Effects Test Plan

**Validates:** Tisyn Scoped Effects Specification

---

## 1. Overview

### 1.1 Purpose

This test plan verifies the scoped-effects behavior
standardized for per-agent façades, middleware ordering,
scope inheritance, cross-boundary constraint composition,
and replay transparency. It focuses on the middleware and
agent-facade slice of the scoped-effects specification.

### 1.2 Relationship to the Scoped Effects Specification

The scoped-effects specification is the normative source of
truth. This test plan validates observable behavior required
by the sections governing middleware installation, per-agent
facades, cross-boundary middleware composition, and replay.
It does not introduce new architecture.

### 1.3 Comparison Methodology

- **Middleware execution order:** verified by collecting
  labels into an ordered log array. Each middleware
  appends a label before and/or after calling `next`.
  The final log is compared against the expected sequence.
- **Dispatch shape:** verified by installing a core handler
  (via Effects `min` middleware) that captures the
  `effectId` and `data` arguments and comparing against
  expected values.
- **Scope isolation:** verified by observing that
  middleware installed in a child scope does not appear in
  the parent's execution log, and vice versa.
- **Call-path presence:** verified by installing
  instrumentation at each architectural layer (façade
  method wrapper, backing API middleware, Effects
  middleware) and confirming all layers appear in the log
  even when some middleware stacks are empty.

No test depends on implementation internals such as
backing Context API object identity, prototype chain
structure, or internal context key names.

### 1.4 Tiers

**Core:** Tests that every conforming implementation MUST
pass. An implementation is non-conforming if any Core test
fails.

**Extended:** Tests for edge cases, boundary conditions,
and diagnostic quality. Recommended but not required for
initial conformance.

---

## 2. Scope

### 2.1 In Scope

- Agent façade shape and construction (§6.2)
- Backing Context API existence and delegation (§6.2)
- Dispatch shape — single-payload format (§6.2)
- Effect ID format — `agentId.operationName` (§6.2)
- Middleware ordering — max append, min prepend (§5.2)
- Cross-API composition — façade middleware before Effects
  middleware (§6.2)
- Call-path invariance — backing API layer always
  traversed (§6.2)
- Middleware visibility within a scope (§6.2)
- Scope inheritance and isolation (§4.2, §5.1, §6.2)
- Host-provided middleware in child environments (§4.3,
  §5.1, §7.3, §7.5)
- Single middleware mechanism — no separate enforcement
  path (§5.1, §7.3, §7.5)
- Replay transparency (§9)

### 2.2 Out of Scope

- Middleware helper functions (guard, resolver, etc.) —
  deferred by scoped-effects specification §14.4
- Implementation-side agent runtime boundary details beyond
  the standardized host-facing facade surface — deferred;
  see §13 of this plan
- Compiler lowering of authored middleware syntax — covered
  by the blocking scope test plan
- Low-level IR `Fn` evaluation internals beyond observable
  middleware behavior — covered by runtime and transport
  tests
- Transport-specific behavior — covered by transport tests
- Journal event sequences — covered by existing conformance
  tests

---

## 3. Fixture Schema

### 3.1 Middleware Runtime Fixture

````typescript
interface MiddlewareRuntimeFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "middleware_runtime";
  setup: MiddlewareSetup;
  action: MiddlewareAction;
  expected: MiddlewareExpected;
}

interface MiddlewareSetup {
  agents: AgentSetup[];
  effects_middleware?: MiddlewareInstall[];
  agent_middleware?: AgentMiddlewareInstall[];
  scopes?: ScopeSetup[];
}

interface AgentSetup {
  id: string;
  operations: string[];
}

interface MiddlewareInstall {
  label: string;
  at?: "max" | "min";
  operation?: string;
  behavior: "passthrough" | "log" | "deny" | "transform";
}

interface AgentMiddlewareInstall {
  agent_id: string;
  label: string;
  at?: "max" | "min";
  operation: string;
  behavior: "passthrough" | "log" | "deny" | "transform";
}

interface ScopeSetup {
  name: string;
  parent?: string;
  effects_middleware?: MiddlewareInstall[];
  agent_middleware?: AgentMiddlewareInstall[];
}

interface MiddlewareAction {
  call: {
    agent_id: string;
    operation: string;
    args: Val;
  };
  scope?: string;
}

interface MiddlewareExpected {
  execution_log: string[];
  dispatched_effect_id?: string;
  dispatched_data?: Val;
  result?: Val;
  error?: string;
}
````

### 3.2 Façade Shape Fixture

````typescript
interface FacadeShapeFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "facade_shape";
  agent: AgentSetup;
  expected: {
    has_direct_methods: string[];
    has_around: boolean;
    has_operations_namespace: boolean;
  };
}
````

---

## 4. Agent Façade Shape

Tests in this category verify the object shape returned
by `useAgent(Agent)`.

| ID | Tier | Rule | Description | Expected |
|---|---|---|---|---|
| MF-001 | Core | §6.2 | Façade has direct operation methods | `useAgent(Reviewer)` returns object with `review` as a direct method (not under `.operations`) |
| MF-002 | Core | §6.2 | Façade has `.around()` | Returned object has an `around` method |
| MF-003 | Core | §6.2 | Façade is not a raw `createApi` result | Returned object does NOT have an `.operations` property |
| MF-004 | Core | §6.2 | Façade methods match declared operations | For agent with operations `[review, approve]`, façade has both as direct methods |
| MF-005 | Core | §6.2 | Façade `.around()` accepts middleware objects | `reviewer.around({ *review([p], next) { return yield* next(p); } })` does not throw |
| MF-006 | Extended | §6.2 | Undeclared operations are not callable on façade | For agent with operations `[review]`, calling `reviewer.approve(...)` (not declared) throws or is undefined |

---

## 5. Backing Context API Behavior

Tests in this category verify that the backing Context API
exists and mediates all calls, even when no façade
middleware is installed.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| MB-001 | Core | §6.2 | Backing API core handler calls Effects.dispatch | Install Effects `min` that logs. Call `reviewer.review(patch)` with no façade middleware. | Effects `min` log entry present — call reached Effects chain |
| MB-002 | Core | §6.2 | Call traverses backing API even with empty middleware stack | Install instrumentation at Effects level. Call `reviewer.review(patch)` with no façade middleware. | Instrumentation fires, confirming the backing API core handler delegated to `dispatch()` |
| MB-003 | Core | §6.2 | Façade middleware runs before backing API core handler | Install façade middleware that logs `"façade"` and Effects middleware that logs `"effects"`. Call operation. | Log: `["façade", "effects"]` |
| MB-004 | Core | §6.2 | Backing API core handler delegates to Effects for every operation | Agent with two operations `review` and `approve`. Install Effects middleware that logs effect ID. Call both. | Both `reviewer.review` and `reviewer.approve` effect IDs appear in Effects log |

---

## 6. Dispatch Shape

Tests in this category verify the data shape passed from
backing Context API core handlers to `Effects.dispatch()`.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| MD-001 | Core | §6.2 | Operation dispatches single payload value | Install Effects `min` capturing dispatch args. Call `reviewer.review(patch)`. | `dispatched_data` is `patch` (the value itself, not wrapped in an array) |
| MD-002 | Core | §6.2 | Effect ID format is `agentId.operationName` | Call `reviewer.review(patch)` where agent ID is `"reviewer"`. | `dispatched_effect_id` is `"reviewer.review"` |

> **Note.** Instance-qualified agent IDs (e.g.,
> `Reviewer("team-a")`) are defined by the existing agent
> and compiler specifications, not by this specification. Tests
> for instance-qualified effect ID formats belong in those
> specifications' test plans, not here.

---

## 7. Middleware Ordering

Tests in this category verify the registration-to-execution
order rules from §5.2.

### 7.1 Single-API Ordering

| ID | Tier | Rule | Description | Setup | Expected log |
|---|---|---|---|---|---|
| MO-001 | Core | §5.2 | Single max middleware runs | Install A at max. Call operation. | `["A"]` |
| MO-002 | Core | §5.2 | Two max: first installed is outermost | Install A then B at max. Both log on entry. | `["A", "B"]` |
| MO-003 | Core | §5.2 | Three max: installation order = entry order | Install A, B, C at max. | `["A", "B", "C"]` |
| MO-004 | Core | §5.2 | Single min middleware runs | Install A at min. | `["A"]` |
| MO-005 | Core | §5.2 | Two min: first installed is closest to core | Install C then D at min. Both log on entry. | `["D", "C"]` |
| MO-006 | Core | §5.2 | Mixed max and min: max before min | Install A at max, C at min. | `["A", "C"]` |
| MO-007 | Core | §5.2 | Full four-middleware example from §5.2 | Install A (max), B (max), C (min), D (min). | `["A", "B", "D", "C"]` |
| MO-008 | Core | §5.2 | Onion model: max exit order is reversed | Install A, B at max. Both log before and after next. | Entry: `["A:in", "B:in"]`, exit: `["B:out", "A:out"]` |
| MO-009 | Extended | §5.2 | Min onion: exit order for min layer | Install C, D at min. Both log before and after next. | Entry: `["D:in", "C:in"]`, exit: `["C:out", "D:out"]` |

### 7.2 Cross-API Ordering

| ID | Tier | Rule | Description | Setup | Expected log |
|---|---|---|---|---|---|
| MO-010 | Core | §6.2 | Façade max before Effects max | Install façade max F and Effects max E. Both log on entry. | `["F", "E"]` |
| MO-011 | Core | §6.2 | Façade min before Effects max | Install façade min Fm and Effects max E. | `["Fm", "E"]` |
| MO-012 | Core | §6.2 | Full cross-API: façade max → façade min → Effects max → Effects min | Install F1 (façade max), F2 (façade min), E1 (Effects max), E2 (Effects min). | `["F1", "F2", "E1", "E2"]` |
| MO-013 | Core | §6.2 | Agent-specific middleware does not affect other agents | Install façade middleware on LLM. Call Reviewer operation. | Reviewer log has no LLM façade entries |
| MO-014 | Core | §6.2 | Effects middleware intercepts all agents | Install Effects middleware. Call LLM and Reviewer operations. | Both calls appear in Effects log |

---

## 8. Middleware Composition vs Call Path

Tests in this category verify the distinction between
active middleware layers and the always-present
architectural call path (§6.2).

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| MC-001 | Core | §6.2 | Empty façade stack still reaches Effects | No façade middleware. Effects middleware logs. Call façade operation. | Effects log present — backing API core handler delegated |
| MC-002 | Core | §6.2 | Empty Effects stack still reaches core handler | No Effects middleware. Core handler returns value. Call façade operation. | Return value received — core handler executed |
| MC-003 | Core | §6.2 | Both stacks empty: call still completes | No middleware at all. Core handler returns value. | Return value received |
| MC-004 | Core | §6.2 | Façade middleware can observe args before Effects sees them | Façade middleware logs args. Effects middleware logs effect data. | Both logs present, façade log has typed args, Effects log has payload value |
| MC-005 | Extended | §6.2 | Façade middleware can short-circuit before Effects | Façade middleware returns without calling next. | Effects middleware does NOT fire |

---

## 9. Scope Inheritance and Isolation

Tests in this category verify scope-bound middleware,
middleware visibility, and scope inheritance across Effects
and per-agent facades.

### 9.1 Effects Middleware Scoping

| ID | Tier | Rule | Description | Expected |
|---|---|---|---|---|
| MS-001 | Core | §4.2, §5.1 | Parent Effects middleware inherited by child | Parent installs Effects middleware. Child scope calls operation. Middleware fires. |
| MS-002 | Core | §4.2, §5.1 | Child Effects middleware does not affect parent | Child installs Effects middleware. Parent scope calls operation after child exits. Child middleware does NOT fire. |
| MS-003 | Core | §4.2, §5.1 | Middleware removed when scope exits | Install middleware in scope. Exit scope. Re-enter equivalent scope. Middleware does NOT fire. |

### 9.2 Façade Middleware Scoping

| ID | Tier | Rule | Description | Expected |
|---|---|---|---|---|
| MS-004 | Core | §4.2, §6.2 | Parent façade middleware inherited by child | Parent installs `llm.around(...)`. Child scope calls `llm.sample(...)`. Middleware fires. |
| MS-005 | Core | §4.2, §6.2 | Child façade middleware does not affect parent | Child installs `llm.around(...)`. Parent calls `llm.sample(...)` after child exits. Middleware does NOT fire. |
| MS-006 | Core | §4.2, §6.2 | Child can extend façade middleware without affecting parent | Parent installs MW-A on llm. Child installs MW-B on llm. Parent log has only A. Child log has A then B. |

### 9.3 Middleware Visibility

| ID | Tier | Rule | Description | Expected |
|---|---|---|---|---|
| MS-007 | Core | §6.2 | Multiple useAgent calls share middleware | Call `useAgent(LLM)` twice in same scope. Install middleware via first reference. Call operation via second reference. Middleware fires. |
| MS-008 | Core | §6.2 | Middleware installed after second useAgent call is visible to first | Get ref1 = `useAgent(LLM)`. Get ref2 = `useAgent(LLM)`. Install via ref2. Call via ref1. Middleware fires. |
| MS-009 | Extended | §6.2 | Object identity of façade references is not semantically significant | Test does NOT assert `ref1 === ref2`. Only asserts middleware visibility. |

---

## 10. Host-Provided Middleware in Child Environments

Tests in this category verify that host-provided middleware
composes via ordinary Context API mechanisms in child
execution environments.

| ID | Tier | Rule | Description | Expected |
|---|---|---|---|---|
| MH-001 | Core | §4.3, §5.1, §7.5 | Runtime root-scope middleware is outermost | Runtime installs MW-R at max in root scope before workflow. Workflow installs MW-W at max. Call operation. | Log: `["R", "W"]` — runtime middleware outermost per registration order |
| MH-002 | Core | §4.3, §5.1, §7.5 | Runtime middleware composes with workflow middleware | Runtime installs Effects middleware. Workflow installs façade middleware. Both fire in correct order. | Log: `["façade", "runtime-effects"]` |
| MH-003 | Core | §5.1, §7.3, §7.5 | Constraints compose as ordinary middleware | Runtime installs constraint MW-C at Effects `max` in root scope. Workflow installs MW-W at Effects `max`. Call operation. | Log: `["C", "W"]` — constraint composes in ordinary registration order, no separate path |
| MH-004 | Core | §5.1, §7.3, §7.5 | Host middleware in child environment runs first | Host installs MW-H at max in child's root scope. Child installs MW-C at max. | Log: `["H", "C"]` — host installed first, runs outermost |
| MH-005 | Extended | §5.1, §7.3, §7.5 | Child can compose inside host middleware | Host installs budget middleware at max. Child installs retry at max. Call operation that exceeds budget. | Budget middleware (outermost) rejects before retry runs |

---

## 11. Single Middleware Mechanism

Tests in this category verify that there is one middleware
mechanism and no separate enforcement layer.

| ID | Tier | Rule | Description | Expected |
|---|---|---|---|---|
| MM-001 | Core | §5.1, §7.3, §7.5 | Constraints work through ordinary Effects middleware | Install a deny-all constraint as Effects `max` middleware in root scope (no separate enforcement API used). Call operation. | Operation denied. Behavior is identical to what enforcement would have provided, achieved through ordinary `.around(...)` |
| MM-002 | Core | §5.1, §7.3, §7.5 | Selective constraint expressible as Effects middleware | Install Effects `max` middleware in root scope that denies effect IDs matching `"llm.sample"` and passes all others. Call `llm.sample(...)` and `reviewer.review(...)`. | `llm.sample` denied; `reviewer.review` succeeds. Selective constraint achieved through ordinary `.around(...)` |
| MM-003 | Core | §5.1, §7.3, §7.5 | Constraint middleware is ordinary middleware | Install constraint at Effects `max`. Install logging middleware at Effects `max` after constraint. Logging runs inside constraint. | Log: `["constraint:in", "log:in", "log:out", "constraint:out"]` |

---

## 12. Replay Transparency

Tests in this category verify that workflow-facing middleware
cannot observe replay/record phase.

| ID | Tier | Rule | Description | Expected |
|---|---|---|---|---|
| MR-001 | Core | §9 | No ReplayPhase API on middleware surfaces | The Effects Context API does not expose a `replayPhase` operation. Agent façades do not expose a `replayPhase` operation. | Verified by checking that no such operation exists on either API surface |
| MR-002 | Core | §9 | Middleware executes identically during replay | Install logging middleware. Execute workflow. Replay from journal. | Middleware fires during both execution and replay with no observable difference in behavior from the middleware's perspective |
| MR-003 | Core | §9 | No replay-phase context readable from middleware | Inside an `.around()` middleware body, there is no standard API to determine whether the current execution is a replay. | Verified by confirming no `ReplayPhase` context exists on standardized surfaces |
| MR-004 | Extended | §9 | Runtime does not selectively skip middleware during replay | Install middleware that appends to a log. Execute workflow. Replay from journal. | Log entries appear during both passes — the runtime does not gate or skip workflow-facing middleware based on replay phase |

---

## 13. Replay-Aware Dispatch

These tests complement the general replay-transparency tests in
§12 (`MR-*`). `MR-*` covers the invariant that workflow-facing
middleware cannot observe the replay/record phase; `RD-*`
covers the structural replay-substitution model defined by
scoped-effects §9.5. Neither set replaces the other.

Observability classes used below:

- **Workflow-visible.** Effect return values, thrown
  exceptions, authored control flow, observable side-effect
  counts.
- **Journal-visible.** Durable `YieldEvent | CloseEvent`
  stream contents.
- **API-surface-visible.** Whether a symbol exists as a public
  export (import succeeds or fails). Acceptable in Extended for
  exclusion-regression tests.
- **Harness-introspective (Diagnostic).** Implementation
  internals. Not conformance.

Core tests use only Workflow-visible and Journal-visible
evidence.

### 13.1 Three-Lane Composition Ordering (§9.5.1)

| ID | Tier | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|
| RD-CO-001 | Core | Workflow-visible | Max frames run before min frames | Install a max `dispatch` middleware that logs `"max"`. Install a min `dispatch` middleware that logs `"min"`. Both call `next`. Core handler logs `"core"`. Live dispatch | Log order: `["max", "min", "core"]` |
| RD-CO-002 | Core | Workflow-visible | Multiple max frames in installation order; multiple min frames in reverse installation order | Install max M1, max M2, min m1, min m2 (all logging, all calling `next`). Core logs `"core"`. Live dispatch | Log order: `["M1", "M2", "m2", "m1", "core"]` |
| RD-CO-003 | Core | Workflow-visible | On replay with stored cursor, min frames do not execute | Same composition as RD-CO-002. Run once live (producing a journal). Replay from the journal | Replay log: `["M1", "M2"]` — max frames rerun; min frames and core do not execute; dispatch result equals stored result |
| RD-CO-004 | Extended | Workflow-visible | Replay boundary is not user-installable | Attempt `Effects.around(handlers, { at: "replay" as any })` | Throws an error (unknown group name) or type-level rejection; no middleware installed |

### 13.2 Max-Region Rerun on Replay (§9.5.4)

| ID | Tier | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|
| RD-MX-001 | Core | Workflow-visible + journal-visible | Max middleware pre-`next` code runs on replay | Max middleware increments a harness-visible counter before calling `next`. Agent handler at min. Run live, producing journal. Replay | Counter incremented on replay; dispatch result equals stored result |
| RD-MX-002 | Core | Workflow-visible + journal-visible | Max middleware post-`next` code runs on replay | Max middleware appends `"post"` to a log after `next` returns. Run live; replay | `"post"` appears in the log on both original and replay runs |
| RD-MX-004 | Core | Journal-visible | Max middleware's orchestration child replays correctly | Max middleware invokes a child coroutine before `next`. Run live; replay | Child coroutine replays from its own journal; invoking middleware re-executes; final dispatch result equals stored result |
| RD-MX-005 | Extended | Workflow-visible | Multiple max frames each perform pre-`next` work on replay | Three max frames, each setting a different flag. Run live; replay | All three flags set on replay |

### 13.3 Replay-Boundary Substitution (§9.5.3)

| ID | Tier | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|
| RD-RP-001 | Core | Journal-visible | Stored result substitutes for the dispatch on replay | Agent handler at min returns `{ value: 42 }` live. Run live; serialize journal; replay | Replay produces byte-identical journal; no live dispatch occurs; terminal result matches |
| RD-RP-002 | Core | Journal-visible | Replay cursor is consumed per dispatch | Two sequential dispatches to different agent operations. Run live; replay | Both dispatches produce their stored results in order; yieldIndex advances for each |
| RD-RP-003 | Core | Journal-visible | Replayed `YieldEvent` is journaled, not re-appended to durable stream | Run live to produce a journal. Replay from that journal. Inspect the in-memory execution journal returned by `execute()` and the backing durable stream. | Journal returned by `execute()` contains a replayed `YieldEvent` (with the stored result) at the expected position under the caller's `coroutineId`. The backing durable stream MUST NOT contain a duplicate replayed `YieldEvent` — only the events appended during the original live run. |
| RD-RP-004 | Core | Journal-visible | yieldIndex advances on replay substitution | Three dispatches in sequence. Run live; replay; inspect journal | yieldIndex 0, 1, 2 on both runs |
| RD-RP-005 | Core | Workflow-visible | Replay-substituted result is returned to max middleware | Max middleware logs `next()` return value after calling `next`. Agent handler at min returns `"live-value"`. Run live; replay | Max middleware's post-`next` log shows `"live-value"` on both original and replay |
| RD-RP-006 | Core | Workflow-visible | No live agent dispatch occurs on replay | Agent handler at min increments a call counter. Run live (counter = 1); replay | Counter remains 1 after replay; no second invocation |

### 13.4 Min/Core Non-Execution on Replay (§9.5.3)

| ID | Tier | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|
| RD-MN-001 | Core | Workflow-visible | Min-priority middleware body does not execute on replay | Min middleware sets a flag when its body runs. Max middleware calls `next`. Run live (flag set); replay | Flag is not re-set on replay |
| RD-MN-002 | Core | Workflow-visible | Core handler does not execute on replay when stored cursor exists | Core handler sets a flag. Run live (flag set); replay | Flag not re-set on replay |
| RD-MN-003 | Core | Workflow-visible | Agent handler body does not refire on replay | `Agents.use` handler performs a non-idempotent side effect (appends to a list). Run live (list has 1 entry); replay | List still has 1 entry after replay; no duplicate |
| RD-MN-004 | Core | Workflow-visible | Transport `session.execute(...)` does not refire on replay | `installAgentTransport` handler increments a counter. Run live (counter = 1); replay | Counter remains 1 after replay |
| RD-MN-005 | Core | Workflow-visible | `sleep` handler does not refire on replay | Dispatch `sleep` effect. Run live; replay; measure elapsed time | Replay does not block for the sleep duration |
| RD-MN-006 | Extended | Workflow-visible | User-authored min constraint does not execute on replay | User installs an innermost constraint at `{ at: "min" }` that logs. Run live (log entry); replay | No log entry on replay |

### 13.5 Framework Handler Installation at Min (§9.5.2)

| ID | Tier | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|
| RD-FW-001 | Core | Workflow-visible | `Agents.use` handler runs after max middleware | Install a max middleware that logs `"max"` before `next` and an `Agents.use` handler that logs `"agent"`. Live dispatch | Log: `["max", "agent"]` — max runs before agent, consistent with agent being at min |
| RD-FW-002 | Core | Workflow-visible | `installAgentTransport` handler runs after max middleware | Install max logging middleware and a transport binding. Live dispatch to the transport-bound agent | Max middleware log entry appears before the transport's live execution |
| RD-FW-003 | Core | Workflow-visible | `installRemoteAgent` handler runs after max middleware | Same pattern as RD-FW-002 with `installRemoteAgent` | Same ordering evidence |
| RD-FW-004 | Core | Workflow-visible | Multiple agent handlers at min compose correctly | Two agents bound via `Agents.use` in the same scope. Dispatch to each | Each handler handles its own prefix; both are below max middleware in execution order |
| RD-FW-005 | Extended | Workflow-visible | Agent handler at min + user constraint at min compose correctly | `Agents.use` handler at min and a user constraint at min. Live dispatch | Both execute; constraint is outer-min (more recently installed); handler is inner-min |
| RD-FW-006 | Core | Workflow-visible | `implementAgent(...).install` handler runs after max middleware | After `yield* impl.install()` for an `implementAgent`-bound agent, install a max-priority `Effects.around` interceptor that logs `"max"`. Handler logs `"impl-handler"`. Live dispatch | Log: `["max", "impl-handler"]` — max runs before the handler, consistent with `implementAgent(...).install` installing its dispatch middleware at min |

### 13.6 No Public Replay-Lane Leakage (§9.5.1)

| ID | Tier | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|
| RD-PL-001 | Core | Workflow-visible | `Effects.around` with an unknown `{ at }` value is rejected | Attempt to install middleware at `{ at: "replay" as any }` | Runtime error or type error; no middleware installed |
| RD-PL-002 | Extended | Workflow-visible | Error messages for invalid `{ at }` do not expose internal group names | Trigger the RD-PL-001 error; inspect the message | Message says "unknown group" or similar; does not list `"replay"` as a known option (only `"max"` and `"min"` appear) |
| RD-PL-003 | Extended | Workflow-visible | User cannot observe the replay boundary's existence through middleware composition | Install max and min middleware that count `next` calls. Live dispatch | Each middleware's `next` call count is consistent with the documented two-lane model; no extra visible `next` hop |

### 13.7 Short-Circuit with Stored Cursor (§9.5.5)

| ID | Tier | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|
| RD-SC-001 | Core | Journal-visible | Short-circuiting max frame's return is overridden by stored cursor on replay | Max middleware short-circuits (returns `"mock"` without calling `next`). Run live (journals `"mock"`); replay | Replay result is `"mock"` (from stored cursor); no min or core execution; journal identical |
| RD-SC-002 | Core | Journal-visible | Deterministic short-circuiting mock produces matching stored cursor | Same as RD-SC-001 with deterministic mock | Both runs produce identical journals |
| RD-SC-003 | Core | Journal-visible | Non-deterministic short-circuiting mock is overridden by stored cursor | Mock returns `"v1"` originally and `"v2"` on replay. Stored cursor has `"v1"` | Replay result is `"v1"` (stored cursor wins); `"v2"` discarded |
| RD-SC-004 | Extended | Workflow-visible | Short-circuit in max does not trigger min execution on replay | Mock short-circuits. Min middleware sets a flag. Run live; replay | Flag not set on replay |

### 13.8 Resource-Body Dispatch (§9.5.7)

Test descriptions use semantic wording ("dispatch from a
resource init/cleanup body") and do not reference runtime
implementation helper names.

| ID | Tier | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|
| RD-RS-001 | Core | Journal-visible | Dispatch from resource init body uses the same replay model | Resource init body dispatches an agent effect. Max middleware installed in the same scope logs. Run live; replay | Max middleware log appears on both runs; agent handler does not refire on replay |
| RD-RS-002 | Core | Journal-visible | Dispatch from resource cleanup body uses the same replay model | Resource cleanup body dispatches an agent effect. Run live; replay | Same substitution behavior as init body |
| RD-RS-003 | Core | Journal-visible | Crash during resource init; recovery replays resource-body dispatches correctly | Resource init dispatches two effects; crash after the first; recover | First effect replays from cursor; second effect dispatches live; agent handler fires once per effect across the full lifecycle |

### 13.9 Transport Binding Interaction

| ID | Tier | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|
| RD-TR-001 | Core | Workflow-visible + journal-visible | Transport-bound agent handler does not refire on replay | `installAgentTransport(Agent, factory)`. Dispatch to agent. Run live; replay | Handler fires once across both runs |
| RD-TR-002 | Core | Journal-visible | Transport reinstallation on replay (scope setup rerun) | Scope setup calls `installAgentTransport`. Run live; replay | Transport is reinstalled during scope-setup rerun; dispatches substitute at replay boundary |
| RD-TR-003 | Extended | Journal-visible | Multiple transport bindings in the same scope | Two agents bound to different transports. Dispatch to each. Run live; replay | Both substitute correctly; neither refires |

### 13.10 Exclusion Regression — Prototype Helper Shape (§9.5.6)

Tests in this section verify that the excluded prototype
symbols are not exported by the implementation, and that
replay works without any such helper. Phrased as exclusion
regression, not removal regression.

| ID | Tier | Obs. class | Description | Setup | Expected |
|---|---|---|---|---|---|
| RD-RG-001 | Extended | API-surface-visible | `runAsTerminal` is not exported from `@tisyn/effects` | Attempt to import `runAsTerminal` from `@tisyn/effects` | Import fails; symbol does not exist |
| RD-RG-002 | Extended | API-surface-visible | `RuntimeTerminal` is not exported from `@tisyn/effects/internal` | Attempt to import `RuntimeTerminal` from `@tisyn/effects/internal` | Import fails; symbol does not exist |
| RD-RG-003 | Extended | API-surface-visible | `RuntimeTerminalBoundary` is not exported from `@tisyn/effects/internal` | Attempt to import `RuntimeTerminalBoundary` from `@tisyn/effects/internal` | Import fails; symbol does not exist |
| RD-RG-004 | Core | Journal-visible | Replay correctness without any helper | Agent handler at min, no terminal-delegation wrapping anywhere. Run live; replay | Identical journals; no refire; replay substitution is structural |
| RD-RG-005 | Diagnostic | Harness-introspective | No `effectId`/`data` restatement at any framework handler site | Inspect `Agents.use`, `implementAgent(...).install`, `installAgentTransport`, `installRemoteAgent` handler bodies at the source level | No restated parameters to a boundary helper. **Non-normative; implementation-quality check only** |

### 13.11 Regression Protection for Existing Conformance

| ID | Tier | Obs. class | Description | Expected |
|---|---|---|---|---|
| RD-EX-001 | Core | Journal-visible | Full existing crash-replay test suite passes | Identical journals before and after the change |
| RD-EX-002 | Core | Journal-visible | Full existing resource-recovery battery passes | Identical journals |
| RD-EX-003 | Core | Journal-visible | Full existing cross-boundary middleware tests pass | Identical journals |
| RD-EX-005 | Core | Journal-visible | Full existing nested-invocation test plan passes | Identical journals |
| RD-EX-006 | Core | Journal-visible | Full existing payload-sensitive divergence tests pass | Identical journals |

> **Note.** Test IDs `RD-PD-*` are reserved for a future
> payload-fingerprint specification and are intentionally not
> defined in this test plan (payload-sensitive divergence
> regression is already covered by `RD-EX-006`). Test IDs
> `RD-IL-*`, `RD-MX-003`, and `RD-EX-004` are deliberately not
> defined here either; inline-invocation coverage lives in
> `tisyn-inline-invocation-test-plan.md`, which is the
> authoritative test plan for `invokeInline` semantics.

### 13.12 Minimum Acceptance Subset

Feature is implementation-ready when all 12 pass:

| # | ID | What it proves |
|---|---|---|
| 1 | RD-CO-001 | Three-lane composition ordering on live dispatch |
| 2 | RD-CO-003 | Min does not execute on replay |
| 3 | RD-MX-001 | Max reruns on replay |
| 4 | RD-RP-001 | Stored result substitutes on replay |
| 5 | RD-RP-006 | No live agent dispatch on replay |
| 6 | RD-MN-003 | Agent handler does not refire on replay |
| 7 | RD-MN-004 | Transport handler does not refire on replay |
| 8 | RD-FW-001 | `Agents.use` is at min priority |
| 9 | RD-SC-001 | Short-circuit stored-cursor-wins on replay |
| 10 | RD-RS-001 | Resource-body dispatch uses same replay model |
| 11 | RD-RG-004 | Replay works without any helper |
| 12 | RD-EX-001 | Existing crash-replay suite stays green |

### 13.13 Coverage Summary for §13

**Spec-section coverage**

| Spec subsection | Test IDs |
|---|---|
| §9.5.1 Structural replay boundary | RD-CO-001..004, RD-PL-001..003 |
| §9.5.2 Framework handlers at min | RD-FW-001..006 |
| §9.5.3 Replay substitution semantics | RD-RP-001..006, RD-MN-001..006 |
| §9.5.4 Max re-executes on replay | RD-MX-001, 002, 004, 005 |
| §9.5.5 Short-circuit stored-cursor-wins | RD-SC-001..004 |
| §9.5.6 No delegation helper | RD-RG-001..005 |
| §9.5.7 Resource-body interaction | RD-RS-001..003 |

**Tier counts**

| Category | Core | Extended | Diagnostic | Total |
|---|---|---|---|---|
| Composition ordering | 3 | 1 | 0 | 4 |
| Max rerun | 3 | 1 | 0 | 4 |
| Replay substitution | 6 | 0 | 0 | 6 |
| Min/core non-execution | 5 | 1 | 0 | 6 |
| Framework installation | 5 | 1 | 0 | 6 |
| Public leakage | 1 | 2 | 0 | 3 |
| Short-circuit | 3 | 1 | 0 | 4 |
| Resource interaction | 3 | 0 | 0 | 3 |
| Transport interaction | 2 | 1 | 0 | 3 |
| Exclusion regression | 1 | 3 | 1 | 5 |
| Existing regression | 5 | 0 | 0 | 5 |
| **Total** | **37** | **11** | **1** | **49** |

---

## 14. Cross-Boundary Middleware Coverage

This section covers the interaction between host Effects
middleware, scope isolation, and explicit cross-boundary
middleware propagation.

### 14.1 Intended Contract

Three rules govern middleware at the host/agent boundary:

1. **Generic host middleware does not cross the boundary by
   scope inheritance.** Effects middleware installed in the
   host scope — at any priority (max or min) — is not
   visible to an agent's isolated execution scope.

2. **Explicit cross-boundary middleware does cross via the
   protocol carrier.** `installCrossBoundaryMiddleware(fn)`
   attaches an IR middleware function to the execute request.
   The protocol server installs it as ordinary
   `Effects.around()` in the child's execution scope.

3. **The propagated carrier is installed as outermost child
   Effects max.** It runs before any middleware the child
   handler installs, whether max or min.

### 14.2 Tests

| ID | Tier | Title | Setup | Expected |
|---|---|---|---|---|
| MI-001 | Core | Host Effects `min` does not leak into remote child | Host installs interceptor at `{ at: "min" }` that throws on sentinel; child dispatches sentinel | Child completes normally; host min interceptor does not fire |
| MI-002 | Core | Propagated middleware runs before child max | Host installs cross-boundary IR middleware that transforms data; child installs max middleware logging the data it receives | Child max sees transformed data |
| MI-003 | Core | Propagated middleware runs before child min | Same setup as MI-002; child also installs min middleware logging the data it receives | Child min sees transformed data |
| MI-004 | Core | Propagated middleware preserves `(effectId, data)` shape | Cross-boundary IR middleware delegates via `Eval("dispatch", [effectId, data])`; child core handler records the shape | Child core receives standard two-arg shape |

---

## 15. Agents Setup API

Tests for the `Agents.use()` local binding primitive and the
routing-owned `resolve` operation that replaces the former
`BoundAgentsContext` registry.

| ID | Tier | Spec ref | Title | Setup | Expected |
|---|---|---|---|---|---|
| AG-001 | Core | §6.1 | `Agents.use()` makes `useAgent()` succeed | Bind agent locally via `Agents.use()`, then call `useAgent()` | Facade returned, dispatch succeeds |
| AG-002 | Core | §6.2 | `useAgent()` without binding throws descriptive error | Call `useAgent()` without prior binding | Error contains agent ID and "not bound" |
| AG-003 | Core | §4.2, §6.1 | Child scope inherits parent's `Agents.use()` binding | Bind in parent, `useAgent()` in child scope | Facade available in child |
| AG-004 | Core | §4.2, §6.1 | Child scope binding doesn't affect parent | Bind agent B in child scope | Parent `useAgent(B)` throws |
| AG-005 | Core | §6.1, §5.2 | Root `Effects.around()` intercepts locally-bound dispatch | Install Effects middleware, bind, dispatch | Middleware fires |
| AG-006 | Core | §6.1 | Two agents bound in same scope — both accessible | `Agents.use()` for two agents | Both `useAgent()` calls succeed, dispatches route correctly |

---

## 16. Acceptance Criteria

The scoped-effects middleware/facade slice is considered
correctly implemented when:

1. All Core tier façade shape tests (MF-*) pass.

2. All Core tier backing Context API tests (MB-*) pass.

3. All Core tier dispatch shape tests (MD-*) pass.

4. All Core tier middleware ordering tests (MO-*) pass,
   including cross-API composition.

5. All Core tier call-path tests (MC-*) pass.

6. All Core tier scope inheritance and isolation tests
   (MS-*) pass.

7. All Core tier host-provided middleware tests (MH-*)
   pass.

8. All Core tier single-mechanism tests (MM-*) pass.

9. All Core tier replay transparency tests (MR-*) pass.

10. All Core tier Agents setup API tests (AG-*) pass.

11. All Core tier cross-boundary middleware tests (MI-*)
    pass.

12. All Core tier replay-aware dispatch tests (RD-*) defined
    in §13 pass.

13. The Minimum Acceptance Subset in §13.12 MUST pass before
    the replay-aware dispatch implementation (Refs #125) is
    considered complete.

14. No Core tier test produces an unexpected error, hang,
    or crash.

15. Generic host Effects middleware does not cross the
    agent boundary by scope inheritance. Explicit
    cross-boundary middleware crosses via
    `installCrossBoundaryMiddleware(fn)` and the protocol
    carrier, and is installed in the child as outermost
    Effects max.

---

## 17. Coverage Summary

### 17.1 Scoped-Effects Section Coverage

| Scoped-effects section | Test category | Test IDs | Status |
|---|---|---|---|
| §5.2 Max/min priority | Middleware ordering | MO-001–009 | Covered |
| §5.4 Middleware categories | Cross-API ordering | MO-010–014 | Covered |
| §6.2 Agent facade lookup — shape | Façade shape | MF-001–006 | Covered |
| §6.2 Agent facade lookup — dispatch shape | Dispatch shape | MD-001–002 | Covered |
| §6.2 Agent facade lookup — call path | Call path | MC-001–005 | Covered |
| §6.2 Agent facade lookup — shared visibility | Scope visibility | MS-007–009 | Covered |
| §4.2 Scope semantics / §6.2 agent facades | Scope inheritance | MS-001–006 | Covered |
| §4.3 Scope as shared configuration / §7.5 monotonic narrowing | Host middleware | MH-001–005 | Covered |
| §5.1 Installation / §7.3 child install / §7.5 monotonic narrowing | Single mechanism | MM-001–003 | Covered |
| §9 Durability and replay | Replay | MR-001–004 | Covered |
| §6.1 Agent binding / §6.2 lookup | Agents setup API | AG-001–006 | Covered |
| §14 Cross-boundary middleware | Cross-boundary | MI-001–004 | Covered |
| §9.5.1 Structural replay boundary | Replay-aware dispatch | RD-CO-001–004, RD-PL-001–003 | Covered |
| §9.5.2 Framework handlers at min | Replay-aware dispatch | RD-FW-001–006 | Covered |
| §9.5.3 Replay substitution semantics | Replay-aware dispatch | RD-RP-001–006, RD-MN-001–006 | Covered |
| §9.5.4 Max re-executes on replay | Replay-aware dispatch | RD-MX-001, 002, 004, 005 | Covered |
| §9.5.5 Short-circuit stored-cursor-wins | Replay-aware dispatch | RD-SC-001–004 | Covered |
| §9.5.6 No delegation helper | Replay-aware dispatch | RD-RG-001–005 | Covered |
| §9.5.7 Resource-body interaction | Replay-aware dispatch | RD-RS-001–003 | Covered |

### 17.2 Test Count Summary

| Category | Core | Extended | Total |
|---|---|---|---|
| Façade shape | 5 | 1 | 6 |
| Backing Context API | 4 | 0 | 4 |
| Dispatch shape | 2 | 0 | 2 |
| Ordering — single API | 8 | 1 | 9 |
| Ordering — cross API | 5 | 0 | 5 |
| Call path | 4 | 1 | 5 |
| Scope — Effects | 3 | 0 | 3 |
| Scope — façade | 3 | 0 | 3 |
| Scope — visibility | 2 | 1 | 3 |
| Host middleware | 4 | 1 | 5 |
| Single mechanism | 3 | 0 | 3 |
| Replay transparency | 3 | 1 | 4 |
| Agents setup API | 6 | 0 | 6 |
| Cross-boundary middleware | 4 | 0 | 4 |
| RD composition ordering | 3 | 1 | 4 |
| RD max rerun | 3 | 1 | 4 |
| RD replay substitution | 6 | 0 | 6 |
| RD min/core non-execution | 5 | 1 | 6 |
| RD framework installation | 5 | 1 | 6 |
| RD public leakage | 1 | 2 | 3 |
| RD short-circuit | 3 | 1 | 4 |
| RD resource interaction | 3 | 0 | 3 |
| RD transport interaction | 2 | 1 | 3 |
| RD exclusion regression | 1 | 3 | 4 |
| RD existing regression | 5 | 0 | 5 |
| **Total** | **93** | **17** | **110** |

> **Note.** §13.10 also includes one Diagnostic test (`RD-RG-005`) which is non-normative and not counted in the Core/Extended totals above. See §13.13 for the full Core/Extended/Diagnostic breakdown.
