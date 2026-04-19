# Tisyn Code Agent — Conformance Test Plan

**Version:** 1.0.0
**Tests:** Tisyn Code Agent Specification v1.0.0
**Status:** Draft

---

### Changelog

**v1.0.0** — Initial release. Defines the three-suite
decomposition (base contract, ACP adapter, profile-specific),
observable-boundary assertion model, coverage for all five
operations across core and extended tiers, stale-handle
scenarios, replay/frontier scenarios, portability
classification scenarios, and harness model.

---

## 1. Overview

This document defines the conformance test plan for the
Tisyn `CodeAgent` contract. It is the test-planning companion
to the Tisyn Code Agent Specification v1.0.0.

The plan governs three test suites:

- **Base contract suite** — verifies portable `CodeAgent`
  behavior. Backend-agnostic. Required for all adapters.
- **ACP adapter suite** — verifies ACP protocol translation
  for adapters that communicate with their backend through
  ACP. Applies only to ACP-backed adapters.
- **Profile-specific suites** — verify backend-specific
  behavior for individual adapter profiles (Claude Code,
  Codex, others). Each profile has its own suite.

The plan is derived directly from the normative specification.
It does not redesign the contract or introduce new
requirements.

---

## 2. Scope and Non-Goals

### 2.1 In Scope

- All five contract operations: `newSession`, `closeSession`,
  `prompt`, `fork`, `openFork`
- Core and extended conformance tiers
- Stale-handle behavior per operation
- Session lifecycle invariants
- Direct-payload contract verification and name resolution
- Progress forwarding
- Cancellation semantics
- Transport-level protocol (initialize, shutdown, diagnostics)
- Portability classification
- Profile extension boundary enforcement
- Replay/frontier observable consequences
- Non-conforming adapter classification

### 2.2 Non-Goals

- Backend reasoning or model output quality
- Proprietary model behavior or response content beyond
  stable fixtures
- Internal adapter state or data structure layout
- Internal SDK object lifetimes or memory management
- Kernel, compiler, IR, or config-model conformance (covered
  by their own test plans)
- Progress event schema normalization (the contract does not
  normalize it)
- Implementation-private optimizations (e.g., session
  caching, connection pooling)

---

## 3. Relationship to the Specification

This plan is a companion to the Tisyn Code Agent
Specification v1.0.0. Every test scenario traces to a
specific section of that specification. The plan does not
add, remove, or modify normative requirements.

The specification is the authority. If this plan conflicts
with the specification, the specification governs.

---

## 4. Test Philosophy

### 4.1 Observable-Boundary Testing

All tests assert only on values observable at the Tisyn
protocol boundary:

- Operation return values
- Error messages and error names
- Progress notification delivery and ordering
- Protocol-level responses (success, application error)
- Subprocess diagnostic content

Tests MUST NOT assert on:

- Private adapter session maps or handle registries
- Internal SDK session objects or thread handles
- Backend subprocess PIDs or process state
- Internal translation function return values
- Adapter-internal handle format beyond opacity
  (tests may assert that a handle IS a string, but not
  what the string looks like)

### 4.2 Contract-First

The base suite tests the contract, not any specific backend.
Tests use a mock transport or fake backend that can be
configured to produce deterministic results, errors, progress
events, and failures. No real coding agent binary is required
for the base suite.

### 4.3 Portability-Aware

Tests are classified by portability. Portable tests belong in
the base suite. Profile-coupled tests belong in profile
suites. The plan explicitly marks which tests verify portable
behavior and which verify profile extensions.

### 4.4 Profile Layering

Profile suites inherit the base suite — a profile adapter
MUST pass all base-suite tests before profile-specific tests
are considered. Profile suites add only backend-specific
delta coverage. They MUST NOT duplicate base-suite scenarios.

### 4.5 Journal-Model Alignment

Tests that reference journal behavior MUST align with the
Tisyn runtime event model:

- `YieldEvent` is per external effect (one per `CodeAgent`
  operation)
- `CloseEvent` is per coroutine/task terminal state (one when
  the workflow completes, not one per operation)

No test in any suite may assert that an individual `CodeAgent`
operation produces a `CloseEvent`. Tests that verify
journaling assert on `YieldEvent` production per operation
and on `CloseEvent` only at the coroutine level.

---

## 5. Test Suite Decomposition

### 5.1 Suite A: Base CodeAgent Contract

**Scope:** Portable contract behavior from spec §6–§15.
Backend-agnostic.

**Harness:** Mock transport with configurable fake backend.

**Applies to:** All conforming adapters (core and extended).

**Contains:**
- Operation shape and result shape tests
- Session lifecycle tests
- Stale-handle tests
- Direct-payload contract tests
- Name resolution tests
- Progress forwarding tests
- Cancellation tests
- Transport protocol tests (initialize, shutdown, diagnostics)
- Conformance tier gating tests
- Result extension rule tests
- Portability classification tests

**Does NOT contain:**
- ACP wire-level assertions
- Backend-specific method names
- Backend-specific result extensions
- Backend-specific config validation
- Backend-specific approval or sandbox policy values

### 5.2 Suite B: ACP Adapter Conformance

**Scope:** ACP protocol translation from the ACP adapter
conformance test plan (separate document).

**Harness:** Fake ACP peer (controlled NDJSON stdio process).

**Applies to:** Only adapters that speak ACP to their backend.

