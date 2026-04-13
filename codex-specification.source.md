# Tisyn Codex Profile Specification

**Version:** 1.0.0
**Package:** `@tisyn/codex`
**Implements:** Tisyn Code Agent Specification v1.0.0
**Depends on:** Tisyn Transport Specification, Tisyn Protocol
Specification
**Status:** Draft

---

### Changelog

**v1.0.0** — Initial release. Defines the Codex adapter
profile under the `CodeAgent` contract: candidate conforming
SDK adapter path (pending validation), non-conforming exec
utility, validated backend facts, config fields, headless
constraints, provisional SDK operation mappings, and open
questions.

---

## 1. Overview

This specification defines the `@tisyn/codex` adapter
profile — a concrete implementation of the `CodeAgent`
contract for the OpenAI Codex CLI backend.

The profile specifies:

- which Codex integration paths conform to the `CodeAgent`
  contract and which do not
- Codex-specific configuration fields and accepted values
- headless constraint validation rules
- operation mapping guidance (provisional pending SDK
  validation)
- the non-conforming `codex exec` convenience utility

This profile is subordinate to the Tisyn Code Agent
Specification. It does not amend, extend, or override any
base contract semantics. Where this document is silent, the
base contract governs.

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY
are used as defined in RFC 2119.

---

## 2. Scope and Non-Goals

### 2.1 In Scope

- Codex-specific configuration fields and validation rules
- Conformance classification of Codex adapter paths
- Headless constraint values
- Validated Codex backend facts
- Provisional SDK operation mapping guidance
- Non-conforming exec utility documentation
- Profile-specific replay and stale-handle notes
- Profile-specific open questions

### 2.2 Non-Goals

- Base `CodeAgent` contract semantics (defined by the base
  contract specification)
- Kernel, compiler, IR, or config architecture changes
- Codex product documentation or user guide
- Codex internal architecture or tool-loop behavior
- ACP protocol translation (defined by the ACP adapter
  conformance test plan)
- Other adapter profiles (Claude Code, future adapters)
- Progress event schema normalization (the base contract
  does not normalize progress events)

---

## 3. Relationship to the Base Contract

This profile is subordinate to the Tisyn Code Agent
Specification v1.0.0. The relationship is governed by the
base contract's profile extension rules (§17.2):

1. **No operation aliases.** This profile uses the
   contract-defined operation names: `newSession`,
   `closeSession`, `prompt`, `fork`, `openFork`. No
   aliases are defined.

2. **No result field extensions.** This profile does not
   extend the base contract result types. `PromptResult`
   contains only `response: string`. Future profile
   versions MAY add Codex-specific extension fields if the
   backend provides structured metadata beyond response
   text; any such extension would follow the base
   contract's result extension rules (§6.4).

3. **Profile-specific configuration.** This profile defines
   Codex-specific configuration fields in the binding
   config type per base contract §17.2 rule 3.

All base contract conformance requirements (§8.1 checklist)
apply to any Codex adapter claiming conformance, without
waiver or weakening.

---

## 4. Validated Backend Facts

The following facts were observed in the Codex open-source
codebase (`github.com/openai/codex`, Apache 2.0) and its
published documentation at the time of this specification's
drafting.

**Evidence scope.** These facts are point-in-time
observations about an external product that evolves
independently of Tisyn. Sandbox mode names, approval policy
values, CLI flag syntax, and session persistence behavior
may change in future Codex releases. If upstream changes
invalidate any fact in this section, the affected subsection
MUST be updated before the profile claims relying on it are
used in conformance testing.

### 4.1 Product Identity

| Attribute | Value |
|---|---|
| Binary | `codex` |
| Source | `github.com/openai/codex` (Rust, Apache 2.0) |
| TypeScript SDK | `@openai/codex-sdk` (npm) |

### 4.2 Sandbox Modes

Three modes control filesystem access for spawned child
processes:

