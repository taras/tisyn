# Tisyn Code Agent Specification

**Version:** 1.0.0
**Implements:** Tisyn System Specification
**Depends on:** Tisyn Agent Specification, Tisyn Transport
Specification, Tisyn Protocol Specification, Tisyn Config
Specification
**Complements:** Tisyn Browser Contract Specification
**Status:** Draft

---

### Changelog

**v1.0.0** — Initial normative release. Defines the
`CodeAgent` contract, conformance tiers, session lifecycle,
stale-handle semantics, replay/durability rules, portability
rules, and adapter/profile extension model.

---

## 1. Overview

This specification defines the `CodeAgent` contract — the
normative workflow-visible interface for session-oriented
coding agents in Tisyn.

A coding agent is an external process that accepts text
prompts, executes an internal tool loop (shell commands, file
patches, web searches), and returns text results. The
`CodeAgent` contract provides a portable abstraction over
this category: workflows interact with coding agents through
a fixed set of operations and types, regardless of which
backend product (Claude Code, Codex, or a future agent)
provides the implementation.

The contract is the stable surface. Concrete adapter packages
(`@tisyn/claude-code`, `@tisyn/codex`, others) implement the
contract for specific backends. Workflows that use only the
contract surface are portable across all conforming adapters.

`CodeAgent` is a transport-bound agent contract. It sits at
the same architectural layer as the Browser contract: the
workflow sees a declared agent with typed operations; the
transport owns the subprocess, protocol translation, and
backend lifecycle. No kernel, compiler, IR, or config
specification changes are required.

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY
are used as defined in RFC 2119.

---

## 2. Scope and Non-Goals

### 2.1 Normative Scope

This specification normatively defines:

- the `CodeAgent` operation set and input/output types
- session lifecycle invariants
- session handle durability semantics
- stale-handle behavior per operation
- fork lifecycle
- cancellation semantics
- progress forwarding requirements
- journaling and replay semantics
- configuration categories and placement
- adapter conformance tiers
- profile extension rules and portability consequences

### 2.2 Non-Goals

This specification does not define:

- backend-specific SDK, CLI, or protocol details
- concrete adapter implementations
- authored workflow syntax beyond what the Tisyn compiler
  already supports
- backend-specific sandbox enforcement mechanisms
- backend-specific approval policy values
- compiler, kernel, IR, or config specification amendments
- the internal tool loop of any coding agent
- progress event schema normalization

---

## 3. Relationship to Other Specifications

| Specification | Relationship |
|---|---|
| System Specification | Authority for IR evaluation, scope semantics, durable replay |
| Agent Specification | Authority for `agent()`, `operation()` declarations |
| Transport Specification | Authority for `LocalAgentBinding`, `AgentTransportFactory`, session management |
| Protocol Specification | Authority for `executeSuccess`, `executeApplicationError`, `progressNotification`, `initializeResponse` |
| Config Specification | Authority for `transport.local()` descriptor, environment resolution |
| Browser Contract Specification | Peer contract; shared architectural pattern (transport-bound agent with narrow host-visible surface) |
| Claude Code Specification | Profile specification subordinate to this contract |

This specification does not amend any of the above. It
introduces a new contract that existing and future adapter
specifications declare conformance to.

---

## 4. Terminology

**CodeAgent contract.** The normative interface defined by
this specification. A fixed set of operations, types, and
semantic rules.

**Adapter.** A concrete package that implements the
`CodeAgent` contract for a specific backend. An adapter
produces a `LocalAgentBinding` consumed by the Tisyn
transport layer.

**Backend.** The external coding agent product that an
adapter connects to (e.g., Claude Code, Codex CLI).

**Adapter profile.** The specification of a particular
adapter's backend-specific behavior: operation mappings,
extended result types, configuration fields, and headless
constraints. A profile is subordinate to this contract.

**Conforming adapter.** An adapter that satisfies all
requirements of the core conformance tier (§8.1).

**Extended-capability adapter.** A conforming adapter that
additionally implements the extended conformance tier (§8.2).

**Session.** A stateful conversation context within a coding
agent backend. A session maintains conversation history
across prompts.

**Session handle.** A `SessionHandle` value identifying a
session. A session handle is a **durable token**: it is
serializable and journaled, but it is **not a durable session
capability** — it does not carry the ability to use the
session it once referenced after the adapter instance that
created it has ended.

**Stale handle.** A session handle from a previous adapter
instance. After process restart, all handles from the
previous instance are stale.