**Contains:**
- Initialize handshake synthesis (not forwarded to ACP)
- ACP method mapping per operation
- ACP parameter forwarding (direct payload as top-level params)
- ACP success/error/notification translation
- ACP progress forwarding
- ACP cancellation request mapping
- ACP shutdown behavior
- Subprocess exit diagnostics over ACP
- Malformed ACP payload handling
- Duplicate/late ACP response handling

**Does NOT contain:**
- Contract-level operation semantics (delegated to Suite A)
- Backend-specific ACP method names (delegated to profile
  suites)

### 5.3 Suite C: Profile-Specific Suites

**Scope:** Backend-specific deltas per adapter profile.

**Harness:** Profile-dependent (mock SDK, real binary, or
profile-specific fake).

**One suite per profile.** Current profiles:
- C.1: Claude Code profile
- C.2: Codex profile

**Contains (per profile):**
- Profile-specific operation aliases and their resolution
- Profile-specific result field extensions
- Profile-specific config field validation
- Profile-specific headless constraint values
- Profile-specific ACP method names (if ACP-backed)
- Non-conforming adapter path documentation

**Does NOT contain:**
- Contract-level operation semantics (delegated to Suite A)
- Generic ACP translation behavior (delegated to Suite B)

---

## 6. Observable Boundary

### 6.1 Permitted Assertions

Tests MAY assert on:

| Observable | How Observed |
|---|---|
| Operation return value | Protocol response `result` field |
| Error message | Protocol response `error.message` |
| Error name | Protocol response `error.name` |
| Progress delivery | `progressNotification` messages on agent-to-host channel |
| Progress ordering | Relative order of progress notifications vs final response |
| Initialize response | `InitializeResponse` message fields |
| Shutdown effect | Resource cleanup observable via subsequent operation failure |
| Diagnostic content | Error message containing exit code, command, stderr |
| Handle opacity | `sessionId` is a string; content is uninterpreted |
| Result field presence | `response` field present on `PromptResult` |
| Result field type | `response` is a string |
| Extension field non-requirement | Base tests do not assert on extension fields |

### 6.2 Prohibited Assertions

Tests MUST NOT assert on:

| Not Observable | Why Prohibited |
|---|---|
| Internal session map state | Adapter private |
| Handle string format | Opacity requirement (spec §7.4) |
| Backend session/thread ID | Never exposed (spec §7.4) |
| SDK object properties | Adapter private |
| Subprocess PID | Adapter private |
| Backend conversation history structure | Adapter private |
| Per-operation `CloseEvent` | Incorrect event model (spec §15.1) |
| Progress event schema | Not normalized by contract (spec §11.2) |

---

## 7. Base Contract Coverage

### 7.1 Operation Shape Tests

**CA-SHAPE-01: newSession returns SessionHandle**

| Field | Value |
|---|---|
| Spec ref | §7.4 |
| Tier | Core |
| Scenario | Call `newSession` with `{ model: "test" }` |
| Expected | Returns object with `sessionId: string` |
| Portability | Portable |

**CA-SHAPE-02: closeSession returns null**

| Field | Value |
|---|---|
| Spec ref | §7.5 |
| Tier | Core |
| Scenario | Call `closeSession` with a live handle |
| Expected | Returns `null` |
| Portability | Portable |

**CA-SHAPE-03: prompt returns PromptResult**

| Field | Value |
|---|---|
| Spec ref | §7.6 |
| Tier | Core |
| Scenario | Call `prompt` with live handle and non-empty prompt string |
| Expected | Returns object with `response: string` |
| Portability | Portable |

**CA-SHAPE-04: fork returns ForkData**

| Field | Value |
|---|---|
| Spec ref | §7.7 |
| Tier | Extended |
| Scenario | Call `fork` with a live handle (after at least one prompt) |
| Expected | Returns object with `parentSessionId: string` and `forkId: string` |
| Portability | Portable (extended tier) |

**CA-SHAPE-05: openFork returns SessionHandle**

| Field | Value |
|---|---|
| Spec ref | §7.8 |
| Tier | Extended |
| Scenario | Call `openFork` with `ForkData` from a prior `fork` |
| Expected | Returns object with `sessionId: string` |
| Portability | Portable (extended tier) |

### 7.2 Session Lifecycle Tests

**CA-LIFE-01: newSession → prompt → closeSession**

| Field | Value |
|---|---|
| Spec ref | §10.1 |
| Tier | Core |
| Scenario | Full happy-path lifecycle: create, prompt, close |
| Expected | All three operations succeed. closeSession returns null |
| Portability | Portable |

**CA-LIFE-02: Sequential prompts preserve session**

| Field | Value |
|---|---|
| Spec ref | §10.2 |
| Tier | Core |
| Scenario | newSession → prompt("first") → prompt("second") on same handle |
| Expected | Both prompts succeed. Session handle remains valid |
| Portability | Portable |

**CA-LIFE-03: Transport survives session close**

| Field | Value |
|---|---|
| Spec ref | §10.1 |
| Tier | Core |
| Scenario | newSession → closeSession → newSession (second session through same transport) |
| Expected | Second newSession succeeds. Transport is not destroyed by closeSession |
| Portability | Portable |

**CA-LIFE-04: closeSession invalidates handle**

| Field | Value |
|---|---|
| Spec ref | §7.5 |
| Tier | Core |
| Scenario | newSession → closeSession → prompt(closed handle) |
| Expected | prompt fails with descriptive error |
| Portability | Portable |

**CA-LIFE-05: Fork lifecycle**