| Mode | Filesystem | Notes |
|---|---|---|
| `read-only` | No writes | Read-only access everywhere |
| `workspace-write` | CWD + /tmp writable | Default. `.git/` always read-only within writable roots |
| `danger-full-access` | Unrestricted | No filesystem restrictions |

Sandbox enforcement is OS-kernel-level. The adapter passes a
mode string; the backend enforces it. Enforcement mechanisms
are opaque to the profile.

### 4.3 Approval Policies

Four policies control the human-in-the-loop gate:

| Policy | Behavior |
|---|---|
| `untrusted` | Asks approval for nearly all actions |
| `on-failure` | Runs automatically, asks on failure |
| `on-request` | Runs autonomously within sandbox, asks only when agent requests |
| `never` | Runs everything without prompting |

The `--full-auto` CLI shortcut sets `on-request` +
`workspace-write`.

### 4.4 CLI Invocation Model

| Command | Behavior |
|---|---|
| `codex exec <prompt>` | Headless one-shot execution |
| `codex exec --json` | Headless, NDJSON event stream on stdout |
| `codex exec --ephemeral` | Skip session persistence |
| `codex resume <id>` | Resume a prior session |
| `codex resume --last` | Resume the most recent session |
| `codex fork <id>` | Branch from a prior session |
| `codex fork --last` | Branch from the most recent session |

### 4.5 Session Persistence

Sessions are persisted as zstd-compressed NDJSON rollout
files under `~/.codex/sessions/`. Sessions can be resumed
by ID or forked into new threads via the CLI.

### 4.6 Configuration

The Tisyn binding does not read Codex's own configuration
files. All configuration is passed through binding config
fields defined in §6.

---

## 5. Conformance Classification

### 5.1 Candidate Conforming Path: SDK Adapter

**Entry point:** `createSdkBinding(config?)`

**Conformance tier:** Core (candidate, pending SDK
validation).

**Basis:** The SDK adapter is designed to wrap the
`@openai/codex-sdk` TypeScript API. Based on the SDK's
documented thread API, the adapter is expected to maintain
conversation history across prompts within a thread,
satisfying the base contract's sequential-prompt requirement
(§10.2). However, this capability has not been verified
against the actual SDK. If the SDK does not maintain
per-thread conversation history, the adapter cannot conform
at any tier.

**Provisional status.** The core-tier conformance
classification is a design assessment, not a validated claim.
The exact SDK method signatures and thread lifecycle
semantics are unverified (§7). The conformance claim becomes
validated only after SDK integration testing resolves the
open questions in §11.

**Extended tier:** Unknown. Fork support depends on whether
the SDK exposes session forking or resume capabilities. If
the SDK does not support forking, the adapter MUST throw
`"NotSupported"` for `fork` and `openFork` per base contract
§8.2. The adapter MUST NOT fabricate fork semantics that the
backend does not support.

### 5.2 Non-Conforming Utility: Exec Adapter

**Entry point:** `createExecBinding(config?)`

**Conformance tier:** None.

The exec adapter spawns a new `codex exec --json` process
per `prompt` call. Each subprocess starts with no
conversation history. Sequential prompts on the same session
handle are independent — no context carries over. This
violates the base contract's sequential-prompt requirement
(§10.2).

The exec adapter is **NOT a conforming `CodeAgent` adapter**.

### 5.3 Classification Summary

| Path | Classification | Tier | Status |
|---|---|---|---|
| `createSdkBinding` | Candidate conforming | Core | Pending SDK validation |
| `createSdkBinding` | Unknown | Extended | Pending SDK validation |
| `createExecBinding` | Non-conforming | — | Final |

---

## 6. Binding Configuration

### 6.1 CodexSdkConfig

```typescript
interface CodexSdkConfig {
  model?: string;
  sandbox?: "read-only" | "workspace-write"
          | "danger-full-access";
  approval?: "on-request" | "never";
  cwd?: string;
  env?: Record<string, string>;
}
```