**Durable token.** A serializable value that appears in
journal entries and survives replay, but whose referent
(the live session) does not survive adapter instance
boundaries.

**Portable workflow.** A workflow that uses only
contract-defined operation names and reads only
contract-defined result fields. Portable workflows are
backend-agnostic.

**Profile-coupled workflow.** A workflow that uses profile
extensions (operation aliases, extended result fields). Such
workflows are tied to a specific adapter profile and are not
portable.

**Configuration category.** A named class of adapter
configuration. The contract defines the categories; adapter
profiles define the concrete values.

---

## 5. Architectural Placement

```
┌──────────────────────────────────────────────┐
│ Authored Workflow                             │
│   yield* CodeAgent().prompt(...)              │
├──────────────────────────────────────────────┤
│ Compiler → Eval("<agent-id>.prompt", ...)     │
├──────────────────────────────────────────────┤
│ Kernel → Suspend { id, data }                 │
├──────────────────────────────────────────────┤
│ Execution Layer                               │
│   Journal: YieldEvent per effect              │
│   Dispatch: via transport                     │
├──────────────────────────────────────────────┤
│ CodeAgent Adapter                             │
│   Implements this contract                    │
│   Translates Tisyn protocol ↔ backend         │
├──────────────────────────────────────────────┤
│ Backend SDK / CLI / Process                   │
│   Manages subprocess lifecycle                │
├──────────────────────────────────────────────┤
│ Coding Agent Internal Loop                    │
│   Opaque to Tisyn                             │
└──────────────────────────────────────────────┘
```

No layer above the adapter knows which backend is in use.
No layer below the adapter knows Tisyn exists. The adapter
is the translation boundary.

The compiler produces standard `Eval` IR nodes for
`CodeAgent` operations. The kernel yields standard `Suspend`
descriptors. The execution layer journals a `YieldEvent` for
each effect result. Nothing in this pipeline is
`CodeAgent`-specific.

---

## 6. Contract Types

All types in the `CodeAgent` contract MUST belong to the
portable serializable data domain defined by the Config
Specification §3.1.

### 6.1 SessionHandle

```typescript
interface SessionHandle {
  sessionId: string;
}
```

An opaque reference to a session. The `sessionId` is an
adapter-internal identifier. The workflow MUST NOT parse,
interpret, or depend on its format.

#### 6.1.1 Durability Semantics

A `SessionHandle` is a **durable token**: it is serializable,
it appears in journal entries, and replay carries it across
the journal frontier into live execution.

A `SessionHandle` is **not a durable session capability**.
The token identifies a session that existed in a specific
adapter instance. It does not carry the ability to use that
session after the adapter instance ends. After process
restart, a new adapter instance exists, and all handles from
the previous instance are stale — they are inert strings that
no longer reference live sessions.

The workflow cannot distinguish a handle replayed from the
journal from a handle returned by a live `newSession` call.
Both are opaque strings. Only the adapter knows whether a
handle references a live session. The stale-handle rules
(§9) define the behavior for each operation when the handle
is stale.

Adapters MUST NOT promise session resumability from journaled
handles as a contract guarantee. An adapter MAY implement
session resume as a non-portable optimization (§9.5), but
workflows MUST NOT depend on it for correctness.

### 6.2 PromptResult

```typescript
interface PromptResult {
  response: string;
}
```

The result of a prompt operation. The `response` field
contains the coding agent's final response text.

### 6.3 ForkData

```typescript
interface ForkData {
  parentSessionId: string;
  forkId: string;
}
```

Metadata returned by a fork operation. `parentSessionId` is
the adapter-internal handle of the parent session. `forkId`
is the identifier of the forked conversation. Both values
are adapter-internal and opaque.

### 6.4 Result Extension Rules

Adapters MAY return objects containing fields beyond those
defined in §6.1–§6.3. The following rules apply:

1. **Contract fields are mandatory.** Adapters MUST NOT omit
   any field defined in the contract types. A `PromptResult`
   MUST always contain `response: string`.

2. **Extension fields are non-portable.** Any field not
   defined in this contract is adapter-specific. Workflows
   that read extension fields are profile-coupled and
   forfeit portability guarantees.

3. **Extension fields MUST NOT conflict.** Adapters MUST NOT
   redefine the type or semantics of a contract-defined
   field. `response` is always a string containing the final
   response text, regardless of backend.