| Field | Value |
|---|---|
| Spec ref | §7.7, §7.8, §10.1 |
| Tier | Extended |
| Scenario | newSession → prompt → fork → openFork → prompt(forked handle) → closeSession(both) |
| Expected | Fork returns ForkData. openFork returns new handle. Prompt on forked handle succeeds. Both sessions close cleanly |
| Portability | Portable (extended tier) |

**CA-LIFE-06: Fork does not affect parent**

| Field | Value |
|---|---|
| Spec ref | §10.1, §7.7 |
| Tier | Extended |
| Scenario | newSession → prompt → fork → prompt(parent handle) |
| Expected | Parent prompt succeeds. Parent session is unaffected by fork |
| Portability | Portable (extended tier) |

### 7.3 Stale-Handle Tests

**CA-STALE-01: closeSession tolerates stale handle**

| Field | Value |
|---|---|
| Spec ref | §9.1 |
| Tier | Core |
| Scenario | Present a handle not created by the current adapter instance |
| Expected | Returns `null` without error |
| Portability | Portable |

**CA-STALE-02: prompt rejects stale handle**

| Field | Value |
|---|---|
| Spec ref | §9.2 |
| Tier | Core |
| Scenario | Present a stale handle to prompt |
| Expected | Fails with descriptive error. Error name SHOULD be `"SessionNotFound"` |
| Portability | Portable |

**CA-STALE-03: prompt does not transparently recreate**

| Field | Value |
|---|---|
| Spec ref | §9.2 |
| Tier | Core |
| Scenario | Present a stale handle to prompt |
| Expected | Fails. Does NOT return a PromptResult from an empty session |
| Portability | Portable |

**CA-STALE-04: fork rejects stale handle**

| Field | Value |
|---|---|
| Spec ref | §9.4 |
| Tier | Extended |
| Scenario | Present a stale handle to fork |
| Expected | Fails with descriptive error |
| Portability | Portable (extended tier) |

**CA-STALE-05: openFork rejects stale ForkData (default)**

| Field | Value |
|---|---|
| Spec ref | §9.5 |
| Tier | Extended |
| Scenario | Present ForkData with an unresolvable forkId |
| Expected | Fails with descriptive error. Does NOT silently create an unrelated session |
| Portability | Portable (extended tier) |

**CA-STALE-06: openFork optimization is non-portable**

| Field | Value |
|---|---|
| Spec ref | §9.5 |
| Tier | Extended |
| Scenario | Documentation / classification test |
| Expected | If an adapter resolves stale ForkData, this is classified as a non-portable optimization. The base suite does not require success |
| Portability | Non-portable (adapter optimization) |

### 7.4 Direct-Payload Contract Tests

The compiler emits each single-parameter ambient operation's
argument directly as the effect payload (spec §7.2). The
adapter MUST forward that payload to the operation handler
unchanged — there is no compiler-added wrapper to strip and
no compatibility shim that accepts a wrapped shape.

**CA-PAYLOAD-01: newSession direct payload**

| Field | Value |
|---|---|
| Spec ref | §7.2, §7.4 |
| Tier | Core |
| Scenario | Dispatch with payload `{ model: "test" }` |
| Expected | Handler receives `{ model: "test" }` verbatim; newSession succeeds and returns a `SessionHandle` |
| Portability | Portable |

**CA-PAYLOAD-02: closeSession direct payload**

| Field | Value |
|---|---|
| Spec ref | §7.2, §7.5 |
| Tier | Core |
| Scenario | Dispatch with payload `{ sessionId: "cx-1" }` |
| Expected | Handler receives `{ sessionId: "cx-1" }` verbatim; closeSession succeeds and returns `null` |
| Portability | Portable |

**CA-PAYLOAD-03: prompt direct payload**

| Field | Value |
|---|---|
| Spec ref | §7.2, §7.6 |
| Tier | Core |
| Scenario | Dispatch with payload `{ session: { sessionId: "cx-1" }, prompt: "hello" }` |
| Expected | Handler receives `{ session: { sessionId: "cx-1" }, prompt: "hello" }` verbatim; prompt succeeds and returns a `PromptResult` |
| Portability | Portable |

**CA-PAYLOAD-04: fork direct payload**

| Field | Value |
|---|---|
| Spec ref | §7.2, §7.7 |
| Tier | Extended |
| Scenario | Dispatch with payload `{ sessionId: "cx-1" }` |
| Expected | Handler receives `{ sessionId: "cx-1" }` verbatim; fork succeeds and returns `ForkData` |
| Portability | Portable (extended tier) |

**CA-PAYLOAD-05: openFork direct payload**

| Field | Value |
|---|---|
| Spec ref | §7.2, §7.8 |
| Tier | Extended |
| Scenario | Dispatch with payload `{ parentSessionId: "cx-1", forkId: "f-1" }` |
| Expected | Handler receives `{ parentSessionId: "cx-1", forkId: "f-1" }` verbatim; openFork succeeds and returns a `SessionHandle` |
| Portability | Portable (extended tier) |

**CA-PAYLOAD-06: No legacy wrapper accepted**

| Field | Value |
|---|---|
| Spec ref | §7.2 |
| Tier | Core |
| Scenario | Dispatch with a legacy single-key wrapper (e.g., `{ args: { session, prompt } }` for `prompt`, or `{ config: { model } }` for `newSession`) |
| Expected | The handler observes the wrapper as-is — there is no compatibility unwrapping. Required-field reads (e.g., `payload.prompt`, `payload.model`) MUST resolve from the direct payload only; supplying a wrapper produces the natural failure mode for the missing required field (e.g., a stale-handle error or a missing-prompt error). No adapter MAY accept the wrapped shape as equivalent to the direct shape. |
| Portability | Portable |