| Field | Default | Description |
|---|---|---|
| `model` | Codex CLI default | Model to use. Passed to the SDK |
| `sandbox` | `"workspace-write"` | Sandbox mode per §4.2 |
| `approval` | `"on-request"` | Approval policy. Headless-compatible values only (§8) |
| `cwd` | `process.cwd()` | Working directory for agent operations |
| `env` | (inherited) | Environment variables for the subprocess |

### 6.2 CodexExecConfig

```typescript
interface CodexExecConfig {
  command?: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write"
          | "danger-full-access";
  approval?: "on-request" | "never";
  cwd?: string;
  env?: Record<string, string>;
}
```

| Field | Default | Description |
|---|---|---|
| `command` | `"codex"` | Command to invoke |
| `model` | Codex CLI default | Model override |
| `sandbox` | `"workspace-write"` | Sandbox mode per §4.2 |
| `approval` | `"on-request"` | Approval policy |
| `cwd` | `process.cwd()` | Working directory |
| `env` | (inherited) | Environment variables |

### 6.3 Validation Rules

**CX-V-1. Approval policy.** The `approval` field MUST be
`"on-request"` or `"never"`. If `"untrusted"` or
`"on-failure"` is provided, the binding MUST throw a
descriptive error at creation time. This rule applies to
both `createSdkBinding` and `createExecBinding`.

**CX-V-2. Sandbox mode.** The `sandbox` field MUST be one
of `"read-only"`, `"workspace-write"`, or
`"danger-full-access"`. Any other value MUST cause a
descriptive error at binding creation.

**CX-V-3. Model string.** The `model` field, if provided,
MUST be a non-empty string.

**CX-V-4. Command string.** The `command` field in
`CodexExecConfig`, if provided, MUST be a non-empty string.

### 6.4 Configuration Placement

All fields in `CodexSdkConfig` and `CodexExecConfig` are
**binding config** per base contract §14.1. They are set
when the binding is created and apply to all operations in
that binding's lifetime. They are not workflow operation
parameters.

---

## 7. Operation Mappings

### 7.1 Normative Profile Obligations

The following obligations apply to any conforming Codex
adapter regardless of which SDK methods are used. They
restate or specialize base contract requirements for the
Codex profile and are not provisional.

**O-CX-1.** The adapter MUST generate adapter-internal
handles (e.g., `"cx-1"`, `"cx-2"`) per base contract §7.4.
The real Codex thread or session ID MUST NOT be exposed to
the workflow.

**O-CX-2.** The adapter MUST maintain conversation history
across sequential prompts on the same session handle per
base contract §10.2. If the underlying Codex integration
path cannot maintain history, the adapter does not conform.

**O-CX-3.** `closeSession` on a stale handle MUST return
`null` without error per base contract §9.1.

**O-CX-4.** `prompt` on a stale handle MUST fail with a
descriptive error per base contract §9.2.

**O-CX-5.** If the adapter does not support forking, `fork`
and `openFork` MUST throw with error name `"NotSupported"`
per base contract §8.2. The adapter MUST NOT fabricate fork
semantics that the backend does not support.

### 7.2 Validation Status

**All SDK mapping guidance in §7.3 is provisional
implementation guidance, not validated normative claims.**
The mappings reflect the expected `@openai/codex-sdk` API
surface. After SDK validation, §7.3 MUST be updated to
reflect verified mappings with their status changed to
"Validated."

The normative obligations in §7.1 are not affected by SDK
validation. They apply regardless of which SDK methods are
used.

### 7.3 SDK Adapter Mappings (Provisional)

**newSession**

| Attribute | Value |
|---|---|
| Contract op | `newSession` |
| Expected SDK approach | Create a thread via the SDK's thread API |
| Verified? | No |

**closeSession**

| Attribute | Value |
|---|---|
| Contract op | `closeSession` |
| Expected SDK approach | Release thread reference; remove from internal handle map |
| Verified? | No |

**prompt**

| Attribute | Value |
|---|---|
| Contract op | `prompt` |
| Expected SDK approach | Submit prompt to thread via SDK streaming API; collect streamed events; forward progress; return final response as `PromptResult.response` |
| Verified? | No |
| Notes | The SDK must maintain conversation history within the thread for the adapter to satisfy O-CX-2. If it does not, the SDK path cannot conform |