4. **Extension typing.** Adapter profile specifications
   SHOULD define extended result types as interfaces
   extending the contract types:
   ```typescript
   interface PlanResult extends PromptResult {
     toolResults?: Array<{ tool: string; output: unknown }>;
   }
   ```

5. **No contract promotion without amendment.** Extension
   fields MUST NOT become de facto contract requirements. If
   a field proves universally useful, it SHOULD be promoted
   through a specification amendment, not through adapter
   convention.

---

## 7. Declared Operations

The `CodeAgent` contract declares five operations in two
conformance tiers.

### 7.1 Operation Table

| Operation | Tier | Input Shape | Returns |
|-----------|------|-------------|---------|
| newSession | Core | `{ model?: string }` | `SessionHandle` |
| closeSession | Core | `SessionHandle` | `null` |
| prompt | Core | `{ session: SessionHandle; prompt: string }` | `PromptResult` |
| fork | Extended | `SessionHandle` | `ForkData` |
| openFork | Extended | `ForkData` | `SessionHandle` |

### 7.2 Operation Payload Shape

The Tisyn compiler passes each single-parameter ambient
operation's argument through directly as the effect payload.
For example, `prompt(args: { session, prompt })` compiles to
the effect payload `{ session: {...}, prompt: "..." }` —
there is no compiler-added wrapper keyed by the authored
parameter name.

Multi-parameter ambient operations are still lowered to a
named object keyed by the authored parameter names, but no
operation in this contract has more than one parameter.

### 7.3 Operation Name Resolution

Operation names MAY arrive at the adapter fully qualified
(e.g., `"code-agent.prompt"`) or bare (e.g., `"prompt"`).
Adapters MUST strip the agent prefix before lookup.

If the bare name does not match any known operation, the
adapter MUST throw with a descriptive error listing all
supported operations.

### 7.4 newSession

Creates a new coding agent session.

**Precondition:** None.

**Postcondition:** A new session exists in the adapter's
internal session map. The returned `SessionHandle` is valid
for `prompt`, `fork`, and `closeSession` until
`closeSession` is called or the adapter instance is
destroyed.

**Contract:**

- The adapter MUST generate an adapter-internal handle
  (e.g., `"cx-1"`, `"cc-1"`) and MUST NOT expose the real
  backend session or thread identifier to the workflow.
- The `model` field in the input is advisory. Adapters
  SHOULD respect it but MAY override from binding config.
  If omitted, the adapter MUST use its configured default.

### 7.5 closeSession

Releases an existing session.

**Precondition:** None (tolerates stale handles — see §9.1).

**Postcondition:** If the handle referenced a live session,
the session is released and the handle is invalidated.

**Contract:**

- If the handle references a live session, the adapter MUST
  release it.
- **Stale-handle rule:** If the handle does not reference a
  live session, the adapter MUST return `null` without
  error.

**Rationale.** `closeSession` is a cleanup operation invoked
in `finally` blocks of the `resource` pattern. It MUST NOT
throw on stale handles because the `finally` block runs
after process restart when the original session no longer
exists. Throwing would mask the original error or abort
resource cleanup.

### 7.6 prompt

Sends a text prompt to an existing session and returns the
agent's response.

**Precondition:** The session handle MUST reference a live
session in the current adapter instance. The prompt MUST be
a non-empty string.

**Postcondition:** The session's conversation history
includes the prompt and the agent's response.

**Contract:**

- The adapter MUST forward intermediate progress events
  from the backend as `progressNotification` messages
  (§11).
- The operation blocks until the agent completes its
  response.
- **Stale-handle rule:** If the handle does not reference a
  live session in the current adapter instance, the adapter
  MUST fail with a descriptive error. The error name SHOULD
  be `"SessionNotFound"`.

**Rationale.** `prompt` is a substantive operation whose
result depends on the session's conversation history. A
session recreated from a stale handle has no history.
Sending a prompt like "now implement the changes you
described" to an empty session produces meaningless output.
Failing explicitly surfaces the real problem — session lost
due to crash — instead of silently producing garbage.

### 7.7 fork (Extended Tier)

Creates fork metadata from an existing session.

**Precondition:** The session handle MUST reference a live
session. At least one `prompt` SHOULD have been executed on
the session before forking. Some backends require an
initialized session.

**Postcondition:** The parent session is unaffected. The
returned `ForkData` is not yet a usable session — it MUST
be passed to `openFork`.

**Contract:**

- **Stale-handle rule:** The adapter MUST fail with a
  descriptive error if the handle does not reference a live
  session.

