# Tisyn Scoped Effects Test Plan

**Version:** 0.1.0
**Validates:** Tisyn Scoped Effects Specification 0.1.0
**Status:** Draft

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

## 13. Implementation-Side Runtime Boundary (Deferred)

The scoped-effects specification leaves further
implementation-side boundary refinement to later work. This
section documents what SHOULD be tested once that boundary is
specified more fully.

### 13.1 Tests to Add When A6 Is Specified

| ID | Description |
|---|---|
| MI-001 | Effects `min` middleware wraps the same dispatch interface for remote agents |
| MI-002 | Effects `min` middleware wraps the same dispatch interface for browser-local agents |
| MI-003 | Effects `min` middleware wraps the same dispatch interface for in-process agents |
| MI-004 | Middleware installed at Effects `min` receives the same `(effectId, data)` shape regardless of execution environment |
| MI-005 | Transport-specific behavior is below the standardized boundary and not visible to `min` middleware |

These tests cannot be written until the boundary interface
contract is specified. They are listed here for tracking
and to confirm that the test plan acknowledges the
deferred scope.

---

## 14. Acceptance Criteria

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

10. No Core tier test produces an unexpected error, hang,
    or crash.

11. Cross-boundary constraints are expressible and
    enforceable as ordinary Effects middleware installed
    in the runtime's root scope, with no separate API
    required.

---

## 15. Coverage Summary

### 15.1 Scoped-Effects Section Coverage

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
| §14 Deferred extensions | Deferred | MI-001–005 | Deferred |

### 15.2 Test Count Summary

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
| Deferred (impl-side) | 0 | 0 | 0 |
| **Total** | **46** | **6** | **52** |