**fork**

| Attribute | Value |
|---|---|
| Contract op | `fork` |
| Expected SDK approach | Read the parent thread's session identifier; create `ForkData` with `parentSessionId` and `forkId` |
| Verified? | No |
| Notes | Whether the SDK exposes fork as a first-class operation is unknown (OQ-CX-3) |

**openFork**

| Attribute | Value |
|---|---|
| Contract op | `openFork` |
| Expected SDK approach | Resume the forked session as a new thread; allocate a new adapter handle |
| Verified? | No |
| Notes | Depends on SDK fork/resume support (OQ-CX-3) |

### 7.4 Exec Adapter Mappings (Final)

The exec adapter provides operation signatures for ergonomic
consistency but does not maintain real sessions.

| Contract Op | Exec Adapter Behavior |
|---|---|
| `newSession` | Generates adapter-internal handle. No real session created. No subprocess spawned |
| `closeSession` | Removes handle from internal map. No subprocess action. Returns `null` |
| `prompt` | Spawns `codex exec --json <prompt>`. Parses NDJSON events. Forwards intermediate events as progress. Returns final response as `PromptResult` |
| `fork` | Not supported. MUST throw with error name `"NotSupported"` |
| `openFork` | Not supported. MUST throw with error name `"NotSupported"` |

The exec adapter's `prompt` does not pass session handles to
the subprocess. Each invocation is independent. The adapter
does not claim or attempt conversation continuity.

---

## 8. Headless Constraints

### 8.1 Headless-Incompatible Approval Policies

The following approval policies require interactive human
input and MUST be rejected at binding creation time per
CX-V-1:

**`untrusted`.** Requires interactive approval for nearly
all tool actions. No mechanism exists to present approval
prompts in a headless durable workflow.

**`on-failure`.** Requires interactive approval when a
command fails. The same headless incompatibility applies.

### 8.2 Headless-Compatible Approval Policies

**`on-request`.** Runs autonomously within sandbox
boundaries. Asks only when the agent explicitly requests
input. In headless mode, such requests surface as errors
rather than interactive prompts. This is the recommended
headless policy.

**`never`.** Runs everything without prompting. Fully
headless-compatible.

### 8.3 Sandbox Compatibility

All three sandbox modes (`read-only`, `workspace-write`,
`danger-full-access`) are compatible with headless execution.
Sandbox mode controls filesystem access for the Codex
subprocess, not interactivity.

`workspace-write` is the recommended default for headless
workflows. `danger-full-access` SHOULD require explicit
opt-in in deployment configurations.

---

## 9. Non-Conforming Exec Utility

### 9.1 Purpose

The exec adapter wraps `codex exec --json` as a convenience
for workflows that need single-prompt Codex execution
without session management. Common use cases:

- CI pipeline steps that run a single code generation or
  review prompt
- Script automation where each prompt is self-contained
- Integration tests that verify Codex output without
  needing multi-turn conversation

### 9.2 Why It Is Non-Conforming

The exec adapter spawns a fresh Codex subprocess per
`prompt` call. Each subprocess begins with no conversation
history. The base contract requires that sequential prompts
on the same session add to the session's conversation
history (§10.2). The exec adapter cannot satisfy this
requirement.

A workflow that calls `prompt("analyze the code")` followed
by `prompt("now implement the changes you described")` will
fail semantically on the exec adapter: the second subprocess
has no knowledge of the first prompt's analysis. This is the
exact failure mode that the base contract's stale-session
rules are designed to prevent.

### 9.3 Permitted Use

The exec adapter MAY be used with workflows where every
prompt is independent. The binding MAY be created, sessions
MAY be opened, and prompts MAY be sent. The adapter returns
valid `PromptResult` values.

### 9.4 Prohibited Claims

The exec adapter MUST NOT:

- Be presented as satisfying the `CodeAgent` contract
- Appear in conformance test results for Suite A
- Be described as "conforming" in any documentation
- Be used as evidence that `@tisyn/codex` conforms to the
  base contract