**Rationale for two-step fork.** Some backends separate
fork-metadata creation from session opening. Others combine
them. The two-step design supports both: backends that
separate the steps implement both operations with real
backend calls; backends that combine them perform the actual
fork in `openFork` and use `fork` only to capture parent
identity. The two-step design also enables journaling the
`ForkData` as a separate durable event.

### 7.8 openFork (Extended Tier)

Opens a previously forked session as a new usable session.

**Precondition:** The `ForkData` MUST have been produced by
a prior `fork` call.

**Postcondition:** A new session exists backed by the forked
conversation history.

**Contract:**

- Returns a new `SessionHandle`.
- **Stale ForkData behavior:** See §9.5.

---

## 8. Conformance Tiers

### 8.1 Core Tier (REQUIRED)

Every conforming adapter MUST implement `newSession`,
`closeSession`, and `prompt`. Specifically, a conforming
adapter MUST satisfy all of the following:

1. It exports a function returning `LocalAgentBinding`.
2. The binding's transport implements `newSession`,
   `closeSession`, and `prompt` per §7.4–§7.6.
3. It synthesizes the Tisyn initialize handshake (§13.1).
4. It accepts the operation payload shape defined in §7.2.
5. It implements operation name resolution per §7.3.
6. It forwards progress events per §11.
7. It handles cancellation per §12.
8. It implements stale-handle rules per §9.
9. It validates headless constraints per §14.2.
10. It does not expose backend session or thread identifiers
    to the workflow.
11. It returns contract-required fields on all result types
    per §6.4.

An adapter whose backend cannot preserve conversation
history across sequential prompts on the same session handle
does not conform to the core tier. Sequential prompts on the
same session MUST be supported, and each prompt MUST add to
the session's conversation history.

### 8.2 Extended Tier (OPTIONAL)

An adapter additionally conforms at the extended tier if it
implements `fork` and `openFork` per §7.7–§7.8 and §9.4–§9.5.

Adapters that do not support forking MUST throw a descriptive
error when `fork` or `openFork` is invoked. The error name
SHOULD be `"NotSupported"`.

### 8.3 Tier Portability

Workflows that use only core-tier operations are portable
across all conforming adapters. Workflows that use `fork` or
`openFork` are portable only across extended-capability
adapters.

---

## 9. Stale-Handle Semantics

A session handle is **stale** when it does not reference a
live session in the current adapter instance. This occurs
after process restart, when a new adapter instance exists and
all handles from the previous instance are inert.

### 9.1 closeSession — Tolerant

The adapter MUST return `null` without error. This is
best-effort cleanup.

### 9.2 prompt — Strict

The adapter MUST fail with a descriptive error. The error
name SHOULD be `"SessionNotFound"`. The adapter MUST NOT
attempt transparent session recreation.

### 9.3 newSession — Not Applicable

`newSession` does not accept a session handle. Stale-handle
semantics do not apply.

### 9.4 fork — Strict

The adapter MUST fail with a descriptive error if the session
handle does not reference a live session.

### 9.5 openFork — Strict with Permitted Optimization

**Guaranteed portable behavior.** If the `forkId` in the
`ForkData` references a fork that the current adapter
instance cannot resolve, the adapter MUST fail with a
descriptive error. The adapter MUST NOT silently create an
unrelated new session.

**Permitted adapter optimization.** An adapter that persists
handle-to-backend-ID mappings across process restarts MAY
successfully resolve stale `ForkData` if it can verify with
the backend that the fork is still valid. This is a
non-portable optimization.

**Non-portable assumption.** Workflows MUST NOT depend on
stale `ForkData` resolution succeeding for correctness. The
contract guarantees only that failure is explicit, not that
recovery is possible.

### 9.6 Summary Table

| Operation | Stale Behavior | Rationale |
|---|---|---|
| closeSession | Return `null` | Best-effort cleanup in `finally` blocks |
| prompt | Fail with error | No conversation history to continue |
| fork | Fail with error | No live session to fork |
| openFork | Fail with error (optimization permitted) | No guarantee fork is still valid |

---

## 10. Session Lifecycle

### 10.1 State Machine

```
                 newSession()
                 ─────────────▶ OPEN
                                 │
                   ┌─────────────┼───────────────┐
                   │             │               │
                   ▼             ▼               ▼
              prompt()       fork()        closeSession()
                   │             │               │
                   │             │               ▼
                   │             │             CLOSED
                   │             │
                   │        openFork()
                   │             │
                   │             ▼
                   │         OPEN (new session)
                   │
                   └──── (remains OPEN)
```

