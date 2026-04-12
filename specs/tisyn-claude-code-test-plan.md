# Tisyn Claude Code — Conformance Test Plan

**Version:** 0.1.0
**Tests:** Tisyn Claude Code Specification v0.1.0
**Status:** Draft

---

### Changelog

**v0.1.0** — Initial release. Covers 16 tests across the ACP
mock-transport integration path, the ACP real-subprocess
binding path, and the SDK mock-SDK path. Maps 1:1 to the
`it()` blocks in `packages/claude-code/src/claude-code.test.ts`.

---

### Coverage Summary

| Category | Tests |
|----------|-------|
| ACP Integration (mock transport) | 8 |
| ACP Binding Path (real subprocess) | 4 |
| SDK Adapter (mock SDK) | 4 |
| **Total** | **16** |

---

## 1. Scope

### 1.1 What This Plan Covers

- Both binding entry points (`createBinding`, `createSdkBinding`)
- All five declared agent operations (newSession, closeSession,
  plan, fork, openFork)
- Protocol translation correctness (ACP adapter)
- Parameter unwrapping (compiler envelope stripping)
- Progress forwarding (ProgressContext integration)
- Transport-level cancel handling
- Transport persistence across session lifecycle
- Subprocess diagnostic errors (ACP)
- SDK adapter-internal handle model

### 1.2 What This Plan Does Not Cover

- Authored workflow surface (not implemented)
- Compiler diagnostics (not implemented)
- Journal/replay semantics (not implemented)
- Real Claude Code backend integration (not a unit test
  concern)

### 1.3 Observability Model

All tests compare observable outputs only: returned values,
error messages, recorded calls, and progress events. Tests
do not assert on session IDs, process IDs, or internal adapter
state beyond what is observable through the public API.

## 2. Test Infrastructure

### 2.1 Mock Transport

`createMockClaudeCodeTransport(config)` from `mock.ts`.

Creates a mock `AgentTransportFactory` that simulates Claude
Code ACP behavior at the Tisyn protocol level. Routes execute
requests by operation name to per-operation configs.

**Per-operation config fields:**
- `result` — value to return on success
- `error` — `{ message, name? }` to return as an error
- `progress` — array of progress values to emit before result
- `delay` — milliseconds to wait before responding
- `neverComplete` — suspends indefinitely (for cancel tests)

Returns a `calls` array recording every execute request
received (operation name and args), so tests can assert on
what was dispatched.

The mock handles transport-level cancel messages by halting
the in-flight task for the canceled request ID.

### 2.2 Mock ACP Subprocess

`test-assets/mock-acp-server.ts` — a standalone NDJSON stdio
server used by the binding-path tests. Responds to ACP wire
methods (`session/new`, `session/prompt`, `session/close`,
`session/fork`) with deterministic results. Launched via
`npx tsx` as a real subprocess.

### 2.3 Mock SDK Session

`createMockSdkSession(initSessionId?)` — inline test helper.
Creates a mock SDK session object with:
- `send(msg)` — records sent messages
- `stream()` — yields messages from an enqueue-able queue
- `close()` — marks session as closed
- `sessionId` — getter that throws if not yet initialized

Supports scripted responses via `enqueue(msgs)` for precise
control of the SDK stream.

## 3. Test Matrix

### 3.1 Claude Code ACP Integration (mock transport)

Eight tests exercising declared operations and transport
behavior through the mock transport.

| ID | Test | Spec ref |
|----|------|----------|
| CC-T01 | newSession returns handle and closeSession dispatches on scope exit | §4.4, §4.5 |
| CC-T02 | plan call returns final result | §4.6 |
| CC-T03 | two sequential plan calls on same session both return results | §4.6 |
| CC-T04 | plan emits progress observable via ProgressContext | §7 |
| CC-T05 | fork returns ForkData and openFork returns child handle | §4.7, §4.8 |
| CC-T06 | plan error propagates to caller | §10 |
| CC-T07 | cancellation sends cancel notification to agent | §6.3 |
| CC-T08 | transport survives session close — second newSession works | §9.1 |

Note: CC-T07 tests transport-level cancel handling (§6.3),
not a declared operation. It verifies that halting a spawned
task triggers a `cancel` protocol message to the agent.

### 3.2 Claude Code ACP Binding Path (real subprocess)

Four tests exercising the real `createBinding` path with a
mock ACP subprocess.

| ID | Test | Spec ref |
|----|------|----------|
| CC-T09 | createBinding completes initialize handshake and dispatches newSession | §3.1, §6.1 |
| CC-T10 | adapter unwraps wrapped plan payload so ACP subprocess receives prompt at top level | §4.2 |
| CC-T11 | createBinding supports sequential operations through same subprocess | §9.1 |
| CC-T12 | surfaces subprocess diagnostic when ACP process exits immediately | §9.3 |

### 3.3 Claude Code SDK Adapter (mock SDK)

Four tests exercising the `createSdkBinding` path with a
mocked SDK.

| ID | Test | Spec ref |
|----|------|----------|
| CC-T13 | newSession returns adapter handle with cc- prefix | §8.1 |
| CC-T14 | two sequential plan calls reuse one SDK session | §4.6, §8.2 |
| CC-T15 | closeSession calls close() and invalidates handle | §4.5, §8.2 |
| CC-T16 | newSession → plan → fork → openFork lifecycle | §4.4, §4.6, §4.7, §4.8, §8 |

## 4. Coverage Gaps

The following behaviors are implemented but lack dedicated
test coverage. These are candidates for future test additions.

### 4.1 ACP Adapter Gaps

- `parseAcpMessage` validation paths: malformed JSON, missing
  `jsonrpc` field, response without `result` or `error`,
  invalid error structure
- Unknown operation error path (error message listing known
  operations)
- ACP notification routing: `request_id` vs `token`
  discrimination in progress token resolution

### 4.2 SDK Adapter Gaps

- Plan error path: stream result with
  `subtype !== "success"` constructing error from `errors`
  array
- Fork error when session `sessionId` not yet initialized
  (requires at least one `plan` call)
- Shutdown message closing all open sessions
- `permissionMode` config passthrough to
  `unstable_v2_createSession`
- Unknown operation error path

## 5. Acceptance Criteria

All 16 tests MUST pass:

```
pnpm --filter @tisyn/claude-code test
```

Formatting MUST pass:

```
pnpm run format:check
```