Documentation MUST state clearly that `createExecBinding` is
a non-conforming convenience utility.

---

## 10. Replay and Stale-Handle Consequences

### 10.1 Base Contract Applies

All replay and stale-handle semantics from the base contract
(§9, §15) apply to the Codex adapter without modification.
This section notes Codex-profile implications only.

### 10.2 Session Non-Resumability (Default)

The SDK adapter does not persist handle-to-backend-ID
mappings across process restarts in the default
configuration. After process restart:

- All handles from the previous adapter instance are stale.
- `closeSession` on a stale handle returns `null` per base
  contract §9.1.
- `prompt` on a stale handle fails with a descriptive error
  per base contract §9.2.
- `fork` on a stale handle fails with a descriptive error
  per base contract §9.4.

### 10.3 Permitted Optimization: Session Resume

Codex persists sessions as compressed rollout files (§4.5).
An adapter implementation MAY persist the mapping between
adapter handles and Codex session IDs across process
restarts. If the adapter can verify with the Codex backend
that a session remains valid, it MAY successfully resolve
stale handles or stale `ForkData`.

This is a non-portable optimization per base contract §9.5.
Workflows MUST NOT depend on stale-session resume succeeding
for correctness.

**Status:** Whether Codex session resume is reliable enough
for this optimization is an open question (OQ-CX-2, §11).
The default adapter MUST NOT implement this optimization
until it is validated.

### 10.4 Exec Adapter

The exec adapter has no session state. Stale handles are
always unresolvable. `closeSession` on any handle returns
`null`. `prompt` on a stale handle fails. This is consistent
with the exec adapter's non-conforming status.

---

## 11. Profile-Specific Open Questions

**OQ-CX-1. SDK API verification.**

The `@openai/codex-sdk` method names, signatures, and thread
lifecycle semantics in §7.3 are unverified. Specific
questions:

- What is the exact method for creating a thread?
- Does the SDK maintain conversation history across prompts
  within a single thread? (Required for core-tier
  conformance.)
- Does the SDK expose session forking or resume? (Required
  for extended-tier conformance.)
- What is the streaming event shape?
- How does the SDK handle cancellation?

**Requires:** Prototype against the real `@openai/codex-sdk`
package.

**Blocks:** §7.3 status promotion from "Provisional" to
"Validated." Core-tier conformance claim finalization.

**OQ-CX-2. Session resume reliability.**

Can the adapter reliably persist handle-to-session-ID
mappings and resume Codex sessions after process restart
using the session rollout files? This determines whether the
§10.3 optimization is practical.

**Requires:** Prototype validation with Codex session
persistence.

**Blocks:** §10.3 optimization implementation.

**OQ-CX-3. Fork API shape.**

Does the Codex SDK separate fork-metadata creation from
session opening (two-step, matching the base contract's
`fork`/`openFork` model), or does it combine them? The
adapter must implement the two-step model regardless, but
the internal mapping depends on the SDK's API.

**Requires:** SDK API verification (part of OQ-CX-1).

**Blocks:** Extended-tier conformance determination.

**OQ-CX-4. Model identifier validation.**

What model identifiers does the Codex SDK accept? Are they
the same values as the CLI's `--model` flag? The binding
config's `model` field needs a validated set of accepted
values.

**Requires:** SDK documentation review.

**Blocks:** CX-V-3 tightening to enumerated values (if
warranted).

---

## 12. Progress Forwarding

### 12.1 SDK Adapter

The SDK adapter MUST forward events from the Codex SDK's
streaming response as `progressNotification` messages per
base contract §11.1. The progress token MUST be associated
with the in-flight `prompt` request.

The shape of progress events is Codex-specific and not
normalized by this profile or the base contract. Workflows
that observe progress events from a Codex adapter are
coupling to the Codex event schema and forfeit portability
of their progress-handling logic.

### 12.2 Exec Adapter