`fork` does not change the parent session's state. It returns
`ForkData`, which is a value, not a session state.

### 10.2 Sequential Prompts

Multiple sequential `prompt` calls on the same session MUST
be supported. Each prompt MUST add to the session's
conversation history. This is the primary usage pattern for
multi-step coding tasks.

### 10.3 Concurrent Prompts

Concurrent `prompt` calls on the **same** session are
undefined behavior. Concurrent `prompt` calls on
**different** sessions MUST be supported if the backend
allows it.

---

## 11. Progress Forwarding

### 11.1 Requirement

Adapters MUST forward intermediate events from the backend
as `progressNotification` messages on the agent-to-host
channel. The progress token MUST be associated with the
in-flight request (using the request ID or the
`progressToken` from the execute params, if present).

### 11.2 Progress Event Shape

Progress event values are backend-specific. The contract does
not normalize progress event shapes. Workflows that observe
progress events are coupling to the backend's event schema
and forfeit portability of their progress-handling logic.

### 11.3 Progress and Replay

Progress events are NOT journaled. They are NOT available on
replay. The workflow's durable state depends only on the
final operation result.

---

## 12. Cancellation Semantics

When the transport receives a `cancel` message for an
in-flight operation:

1. The adapter MUST attempt to cancel the backend operation.
2. The in-flight operation SHOULD resolve with an error. The
   error name SHOULD be `"Cancelled"`.
3. The adapter MUST NOT silently drop the in-flight operation
   without delivering either a success or an error to the
   host. Every dispatched execute request MUST eventually
   receive a protocol response.
4. If the backend does not support cancellation, the adapter
   MUST still acknowledge the cancel and allow the operation
   to complete or error naturally.
5. Cancellation is best-effort with respect to side effects.
   The backend may have executed tool calls before
   cancellation took effect.

---

## 13. Transport-Level Protocol

### 13.1 Initialize Handshake

When the transport receives a Tisyn `initialize` message,
the adapter MUST:

1. Synthesize an `InitializeResponse` containing
   `protocolVersion` and a unique `sessionId`.
2. Send the response on the agent-to-host channel.
3. NOT forward the message to the backend.

Coding agent backends do not speak Tisyn protocol. The
adapter handles the handshake on their behalf.

### 13.2 Shutdown

When the transport receives a `shutdown` message, the adapter
MUST close all open backend sessions and release resources.

### 13.3 Subprocess Diagnostics

If the backend subprocess exits unexpectedly, the adapter
MUST surface a diagnostic error containing:

- exit code or signal
- command and arguments
- captured stderr content (when available)

The adapter MUST NOT surface a generic "Transport closed
with in-flight request" message when richer subprocess
diagnostics are available.

---

## 14. Configuration Categories

The contract defines five configuration categories. Adapters
MUST accept these categories in their binding config types.
Concrete values and defaults are backend-specific.

| Category | Description |
|---|---|
| Model | Language model selection |
| Sandbox | Filesystem and network access constraints |
| Approval | Human-in-the-loop policy |
| Working directory | Filesystem root for agent operations |
| Environment | Environment variables for the subprocess |

### 14.1 Placement

All five categories are **binding config**. They are set when
the binding is created and apply to all operations in that
binding's lifetime. They are not workflow operation
parameters.

**Rationale.** These are deployment and operational concerns.
A workflow expresses what to do, not how safely to do it.

### 14.2 Headless Constraints

Adapters MUST validate at binding creation time that the
configured approval policy is compatible with headless
execution. Policies requiring interactive human approval MUST
be rejected with a descriptive error.

The specific policy values that are headless-incompatible are
backend-specific and belong in adapter profile
specifications, not in this contract.

### 14.3 Replay and Configuration

Configuration category values are NOT durable execution
inputs. They are NOT replay-validated.

The journal records operation results, not operation inputs.
During replay, the adapter is not invoked — results come from
the journal. Configuration values are irrelevant during
replay because the adapter does not execute.

At the journal frontier, configuration values affect live
execution of new operations. A different model may produce
different prompt responses. This is no different from any
other environmental variation. Tisyn's durability model
journals results, not the conditions that produced them.

Changing configuration between executions does not invalidate
the journal. Operations replayed from the journal produce
their recorded results regardless of current configuration.
Operations executed live at the frontier use the current
configuration.