### 7.5 Name Resolution Tests

**CA-NAME-01: Bare operation name**

| Field | Value |
|---|---|
| Spec ref | §7.3 |
| Tier | Core |
| Scenario | Execute arrives with operation name `"prompt"` |
| Expected | Adapter resolves and dispatches correctly |
| Portability | Portable |

**CA-NAME-02: Fully qualified name**

| Field | Value |
|---|---|
| Spec ref | §7.3 |
| Tier | Core |
| Scenario | Execute arrives with operation name `"code-agent.prompt"` |
| Expected | Adapter strips prefix and resolves correctly |
| Portability | Portable |

**CA-NAME-03: Unknown operation name**

| Field | Value |
|---|---|
| Spec ref | §7.3 |
| Tier | Core |
| Scenario | Execute arrives with operation name `"unknownOp"` |
| Expected | Adapter throws descriptive error listing supported operations |
| Portability | Portable |

### 7.6 Progress Tests

**CA-PROG-01: Progress forwarded during prompt**

| Field | Value |
|---|---|
| Spec ref | §11.1 |
| Tier | Core |
| Scenario | Fake backend emits two progress events during prompt |
| Expected | Two `progressNotification` messages observed on agent-to-host channel |
| Portability | Portable |

**CA-PROG-02: Progress arrives before final result**

| Field | Value |
|---|---|
| Spec ref | §11.1 |
| Tier | Core |
| Scenario | Fake backend emits progress then success |
| Expected | Progress notifications arrive before the final success response |
| Portability | Portable |

**CA-PROG-03: Progress not available on replay**

| Field | Value |
|---|---|
| Spec ref | §11.3 |
| Tier | Core |
| Scenario | Replay a journaled prompt operation |
| Expected | No progress notifications delivered during replay. Only the final result is available |
| Portability | Portable |

### 7.7 Cancellation Tests

**CA-CANCEL-01: Cancel in-flight prompt**

| Field | Value |
|---|---|
| Spec ref | §12 |
| Tier | Core |
| Scenario | Start a prompt that never completes. Send cancel |
| Expected | Adapter attempts cancellation. The operation resolves with an error (error name SHOULD be `"Cancelled"`) or completes naturally. A protocol response is delivered — the operation does not hang |
| Portability | Portable |

**CA-CANCEL-02: Cancel after completion**

| Field | Value |
|---|---|
| Spec ref | §12 |
| Tier | Core |
| Scenario | Prompt completes. Cancel arrives for the same operation immediately after |
| Expected | No error. No crash. Previously delivered result is unaffected. Cancel is a no-op |
| Portability | Portable |

### 7.8 Transport Protocol Tests

**CA-INIT-01: Initialize handshake synthesized**

| Field | Value |
|---|---|
| Spec ref | §13.1 |
| Tier | Core |
| Scenario | Tisyn sends `initialize` to the adapter |
| Expected | Adapter returns `InitializeResponse` with `protocolVersion` and `sessionId`. Initialize is NOT forwarded to the backend |
| Portability | Portable |

**CA-SHUT-01: Shutdown releases resources**

| Field | Value |
|---|---|
| Spec ref | §13.2 |
| Tier | Core |
| Scenario | Open a session. Send shutdown |
| Expected | Adapter closes backend sessions. Subsequent operations fail |
| Portability | Portable |

**CA-DIAG-01: Subprocess exit surfaces diagnostics**

| Field | Value |
|---|---|
| Spec ref | §13.3 |
| Tier | Core |
| Scenario | Fake backend process exits with code 1 and stderr content |
| Expected | Error message includes exit code. Error message includes stderr content. Error does NOT say "Transport closed with in-flight request" |
| Portability | Portable |

### 7.9 Conformance Tier Tests

**CA-TIER-01: Core-only adapter rejects fork**

| Field | Value |
|---|---|
| Spec ref | §8.2 |
| Tier | Core |
| Scenario | Call `fork` on a core-only adapter |
| Expected | Adapter throws descriptive error. Error name SHOULD be `"NotSupported"` |
| Portability | Portable |

**CA-TIER-02: Core-only adapter rejects openFork**

| Field | Value |
|---|---|
| Spec ref | §8.2 |
| Tier | Core |
| Scenario | Call `openFork` on a core-only adapter |
| Expected | Adapter throws descriptive error. Error name SHOULD be `"NotSupported"` |
| Portability | Portable |

### 7.10 Result Extension Tests

**CA-EXT-01: Contract fields always present**

| Field | Value |
|---|---|
| Spec ref | §6.4 rule 1 |
| Tier | Core |
| Scenario | Call `prompt` on any adapter |
| Expected | Returned object has `response` field of type `string` |
| Portability | Portable |

**CA-EXT-02: Extension fields do not break contract**

| Field | Value |
|---|---|
| Spec ref | §6.4 rules 2–3 |
| Tier | Core |
| Scenario | Adapter returns `{ response: "text", extraField: 42 }` |
| Expected | Contract-required `response` field is present and correct. Extra field is ignored by portable assertions |
| Portability | Portable |

### 7.11 Handle Opacity Test

**CA-OPAQUE-01: Handle is opaque string**