The exec adapter MUST parse NDJSON events from the
`codex exec --json` subprocess stdout and forward
intermediate events as `progressNotification` messages.
The final event in the NDJSON stream provides the text for
`PromptResult.response`.

---

## 13. Subprocess Diagnostics

### 13.1 SDK Adapter

If the Codex SDK's managed subprocess exits unexpectedly,
the adapter MUST surface a diagnostic error per base
contract §13.3. The diagnostic MUST include the exit code
or signal and any captured stderr content. The adapter MUST
NOT surface a generic "Transport closed" message when richer
diagnostics are available.

### 13.2 Exec Adapter

If a `codex exec` subprocess exits with a non-zero exit
code, the adapter MUST surface the exit code and any stderr
content in the error message.

---

## 14. Required Amendments and Companion Documents

### 14.1 Companion Documents

| Document | Status | Content |
|---|---|---|
| `tisyn-codex-test-plan.md` | To be written | Profile test plan covering CX-CONFORM, CX-NONCONF, CX-CFG, and CX-SDK test families |

### 14.2 Architecture Specification

The architecture specification's package map MUST be updated
to include `@tisyn/codex`. This amendment is shared with the
base contract adoption and is listed in the base contract's
§19.1.

### 14.3 Package Exports

The `@tisyn/codex` package MUST export:

| Export | Kind | Description |
|---|---|---|
| `createSdkBinding` | function | Candidate conforming SDK adapter (pending validation) |
| `createExecBinding` | function | Non-conforming exec utility |
| `CodexSdkConfig` | type | SDK adapter config |
| `CodexExecConfig` | type | Exec adapter config |

Contract types (`SessionHandle`, `PromptResult`, `ForkData`)
are imported from the shared `@tisyn/code-agent` package.
They MUST NOT be redefined in `@tisyn/codex`.

### 14.4 Package Dependencies

| Dependency | Purpose |
|---|---|
| `@openai/codex-sdk` | SDK adapter backend (SDK path only) |
| `@tisyn/code-agent` | Contract types |
| `@tisyn/agent` | Agent declaration utilities |
| `@tisyn/ir` | IR types |
| `@tisyn/protocol` | Protocol message constructors |
| `@tisyn/transport` | `LocalAgentBinding`, transport types |

---

## 15. Worked Examples

### 15.1 Conforming Binding Module

```typescript
// codex-binding.ts — conforming CodeAgent adapter
import { createSdkBinding } from "@tisyn/codex";
import type { LocalAgentBinding } from "@tisyn/transport";

export function createBinding(): LocalAgentBinding {
  return createSdkBinding({
    model: "gpt-5",
    sandbox: "workspace-write",
    approval: "on-request",
  });
}
```

### 15.2 Config Descriptor Using Codex

```typescript
// config.ts — lowercase config constructors
import { workflow, agent, transport } from "@tisyn/config";

export default workflow({
  run: "refactor",
  agents: [
    agent("code-agent", transport.local("./codex-binding.ts")),
  ],
});
```

The workflow source uses the portable `CodeAgent` contract.
Only the config descriptor and binding module are
Codex-specific.

### 15.3 Non-Conforming Exec Binding (CI Use)

```typescript
// codex-ci-binding.ts — non-conforming, single-prompt only
import { createExecBinding } from "@tisyn/codex";
import type { LocalAgentBinding } from "@tisyn/transport";

export function createBinding(): LocalAgentBinding {
  return createExecBinding({
    command: "codex",
    model: "gpt-5.4-mini",
    sandbox: "workspace-write",
    approval: "never",
  });
}
```

This binding is suitable for CI workflows where each prompt
is independent. It MUST NOT be used with workflows that
depend on sequential-prompt conversation continuity.

### 15.4 Headless Validation Failure

```typescript
import { createSdkBinding } from "@tisyn/codex";

// Throws at binding creation time per CX-V-1:
const binding = createSdkBinding({
  approval: "untrusted",
});
// Error: Approval policy "untrusted" is not compatible
// with headless execution. Use "on-request" or "never".
```