---

## 15. Replay and Durability Semantics

### 15.1 What Is Journaled

Each `CodeAgent` operation is an external effect. The
execution layer journals one `YieldEvent` per effect,
recording the effect description and result. The coroutine's
`CloseEvent` records the workflow's terminal value when the
coroutine completes.

- **YieldEvent** (one per operation): Records the effect
  description (agent type and operation name) and the
  operation result (`SessionHandle`, `PromptResult`,
  `ForkData`, `null`, or error). The persist-before-resume
  invariant applies: the `YieldEvent` is durably
  acknowledged before the kernel resumes with the result.
- **CloseEvent** (one per coroutine): Records the
  coroutine's terminal state when it completes, errors, or
  is cancelled. This is NOT per-operation — it is the
  workflow-level terminal value.

### 15.2 What Is NOT Journaled

- Adapter-internal handle ↔ backend session ID mappings
- Backend SDK objects and subprocess state
- Subprocess PIDs
- Progress events
- Sandbox and approval enforcement state
- Backend conversation history

These are transport-owned ephemeral state. They do not
survive process restart.

### 15.3 Replay Behavior

On journal replay, the execution layer reads results from the
journal without invoking the adapter. During replay:

- Session handles in the journal are strings from the
  original execution.
- `PromptResult` values in the journal are the original
  response texts.
- The adapter does not exist. No backend sessions exist.
  No subprocesses run. Replay is a pure journal read.

### 15.4 Frontier Crossing

When execution passes the journal frontier, the adapter is
invoked for the first time. Operations arriving at the
adapter may reference session handles from the journal. These
handles are stale (§9 applies).

**Critical invariant.** Session handles are scoped to an
adapter instance. A handle created by adapter instance A is
meaningless to adapter instance B. After process restart, a
new adapter instance exists. All handles from the previous
instance are stale.

The workflow author's responsibility: scope sessions within
the operations they need. The `resource` pattern
(`try`/`finally` with `closeSession`) ensures cleanup. If a
crash occurs mid-session:

1. On restart, replay proceeds without the adapter.
2. At the frontier, `closeSession` on the stale handle
   returns `null` (best-effort cleanup per §9.1).
3. `prompt` on the stale handle fails with
   `SessionNotFound` (per §9.2).
4. The workflow error propagates to the caller, which can
   create a new session and retry.

This is the correct behavior. Silent recreation would violate
correctness. Explicit failure lets the workflow handle the
situation.

---

## 16. Portability Rules

### 16.1 Portable Workflow

A workflow is **portable** across all conforming adapters if
and only if:

- it uses only contract-defined operation names
  (`newSession`, `closeSession`, `prompt`, `fork`,
  `openFork`)
- it reads only contract-defined result fields (`response`,
  `sessionId`, `parentSessionId`, `forkId`)
- it uses only core-tier operations (for portability across
  all conforming adapters) or extended-tier operations (for
  portability across extended-capability adapters)

### 16.2 Profile-Coupled Workflow

A workflow that uses any profile extension — an operation
alias, an extended result field, or profile-specific
configuration — is **knowingly profile-coupled**. It is tied
to a specific adapter profile and is not portable.

The compiler does not enforce this boundary. It is the
author's responsibility.

---

## 17. Adapter and Profile Rules

### 17.1 Relationship to Profile Specifications

Each adapter package MAY have its own specification
documenting backend-specific behavior. Such specifications
MUST conform to this contract.

### 17.2 Profile Extension Rules

Adapter profiles are permitted to extend the contract surface
in three ways. Each carries a portability consequence:

1. **Operation aliases.** A profile MAY declare alternative
   names for contract operations (e.g., `plan` as an alias
   for `prompt`). An alias MUST have identical semantics to
   the contract operation it maps to. The adapter MUST
   resolve the alias internally — the contract operation
   table (§7.1) is not expanded. A workflow that uses an
   alias is profile-coupled.

2. **Result field extensions.** A profile MAY define
   additional fields on contract result types per §6.4. A
   workflow that reads extension fields is profile-coupled.

3. **Profile-specific configuration.** A profile MAY define
   backend-specific configuration fields in its binding
   config type (e.g., `permissionMode` for Claude Code).
   These do not affect the contract surface.

### 17.3 Profile Restrictions

Profiles MUST NOT introduce operations that have no contract
equivalent. Profiles MUST NOT alter the semantics of
contract-defined operations. Profiles MUST NOT omit
contract-required result fields.