| Field | Value |
|---|---|
| Spec ref | §6.1, §7.4 |
| Tier | Core |
| Scenario | Call `newSession` |
| Expected | `sessionId` is a string. Test does NOT assert on format, prefix, or content |
| Portability | Portable |

---

## 8. ACP Adapter Coverage

The ACP adapter conformance suite is defined in a separate
companion document
(`tisyn-code-agent-acp-adapter-test-plan.md`). This section
summarizes its scope and relationship to the base suite.

### 8.1 Scope

The ACP suite applies only to adapters that speak ACP
JSON-RPC over stdio to their backend. It verifies protocol
translation, not contract semantics.

### 8.2 Coverage Summary

| Area | Scenarios | Spec Ref |
|---|---|---|
| Initialize synthesis | 1 | §13.1 |
| Name resolution over ACP | 2 | §7.3 |
| Direct payload over ACP | 6 | §7.2 |
| ACP method mapping | 5 | profile-dependent |
| Success translation | 1 | §6.2, §6.3 |
| Error translation | 3 | §12, §13.3 |
| Progress forwarding | 3 | §11 |
| Cancellation | 2 | §12 |
| Shutdown | 1 | §13.2 |
| Subprocess diagnostics | 2 | §13.3 |
| Malformed payloads | 3 | transport resilience |
| Transport resilience | 3 | transport resilience |

Total: ~33 shared ACP scenarios (see companion document for
the full 36-scenario matrix, which includes 3 base-suite-
delegated IDs).

### 8.3 Non-Duplication Rule

The ACP suite does NOT re-test contract semantics covered by
the base suite. Specifically:

- Session lifecycle sequences → base suite
- Stale-handle behavior → base suite
- Result type shapes → base suite
- Conformance tier gating → base suite

The ACP suite tests how contract operations are
**translated** over ACP, not what they **mean**.

---

## 9. Profile-Specific Coverage

### 9.1 Claude Code Profile (Suite C.1)

**Source:** Tisyn Code Agent Specification §18.1, Claude Code
Specification.

| ID | Scenario | Expected |
|---|---|---|
| CC-ALIAS-01 | `plan` resolves identically to `prompt` | Same behavior as contract `prompt` |
| CC-ALIAS-02 | `prompt` accepted alongside `plan` | Both resolve. Both produce same result |
| CC-EXT-01 | `PlanResult` includes `toolResults` | Optional field present when backend provides it |
| CC-EXT-02 | `PlanResult` always includes `response` | Contract field present regardless of extensions |
| CC-ACP-01 | `plan` maps to ACP `session/prompt` | Correct ACP method name (Claude-specific) |
| CC-ACP-02 | `fork` maps to ACP `session/fork` | Correct ACP method name |
| CC-ACP-03 | `openFork` maps to ACP `session/fork` | Correct ACP method name (reused) |
| CC-SDK-01 | SDK adapter handle uses `cc-` prefix | Adapter-internal convention |
| CC-SDK-02 | SDK two-step fork: `forkSession` + `resumeSession` | Backend-specific lifecycle |
| CC-CFG-01 | `permissionMode: "default"` rejected as headless-incompatible | Binding creation fails |

### 9.2 Codex Profile (Suite C.2)

**Source:** Tisyn Code Agent Specification §18.2.

| ID | Scenario | Expected |
|---|---|---|
| CX-CONFORM-01 | `createSdkBinding` preserves sequential prompt history | Conforms to core tier |
| CX-NONCONF-01 | `createExecBinding` does NOT preserve prompt history | Explicitly non-conforming per spec §18.2 |
| CX-NONCONF-02 | `createExecBinding` is not presented as contract-conforming | Documented as convenience utility |
| CX-CFG-01 | `approval: "untrusted"` rejected | Binding creation fails |
| CX-CFG-02 | `approval: "on-failure"` rejected | Binding creation fails |
| CX-CFG-03 | `sandbox: "workspace-write"` accepted as default | Binding creation succeeds |
| CX-SDK-01 | SDK adapter operation mappings verified against real SDK | Subject to SDK validation |

**Note:** CX-SDK-01 is marked as pending. The Codex SDK API
surface is unverified per spec §18.2. This test becomes
required after SDK validation.

### 9.3 Profile Isolation Rule

No profile-specific test may appear in Suite A or Suite B.
If a test depends on knowledge of which backend is in use, it
belongs in the profile suite, not the shared suite.

---

## 10. Replay and Durability Scenarios

### 10.1 Journal Event Model Alignment

The following constraints bind all tests in all suites:

**R-MODEL-01:** Tests MUST NOT assert that a `CodeAgent`
operation produces a `CloseEvent`. Operations produce
`YieldEvent` entries (one per effect). `CloseEvent` is a
coroutine-level terminal event.

**R-MODEL-02:** Tests that verify journal content MUST assert
on `YieldEvent` entries keyed by coroutineId, with
`description.type` matching the agent type and
`description.name` matching the operation name.

**R-MODEL-03:** Tests MAY assert that the workflow-level
`CloseEvent` contains the expected terminal value, but this
is a workflow-level assertion, not an operation-level one.

### 10.2 Replay Scenarios

**CA-REPLAY-01: SessionHandle survives journal replay**

| Field | Value |
|---|---|
| Spec ref | §6.1.1, §15.3 |
| Tier | Core |
| Scenario | Pre-populate journal with a `YieldEvent` recording a `newSession` result containing `{ sessionId: "cx-1" }`. Replay the workflow |
| Expected | Replay succeeds. The workflow receives `{ sessionId: "cx-1" }` from the journal. No adapter is invoked |
| Portability | Portable |