---

## 18. Profile Relationships

This section defines the relationship between the base
contract and known profile implementations. Full
backend-specific profile specifications are separate
documents.

### 18.1 Claude Code Profile (`@tisyn/claude-code`)

**Conformance tier:** Core + Extended.

**Operation mapping:**

| Contract Op | Claude Code Op | Notes |
|---|---|---|
| newSession | newSession | Identical |
| closeSession | closeSession | Identical |
| prompt | plan | Profile-defined alias per §17.2 |
| fork | fork | Identical |
| openFork | openFork | Identical |

**Result extension:** `PlanResult extends PromptResult` adds
an optional `toolResults` field. This is a non-portable
extension per §6.4.

The existing Claude Code Specification predates this
contract. It SHOULD be amended to declare conformance and
to annotate `plan` as an alias for the contract's `prompt`
operation.

### 18.2 Codex Profile (`@tisyn/codex`)

**Conformance tier:** Core (extended tier subject to SDK
verification).

**Validated backend facts:** Config field values (sandbox
modes `read-only`, `workspace-write`, `danger-full-access`;
approval policies `on-request`, `never`; headless-
incompatible policies `untrusted`, `on-failure`), CLI
invocation model (`codex exec --json`), OS-kernel sandboxing.

**Design recommendation:** `@openai/codex-sdk` TypeScript SDK
as the primary adapter integration path. This is a design
recommendation, not a backend constraint — other integration
paths exist and MAY be chosen.

**Non-conforming utility:** A `codex exec --json` wrapper
that spawns a fresh subprocess per prompt is NOT a conforming
`CodeAgent` adapter because it does not preserve conversation
history across sequential prompts (§8.1, §10.2). Such a
wrapper MAY be offered as a convenience utility for
single-prompt CI workflows, but it MUST NOT be presented as
satisfying the `CodeAgent` contract.

**SDK operation mappings:** Not yet verified. Adapter profile
specification MUST be updated after SDK validation.

---

## 19. Required Amendments

### 19.1 Existing Specifications

**Architecture Specification.**
- Add `@tisyn/code-agent` and `@tisyn/codex` to the package
  map table.
- Add `CodeAgent` to the terminology section as an example
  of a transport-bound agent contract alongside the Browser
  contract.

**Claude Code Specification.**
- §1 Overview: Add conformance statement (Core + Extended).
- §1.2 Normative Scope: Note subordination to the
  `CodeAgent` contract.
- §4.1 Operation Table: Annotate each operation with its
  contract equivalent. Note `plan` as a profile alias for
  `prompt`.
- §4.2 Operation Payload Shape: Note conformance to §7.2.
- New section: Define `PlanResult` as an extension type.
  State that `toolResults` is a non-portable extension
  field per §6.4.
- Add `prompt` as an accepted operation alias resolving
  identically to `plan`.

**Claude Code Test Plan.**
- Reframe as a product-profile test plan within the
  three-tier suite model (base contract, ACP adapter,
  product profile).
- Classify existing 16 tests by tier.
- Add coverage map referencing base and ACP suite test IDs.

**All other specifications.**
No amendments required. The kernel, compiler, config, scoped
effects, browser contract, and transport specifications are
unaffected.

### 19.2 New Documents

| Document | Content |
|---|---|
| `tisyn-code-agent-specification.md` | This document |
| `tisyn-code-agent-test-plan.md` | Base contract conformance suite |
| `tisyn-code-agent-acp-adapter-test-plan.md` | ACP adapter conformance suite |
| `tisyn-codex-specification.md` | Codex adapter profile |
| `tisyn-codex-test-plan.md` | Codex-specific tests |

---

## 20. Rejected Alternatives

### 20.1 Per-Product Specification without Unifying Contract

A separate `@tisyn/codex` specification with its own
operation set, types, and semantics. Rejected because it
duplicates normative text, prevents workflow portability, and
does not scale to additional coding agents.

### 20.2 SDK-Shaped Normative Contract

A contract whose operations mirror a specific backend SDK
(e.g., Claude Code's `unstable_v2_createSession` / `send` /
`stream` surface). Rejected because it couples the normative
spec to a single product's API, which evolves independently
of Tisyn.

### 20.3 Transparent Stale-Session Recreation

Allowing `prompt` on a stale handle to silently create a new
empty session and proceed. Rejected because the new session
has no conversation history, making context-dependent prompts
produce meaningless results. This violates Tisyn's
correctness-by-construction principle.

### 20.4 Browser-Contract-Style Execute Operation

Modeling coding agents like the Browser contract with a
`CodeAgent.execute({ workflow })` operation that sends IR for
local evaluation. Rejected because coding agents do not
evaluate IR — they accept text prompts and run their own
internal tool loops.

### 20.5 Dedicated Config Transport Kind per Product

A new `transport.codex()` or `transport.claudeCode()` in the
config specification. Rejected because `transport.local()`
already handles binding modules, and product-specific
transport kinds do not scale.

### 20.6 External ACP Bridge as Primary Integration Path

Using `zed-industries/codex-acp` as the Codex subprocess.
Rejected because it introduces a Rust binary dependency,
depends on a forked Codex workspace, and imposes
editor-oriented ACP protocol overhead irrelevant to headless
workflow execution.

### 20.7 Unscoped PascalCase Naming Policy

Applying PascalCase uniformly to all constructor-like forms
including config constructors (`workflow()`, `agent()`) and
authored intrinsics (`resource`, `provide`). Rejected because
it creates naming collisions between IR constructors and
authored intrinsics (e.g., `Resource` the IR constructor vs.
`resource` the authored intrinsic) and conflates
architecturally distinct categories.

---

## Appendix A: Worked Example — Portable Workflow

```typescript
import { type Workflow, resource, provide } from "@tisyn/agent";
import type {
  SessionHandle,
  PromptResult,
  ForkData,
} from "@tisyn/code-agent";

// Contract declaration — PascalCase per naming policy
declare function CodeAgent(): {
  newSession(config: { model?: string }): Workflow<SessionHandle>;
  closeSession(handle: SessionHandle): Workflow<null>;
  prompt(args: {
    session: SessionHandle;
    prompt: string;
  }): Workflow<PromptResult>;
  fork(session: SessionHandle): Workflow<ForkData>;
  openFork(data: ForkData): Workflow<SessionHandle>;
};

// Resource helper — lowercase authored intrinsics
function useSession(config?: { model?: string }) {
  return resource<SessionHandle>(function* () {
    const handle = yield* CodeAgent().newSession(config ?? {});
    try {
      yield* provide(handle);
    } finally {
      yield* CodeAgent().closeSession(handle);
    }
  });
}

// Portable workflow — uses only contract-defined operations
// and contract-defined result fields
export function* refactor(input: { task: string }) {
  const session = yield* useSession();

  const analysis = yield* CodeAgent().prompt({
    session,
    prompt: `Analyze: ${input.task}`,
  });

  const impl = yield* CodeAgent().prompt({
    session,
    prompt: "Implement the changes you described.",
  });

  return { analysis: analysis.response, impl: impl.response };
}
```

## Appendix B: Worked Example — Backend Swap via Config

```typescript
// Config descriptor — lowercase config constructors
import { workflow, agent, transport } from "@tisyn/config";

// Codex backend
export default workflow({
  run: "refactor",
  agents: [
    agent("code-agent", transport.local("./codex-binding.ts")),
  ],
});
```

```typescript
// Same workflow, Claude Code backend — only the binding changes
import { workflow, agent, transport } from "@tisyn/config";

export default workflow({
  run: "refactor",
  agents: [
    agent("code-agent", transport.local("./claude-binding.ts")),
  ],
});
```

The workflow source is unchanged. Only the config descriptor
selects the backend.

## Appendix C: Worked Example — Profile-Coupled Workflow

```typescript
// Profile-coupled: uses Claude Code's 'plan' alias and
// reads the non-portable 'toolResults' extension field.
// This workflow is NOT portable to other adapters.

declare function ClaudeCode(): {
  newSession(config: { model: string }): Workflow<SessionHandle>;
  closeSession(handle: SessionHandle): Workflow<null>;
  plan(args: {
    session: SessionHandle;
    prompt: string;
  }): Workflow<PlanResult>;
  fork(session: SessionHandle): Workflow<ForkData>;
  openFork(data: ForkData): Workflow<SessionHandle>;
};

export function* analyze(input: { task: string }) {
  const session = yield* useSession();

  // 'plan' is a Claude Code alias for the contract's 'prompt'
  const result = yield* ClaudeCode().plan({
    session,
    prompt: input.task,
  });

  // 'toolResults' is a non-portable extension field
  const tools = result.toolResults ?? [];

  return { response: result.response, toolCount: tools.length };
}
```