**CA-REPLAY-02: PromptResult survives journal replay**

| Field | Value |
|---|---|
| Spec ref | §15.3 |
| Tier | Core |
| Scenario | Pre-populate journal with YieldEvents for newSession and prompt results. Replay |
| Expected | Both results come from the journal. No adapter invocation. No backend subprocess |
| Portability | Portable |

**CA-REPLAY-03: Stale handle at frontier — closeSession**

| Field | Value |
|---|---|
| Spec ref | §15.4, §9.1 |
| Tier | Core |
| Scenario | Journal contains newSession + prompt. Execution resumes past frontier. closeSession arrives with the journaled handle. A fresh adapter instance is running |
| Expected | closeSession returns `null` without error (handle is stale, best-effort cleanup) |
| Portability | Portable |

**CA-REPLAY-04: Stale handle at frontier — prompt**

| Field | Value |
|---|---|
| Spec ref | §15.4, §9.2 |
| Tier | Core |
| Scenario | Journal contains newSession + prompt. Execution resumes past frontier. A second prompt arrives with the journaled handle. Fresh adapter instance |
| Expected | prompt fails with `"SessionNotFound"` or equivalent descriptive error |
| Portability | Portable |

**CA-REPLAY-05: Progress not replayed**

| Field | Value |
|---|---|
| Spec ref | §11.3 |
| Tier | Core |
| Scenario | Journal contains a prompt YieldEvent. Replay |
| Expected | No progress notifications delivered. Only the stored result is returned |
| Portability | Portable |

### 10.3 Non-Journaled State

**CA-REPLAY-06: Adapter state is ephemeral**

| Field | Value |
|---|---|
| Spec ref | §15.2 |
| Tier | Core |
| Scenario | Documentation / classification test |
| Expected | The following are NOT in the journal and NOT available after restart: handle-to-backend mappings, SDK objects, subprocess PIDs, progress events, conversation history |
| Portability | Portable |

---

## 11. Portability Classification Scenarios

**CA-PORT-01: Contract-only workflow is portable**

| Field | Value |
|---|---|
| Spec ref | §16.1 |
| Tier | Core |
| Scenario | A workflow uses only `newSession`, `closeSession`, `prompt` and reads only `response` |
| Expected | Workflow is classified as portable. Runs on any conforming adapter |
| Portability | Portable |

**CA-PORT-02: Alias use makes workflow profile-coupled**

| Field | Value |
|---|---|
| Spec ref | §16.2, §17.2 |
| Tier | Core |
| Scenario | A workflow uses `plan` instead of `prompt` |
| Expected | Workflow is classified as profile-coupled. Fails on adapters that do not recognize `plan` |
| Portability | Profile-coupled (Claude Code) |

**CA-PORT-03: Extension field use makes workflow profile-coupled**

| Field | Value |
|---|---|
| Spec ref | §16.2, §6.4 |
| Tier | Core |
| Scenario | A workflow reads `result.toolResults` from a prompt response |
| Expected | Workflow is classified as profile-coupled. The `toolResults` field may be absent on other adapters |
| Portability | Profile-coupled |

**CA-PORT-04: Extended-tier operations limit portability**

| Field | Value |
|---|---|
| Spec ref | §8.3 |
| Tier | Extended |
| Scenario | A workflow uses `fork` and `openFork` |
| Expected | Workflow is portable only across extended-capability adapters. Core-only adapters throw `"NotSupported"` |
| Portability | Portable (extended tier only) |

---

## 12. Harness Model

### 12.1 Base Suite Harness

**Mock CodeAgent Transport.** A configurable
`AgentTransportFactory` that simulates a conforming adapter
at the Tisyn protocol level. Configuration per operation:

- `result` — success value to return
- `error` — `{ message, name }` to return as application error
- `progress` — array of progress values to emit before result
- `delay` — milliseconds before responding
- `neverComplete` — suspends indefinitely (for cancel tests)

Returns a `calls` array recording every execute request
(operation name, args) for transcript assertion.

Handles transport-level messages:
- `initialize` → synthetic `InitializeResponse`
- `shutdown` → break message loop
- `cancel` → halt in-flight task

This mock follows the pattern established by
`createMockClaudeCodeTransport` in `@tisyn/claude-code`.

### 12.2 Stale-Handle Simulation

The base harness simulates stale handles by constructing a
`SessionHandle` with a `sessionId` that was never created by
the current mock instance. This directly tests §9 behavior
without requiring process restart.

### 12.3 Replay Simulation

The base harness uses `InMemoryStream` pre-populated with
`YieldEvent` entries to simulate replay. The `execute()`
function is called with the pre-populated stream. During
replay, the mock transport is not invoked — results come
from the stream.

For frontier-crossing tests, the stream is partially
populated. Replayed operations resolve from the stream.
Post-frontier operations invoke the mock transport, which
sees stale handles and exercises §9 rules.

### 12.4 ACP Suite Harness

**Fake ACP Peer.** A controlled NDJSON stdio process that:

- Receives ACP JSON-RPC requests
- Emits configurable responses (success, error, notification)
- Supports delayed, missing, duplicate, and malformed
  responses
- Simulates subprocess exit with configurable exit code
  and stderr

**Transcript Recorder.** Captures all ACP messages sent from
the adapter to the peer. Preserves order and content for
assertion.

### 12.5 Profile Suite Harness

Profile-dependent:
- Claude Code: Mock SDK session or mock ACP subprocess
- Codex: Mock SDK thread API or mock `codex exec` subprocess

Real-backend smoke tests MAY be included in profile suites
for integration validation but MUST NOT be required for
conformance.

---

## 13. Test Matrix

### 13.1 Base Contract Suite (Suite A)

| ID | Area | Tier | Scenario | Expected | Port |
|---|---|---|---|---|---|
| CA-SHAPE-01 | Shape | Core | newSession result | SessionHandle | P |
| CA-SHAPE-02 | Shape | Core | closeSession result | null | P |
| CA-SHAPE-03 | Shape | Core | prompt result | PromptResult | P |
| CA-SHAPE-04 | Shape | Ext | fork result | ForkData | P(E) |
| CA-SHAPE-05 | Shape | Ext | openFork result | SessionHandle | P(E) |
| CA-LIFE-01 | Lifecycle | Core | Happy path | All succeed | P |
| CA-LIFE-02 | Lifecycle | Core | Sequential prompts | Both succeed | P |
| CA-LIFE-03 | Lifecycle | Core | Transport survives close | Second session works | P |
| CA-LIFE-04 | Lifecycle | Core | Handle invalidation | Prompt on closed fails | P |
| CA-LIFE-05 | Lifecycle | Ext | Fork lifecycle | Full fork/open/prompt | P(E) |
| CA-LIFE-06 | Lifecycle | Ext | Fork preserves parent | Parent unaffected | P(E) |
| CA-STALE-01 | Stale | Core | close tolerant | Returns null | P |
| CA-STALE-02 | Stale | Core | prompt strict | Fails | P |
| CA-STALE-03 | Stale | Core | prompt no recreate | Fails, not garbage | P |
| CA-STALE-04 | Stale | Ext | fork strict | Fails | P(E) |
| CA-STALE-05 | Stale | Ext | openFork strict | Fails | P(E) |
| CA-STALE-06 | Stale | Ext | openFork optim | Non-portable | N/A |
| CA-PAYLOAD-01 | Payload | Core | newSession | Direct payload forwarded | P |
| CA-PAYLOAD-02 | Payload | Core | closeSession | Direct payload forwarded | P |
| CA-PAYLOAD-03 | Payload | Core | prompt | Direct payload forwarded | P |
| CA-PAYLOAD-04 | Payload | Ext | fork | Direct payload forwarded | P(E) |
| CA-PAYLOAD-05 | Payload | Ext | openFork | Direct payload forwarded | P(E) |
| CA-PAYLOAD-06 | Payload | Core | No legacy wrapper accepted | No compat shim | P |
| CA-NAME-01 | Name | Core | Bare name | Resolves | P |
| CA-NAME-02 | Name | Core | Qualified name | Strips prefix | P |
| CA-NAME-03 | Name | Core | Unknown name | Descriptive error | P |
| CA-PROG-01 | Progress | Core | Forwarding | Two events | P |
| CA-PROG-02 | Progress | Core | Ordering | Before result | P |
| CA-PROG-03 | Progress | Core | Replay | Not replayed | P |
| CA-CANCEL-01 | Cancel | Core | In-flight | Resolves | P |
| CA-CANCEL-02 | Cancel | Core | After complete | No-op | P |
| CA-INIT-01 | Protocol | Core | Initialize | Synthesized | P |
| CA-SHUT-01 | Protocol | Core | Shutdown | Resources freed | P |
| CA-DIAG-01 | Protocol | Core | Subprocess exit | Diagnostics | P |
| CA-TIER-01 | Tier | Core | Core rejects fork | NotSupported | P |
| CA-TIER-02 | Tier | Core | Core rejects openFork | NotSupported | P |
| CA-EXT-01 | Extension | Core | Contract fields present | response exists | P |
| CA-EXT-02 | Extension | Core | Extra fields ignored | No break | P |
| CA-OPAQUE-01 | Opacity | Core | Handle is string | Uninterpreted | P |
| CA-REPLAY-01 | Replay | Core | Handle survives replay | From journal | P |
| CA-REPLAY-02 | Replay | Core | Result survives replay | From journal | P |
| CA-REPLAY-03 | Replay | Core | Frontier close | Null on stale | P |
| CA-REPLAY-04 | Replay | Core | Frontier prompt | Error on stale | P |
| CA-REPLAY-05 | Replay | Core | Progress not replayed | No progress | P |
| CA-REPLAY-06 | Replay | Core | Ephemeral state | Classification | P |
| CA-PORT-01 | Portability | Core | Contract-only portable | Classification | P |
| CA-PORT-02 | Portability | Core | Alias coupling | Classification | PC |
| CA-PORT-03 | Portability | Core | Extension coupling | Classification | PC |
| CA-PORT-04 | Portability | Ext | Tier portability | Classification | P(E) |

**Legend:** P = Portable. P(E) = Portable extended tier.
PC = Profile-coupled. N/A = Classification only.

**Total: 49 scenarios.**
Core tier required: 39. Extended tier required: 10.

### 13.2 ACP Adapter Suite (Suite B)

See companion document
(`tisyn-code-agent-acp-adapter-test-plan.md`) for the full
36-scenario matrix.

### 13.3 Profile Suites (Suite C)

See §9 for per-profile scenario tables.

---

## 14. Pass/Fail Criteria

### 14.1 Base Contract Conformance

An adapter passes the base contract suite at the **core
tier** when all 39 core-tier tests in Suite A pass.

An adapter passes at the **extended tier** when all 49 tests
in Suite A pass (39 core + 10 extended).

### 14.2 ACP Adapter Conformance

An ACP-backed adapter passes when it passes both Suite A and
Suite B.

### 14.3 Profile Conformance

A profile adapter passes when it passes Suite A, Suite B (if
ACP-backed), and its profile-specific Suite C.

### 14.4 Non-Conforming Path Documentation

A non-conforming adapter path (e.g., Codex `createExecBinding`)
does not pass Suite A. This is expected and documented. The
profile suite (Suite C) MUST include a test explicitly
asserting non-conformance (e.g., CX-NONCONF-01).

---

## 15. Out-of-Scope Tests

The following MUST NOT appear in any shared suite:

- **Backend reasoning quality.** The content of
  `PromptResult.response` is backend-dependent and
  non-deterministic. Tests use stable fixture values from the
  mock transport, not real model output.

- **Proprietary model behavior.** Tests do not assert on
  model-specific features, tool-calling patterns, or
  reasoning styles.

- **Per-operation CloseEvent.** No test may assert that an
  individual `CodeAgent` operation produces a `CloseEvent`.
  This would encode the wrong event model.

- **Extension fields in base suite.** No base-suite test may
  assert on `toolResults`, `PlanResult`, or any other
  profile-specific extension field.

- **Internal adapter state.** No test may inspect session
  maps, handle registries, or SDK object properties.

- **Progress event schema.** No test may assert on the
  structure of progress event values. Tests assert only on
  delivery and ordering.

- **Implementation-private optimizations.** Adapter-internal
  session caching, connection pooling, or subprocess reuse
  are not tested.

---

## 16. Recommended Deliverables

| Document | Scope |
|---|---|
| `tisyn-code-agent-test-plan.md` | This document |
| `tisyn-code-agent-acp-adapter-test-plan.md` | ACP adapter conformance (already drafted) |
| `tisyn-claude-code-profile-test-plan.md` | Claude Code profile deltas |
| `tisyn-codex-profile-test-plan.md` | Codex profile deltas |

Implementation artifacts:

| Artifact | Scope |
|---|---|
| `@tisyn/code-agent` mock transport | Shared harness for Suite A |
| Suite A test runner | Base contract conformance |
| Suite B test runner | ACP adapter conformance |
| Per-profile test runners | Profile-specific deltas |

---

## Appendix A: Coverage Map

### Spec Section → Test Coverage

| Spec Section | Test IDs |
|---|---|
| §6.1 SessionHandle | CA-SHAPE-01, CA-SHAPE-05, CA-OPAQUE-01 |
| §6.1.1 Durability | CA-REPLAY-01, CA-REPLAY-06 |
| §6.2 PromptResult | CA-SHAPE-03, CA-EXT-01 |
| §6.3 ForkData | CA-SHAPE-04 |
| §6.4 Extension Rules | CA-EXT-01, CA-EXT-02 |
| §7.2 Direct payload | CA-PAYLOAD-01 through CA-PAYLOAD-06 |
| §7.3 Name Resolution | CA-NAME-01 through CA-NAME-03 |
| §7.4 newSession | CA-SHAPE-01, CA-LIFE-01 |
| §7.5 closeSession | CA-SHAPE-02, CA-LIFE-01, CA-LIFE-04 |
| §7.6 prompt | CA-SHAPE-03, CA-LIFE-02 |
| §7.7 fork | CA-SHAPE-04, CA-LIFE-05, CA-LIFE-06 |
| §7.8 openFork | CA-SHAPE-05, CA-LIFE-05 |
| §8.1 Core Tier | CA-TIER-01, CA-TIER-02, CA-LIFE-02 |
| §8.2 Extended Tier | CA-TIER-01, CA-TIER-02 |
| §8.3 Tier Portability | CA-PORT-04 |
| §9.1 close tolerant | CA-STALE-01, CA-REPLAY-03 |
| §9.2 prompt strict | CA-STALE-02, CA-STALE-03, CA-REPLAY-04 |
| §9.4 fork strict | CA-STALE-04 |
| §9.5 openFork strict | CA-STALE-05, CA-STALE-06 |
| §10.1 State Machine | CA-LIFE-01, CA-LIFE-03, CA-LIFE-05 |
| §10.2 Sequential | CA-LIFE-02 |
| §11.1 Progress | CA-PROG-01, CA-PROG-02 |
| §11.3 Progress Replay | CA-PROG-03, CA-REPLAY-05 |
| §12 Cancellation | CA-CANCEL-01, CA-CANCEL-02 |
| §13.1 Initialize | CA-INIT-01 |
| §13.2 Shutdown | CA-SHUT-01 |
| §13.3 Diagnostics | CA-DIAG-01 |
| §15.1 Journaled | CA-REPLAY-01, CA-REPLAY-02 |
| §15.2 Not Journaled | CA-REPLAY-06 |
| §15.3 Replay | CA-REPLAY-01 through CA-REPLAY-05 |
| §15.4 Frontier | CA-REPLAY-03, CA-REPLAY-04 |
| §16.1 Portable | CA-PORT-01 |
| §16.2 Profile-Coupled | CA-PORT-02, CA-PORT-03 |
| §17.2 Extension Rules | CA-PORT-02, CA-PORT-03 |
