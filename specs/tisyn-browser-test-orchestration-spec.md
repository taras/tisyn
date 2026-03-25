# Tisyn Browser Test Orchestration Specification

**Version:** 0.3.0
**Status:** Decision-Complete Draft
**Audience:** Engineers building browser-facing acceptance tests for the multi-agent-chat example

---

## 1. Overview

This document specifies how Tisyn-orchestrated acceptance tests drive real
browser UI against a real host process for the multi-agent-chat example.

Each acceptance test is a Tisyn workflow that coordinates two agents -- a Host
agent and a Browser agent -- while a runner owns all process lifecycle, browser
context creation, and readiness probing. Workflows assume the system is ready
and contain only scenario logic: user actions, assertions, and lifecycle
transitions (reload, restart).

---

## 2. Goals

- Prove Tisyn can orchestrate real end-to-end acceptance scenarios across
  process and browser boundaries.
- Express every scenario as a workflow that reads like a script: open, fill,
  click, assert, reload, assert.
- Keep all boot choreography and teardown in the runner, not in workflows.
- Ground every assertion in user-visible behavior using ARIA roles and labels.
- Provide per-test isolation: each test gets fresh processes, a fresh browser
  context, and a fresh temp directory.

---

## 3. Non-Goals

- Replacing the existing WebSocket-level e2e test in `test/e2e.test.ts`.
- Exposing Playwright APIs directly in workflow source.
- Using `data-testid` or any non-accessible selector.
- Modeling the entire test suite as a single workflow.
- Testing Tisyn internals through protocol-level message assertions.

---

## 4. Process and URL Model

### 4.1 Three Components Per Test

Every test run involves three components started by the runner:

| Component | What it is | How it starts | What it produces |
| --- | --- | --- | --- |
| **Host** | `tsx src/host.ts --journal <tempJournal>` | Spawned by runner via `child_process` with `PORT=0` | `wsUrl` parsed from stdout |
| **Reverse proxy** | Runner-owned Node HTTP+WS server | Created in-process by the runner | `appUrl` (the single URL the browser uses) |
| **Playwright context** | Isolated browser context | Created by the runner | Page for Browser agent |

The reverse proxy serves two purposes:

1. **Static files**: Serves the pre-built browser app from `browser/dist/`
   for HTTP requests. Falls back to `index.html` for SPA routing.
2. **WebSocket proxy**: Forwards WebSocket upgrade requests to the host's
   `wsUrl`.

This eliminates the need for a Vite preview server. The browser sees one
origin (`appUrl`) for both static assets and WebSocket connections. The
`useChat` hook's default URL (`ws://localhost:3000`) is never used in tests --
the hook derives the WS URL from `window.location.host`, which points at the
proxy.

### 4.2 Exact URLs

- **`wsUrl`**: The host's WebSocket endpoint (e.g. `ws://localhost:54321`).
  Internal to the runner and proxy. Not exposed to workflows.
- **`appUrl`**: The reverse proxy's HTTP endpoint (e.g. `http://localhost:54322`).
  This is the only URL the browser sees. Internal to the Browser agent
  implementation. Not exposed to workflows.

### 4.3 Why Not Vite Preview

Vite preview was considered but rejected because:

- Vite preview does not support runtime-configurable WebSocket proxying. The
  proxy target must be known at config load time, but the host port is dynamic.
- A runner-owned proxy is simpler: one in-process HTTP server with a WS
  forwarding handler. No child process management for the preview server.
- Restart scenarios (§6.2) require retargeting the proxy to a new host port.
  This is trivial with an in-process proxy and impossible with Vite preview
  without restarting it.

### 4.4 `useChat` URL Prerequisite

The `useChat` hook currently defaults to `ws://localhost:3000`. It must be
changed to derive the WebSocket URL from `window.location`:

```ts
// browser/src/useChat.ts
export function useChat(url = `ws://${window.location.host}`) {
```

With this change, the browser connects to the proxy's origin for WebSocket,
and the proxy forwards to the host. No build-time injection is needed.

---

## 5. `whenReady` -- Runner-Owned Readiness

### 5.1 Definition

`whenReady` is a runner-owned convergence check that resolves when BOTH:

1. A WebSocket handshake to the host's `wsUrl` succeeds (TCP connect +
   upgrade).
2. An HTTP GET to the proxy's `appUrl` returns status 200.

### 5.2 Implementation

`whenReady` is built on `@effectionx/converge`. It polls both conditions with
exponential backoff starting at 100ms. It resolves when both conditions are
simultaneously met.

```ts
import { converge } from "@effectionx/converge";

function* whenReady(wsUrl: string, appUrl: string): Operation<void> {
  yield* converge(function* () {
    const ws = new WebSocket(wsUrl);
    const opened = yield* raceTimeout(wsOpen(ws), 2000);
    ws.close();
    if (!opened) throw new Error("WebSocket not ready");

    const res = yield* call(() => fetch(appUrl));
    if (res.status !== 200) throw new Error("App not ready");
  });
}
```

### 5.3 Default Timeout

10 seconds. If either condition is not met within 10s, the test fails with a
clear error identifying which condition was not met.

### 5.4 Ownership

`whenReady` is called exclusively by the runner, never by workflows.
Workflows assume the system is ready when they begin executing.

### 5.5 Rejection: `waitUntilReady`

The v0.1.0 draft specified a `Host().waitUntilReady()` workflow operation.
This is rejected because readiness is a precondition of the test, not a
scenario step. The runner already knows both URLs and is the right place to
probe.

---

## 6. Host Agent

### 6.1 Contract

The Host agent provides lifecycle control over the host process. The runner
starts the host; the agent exposes only `stop` and `restart`.

```ts
Host().stop(input: {}): Workflow<void>

Host().restart(input: {
  journalPath?: string;
}): Workflow<void>
```

### 6.2 Semantics

**`stop({})`** -- Sends SIGTERM to the host process and waits for exit. After
`stop`, the host WebSocket endpoint is no longer available. The browser will
see a disconnection.

**`restart({ journalPath? })`** -- Performs these steps in order:

1. Sends SIGTERM to the current host process and waits for exit.
2. Spawns a new host process with `PORT=0` (and the same or overridden
   journal path).
3. Parses the new host port from stdout.
4. Retargets the runner's reverse proxy to forward WebSocket connections to
   the new host port.
5. Runs `whenReady` to confirm the new host is accepting connections.

`restart` returns `void` because the `appUrl` (proxy address) is unchanged.
The browser must be explicitly reloaded after restart because `useChat` does
not implement auto-reconnect. See §10.3 for the workflow pattern.

### 6.3 No `start`

There is no `Host().start()` operation. Starting the host is the runner's
responsibility. Workflows never need to call `start` because the runner
guarantees the host is running before the workflow begins.

---

## 7. Browser Agent

### 7.1 Contract

The Browser agent drives a real browser via Playwright. All operations target
the active page. The runner pre-creates a default page before the workflow
starts.

#### Navigation

```ts
Browser().open(input: {}): Workflow<void>
Browser().reload(input: {}): Workflow<void>
Browser().close(input: {}): Workflow<void>
```

**`open({})`** -- Navigates the active page to `appUrl`. The URL is not a
workflow parameter; it is known to the Browser agent implementation (provided
by the runner at install time).

**`reload({})`** -- Calls `page.reload()` and waits for load.

**`close({})`** -- Closes the active page.

#### Sessions

Sessions allow workflows to simulate multiple independent browser connections.
Each session is a separate Playwright `BrowserContext` (not just a separate
page) because `localStorage` is shared per origin within a context, and each
session must generate its own `clientSessionId`.

```ts
Browser().openSession(input: {
  sessionId: string;
}): Workflow<void>

Browser().switchSession(input: {
  sessionId: string;
}): Workflow<void>

Browser().closeSession(input: {
  sessionId: string;
}): Workflow<void>
```

**`openSession({ sessionId })`** -- Creates a new `BrowserContext`, creates a
page in it, navigates to `appUrl`, and makes it the active page. Subsequent
operations target this session until `switchSession` is called.

**`switchSession({ sessionId })`** -- Changes the active page to the one
belonging to the named session. The session `"default"` refers to the
runner-created initial context.

**`closeSession({ sessionId })`** -- Closes the page and `BrowserContext` for
the named session.

#### Input

```ts
Browser().fill(input: {
  name: string;
  value: string;
}): Workflow<void>

Browser().click(input: {
  role: string;
  name: string;
}): Workflow<void>

Browser().pressKey(input: {
  key: string;
}): Workflow<void>
```

**`fill({ name, value })`** -- `page.getByRole("textbox", { name }).fill(value)`.

**`click({ role, name })`** -- `page.getByRole(role, { name }).click()`.

**`pressKey({ key })`** -- `page.keyboard.press(key)`.

#### Assertions

```ts
Browser().expectVisible(input: { text: string }): Workflow<void>
Browser().expectNotVisible(input: { text: string }): Workflow<void>
Browser().expectDisabled(input: { role: string; name: string }): Workflow<void>
Browser().expectEnabled(input: { role: string; name: string }): Workflow<void>
Browser().expectTranscript(input: { messages: string[] }): Workflow<void>
Browser().expectStatusText(input: { text: string }): Workflow<void>
```

### 7.2 Assertion Semantics

All assertion operations use Playwright's built-in auto-retry mechanism so
that timing-sensitive checks converge naturally without explicit waits or
sleeps in the workflow. Default auto-retry timeout: 5 seconds.

**`expectVisible({ text })`** -- `expect(page.getByText(text)).toBeVisible()`.

**`expectNotVisible({ text })`** -- `expect(page.getByText(text)).not.toBeVisible()`.

**`expectDisabled({ role, name })`** -- `expect(page.getByRole(role, { name })).toBeDisabled()`.

**`expectEnabled({ role, name })`** -- `expect(page.getByRole(role, { name })).toBeEnabled()`.

**`expectTranscript({ messages })`** -- Asserts that the transcript region
contains exactly the given messages in order. This is the ONE operation that
encapsulates DOM structure knowledge. Implementation:

```ts
async function expectTranscript(page: Page, messages: string[]) {
  const log = page.getByRole("log");
  const items = log.locator(".message");
  await expect(items).toHaveCount(messages.length);
  for (let i = 0; i < messages.length; i++) {
    await expect(items.nth(i)).toHaveText(messages[i]);
  }
}
```

If the transcript DOM changes, only this function needs updating.

**`expectStatusText({ text })`** -- `expect(page.getByRole("status")).toHaveText(text)`.

---

## 8. Selector Policy

### 8.1 Principle

All selectors MUST use ARIA roles, accessible names, and visible text.
No `data-testid`. No CSS class selectors. No DOM structure assumptions
outside of `expectTranscript`.

### 8.2 Required UI Changes (Prerequisites)

The following accessibility improvements must be made before the first browser
test can run. These are legitimate accessibility improvements, not test hooks.

#### MessageInput.tsx

Add `aria-label="Message"` to the `<input>`:

```tsx
<input
  ref={inputRef}
  className="message-input"
  type="text"
  aria-label="Message"
  placeholder="Type a message..."
  ...
/>
```

Enables `page.getByRole("textbox", { name: "Message" })`.

#### Transcript.tsx

Add `role="log"` to the transcript container:

```tsx
<div className="transcript" role="log" ref={ref}>
```

Enables `page.getByRole("log")` for transcript assertions. The `log` role is
semantically correct for a region where new information is added in order.

#### StatusBanner.tsx

Add `role="status"` to the status container:

```tsx
<div className={`status ${level}`} role="status">{text}</div>
```

Enables `page.getByRole("status")` for status assertions. The `status` role
is semantically correct for advisory live-region content.

---

## 9. Runner

### 9.1 Framework

Tests run under **Vitest** with `@effectionx/vitest` for structured
concurrency integration, matching the existing test setup.

### 9.2 `runScenario()` Helper

All test boilerplate is encapsulated in `runScenario()`:

```ts
import { describe, it } from "@effectionx/vitest";
import { runScenario } from "./helpers/scenario.js";
import * as workflows from "./workflows.generated.js";

describe("Browser acceptance", () => {
  it("basic send and receive", function* () {
    yield* runScenario(workflows.basicSendReceive);
  });

  it("transcript restores after reload", function* () {
    yield* runScenario(workflows.transcriptRestoresAfterReload);
  });

  it("host restart preserves state", function* () {
    yield* runScenario(workflows.hostRestartPreservesState);
  });

  it("second browser is read-only", function* () {
    yield* runScenario(workflows.secondBrowserIsReadOnly);
  });
});
```

### 9.3 `runScenario` Internals

`runScenario(workflow)` performs these steps in order:

1. **Create temp directory** -- `mkdtemp` for the journal file.

2. **Build browser app** -- Run `vite build` (once, cached across tests via
   a `beforeAll` or pretest script). Reuse the `browser/dist/` output.

3. **Start host process** -- Spawn `tsx src/host.ts --journal <tempJournal>`
   with `PORT=0`. Parse the actual port from stdout (see §12.2).

4. **Start reverse proxy** -- Create an in-process HTTP server that serves
   `browser/dist/` for HTTP requests and proxies WebSocket upgrades to the
   host. Bind to port 0. Record `appUrl`.

5. **`whenReady`** -- Converge on both the host's `wsUrl` and the proxy's
   `appUrl` being reachable. Timeout 10s.

6. **Create Playwright browser context** -- Launch or reuse a shared browser
   instance. Create an isolated `BrowserContext` and a default page.

7. **Install agents** -- Install the Host agent (backed by the child process
   handle, proxy retarget function, and journal path) and the Browser agent
   (backed by the Playwright context and `appUrl`).

8. **Execute workflow** -- `yield* execute({ ir: Call(workflow) })`.

9. **Teardown (finally block)** -- In reverse order:
   - Close all Playwright browser contexts
   - Close reverse proxy server
   - Kill host process (SIGTERM, then SIGKILL after 5s)
   - Remove temp directory

All teardown runs in a `finally` block regardless of pass/fail.

### 9.4 Per-Test Isolation

Each call to `runScenario` gets:

- A fresh temp directory and journal file
- A fresh host process on a random port
- A fresh reverse proxy on a random port
- A fresh Playwright `BrowserContext` (isolated cookies, localStorage)

Tests MAY run in parallel because all ports are OS-assigned and all state is
per-test.

### 9.5 Browser Build Caching

`vite build` is expensive. The runner SHOULD run it once before all tests
(e.g. in the pretest script) and reuse the `browser/dist/` output.

---

## 10. Workflow Examples

### 10.1 Actual Status Text Reference

The `useChat` hook renders these status texts based on host messages. All
`expectStatusText` assertions in workflows must match one of these:

| Host message | Rendered status text | Input enabled |
| --- | --- | --- |
| (initial, before WS open) | `"Disconnected"` | no |
| (WS open, before first host message) | `"Connected — waiting for host..."` | no |
| `hydrateTranscript` | `"Transcript restored"` | no (transient) |
| `waitForUser` with prompt `"Say something"` | `"Say something"` | yes |
| `assistantMessage` | `"Waiting for assistant..."` | no |
| `setReadOnly` with reason R | R (verbatim) | no |
| (WS close) | `"Disconnected"` | no |

On owner reconnect (reload), the host sends `hydrateTranscript` immediately
followed by `waitForUser`. The status transitions from `"Transcript restored"`
to `"Say something"`. Because `"Transcript restored"` is transient, workflows
SHOULD assert `"Say something"` as the stable post-reconnect state.

### 10.2 `basicSendReceive`

```ts
export function* basicSendReceive() {
  yield* Browser().open({});
  yield* Browser().expectVisible({ text: "Multi-Agent Chat" });
  yield* Browser().expectStatusText({ text: "Say something" });

  yield* Browser().fill({ name: "Message", value: "hello" });
  yield* Browser().click({ role: "button", name: "Send" });

  yield* Browser().expectVisible({ text: "Echo: hello" });
  yield* Browser().expectTranscript({
    messages: ["You: hello", "Assistant: Echo: hello"],
  });
}
```

### 10.3 `transcriptRestoresAfterReload`

Verifies that reloading the browser restores the conversation from the host's
in-memory state via `hydrateTranscript`.

```ts
export function* transcriptRestoresAfterReload() {
  yield* Browser().open({});
  yield* Browser().expectStatusText({ text: "Say something" });

  yield* Browser().fill({ name: "Message", value: "hello" });
  yield* Browser().click({ role: "button", name: "Send" });
  yield* Browser().expectVisible({ text: "Echo: hello" });

  yield* Browser().fill({ name: "Message", value: "world" });
  yield* Browser().click({ role: "button", name: "Send" });
  yield* Browser().expectVisible({ text: "Echo: world" });

  yield* Browser().reload({});

  yield* Browser().expectTranscript({
    messages: [
      "You: hello",
      "Assistant: Echo: hello",
      "You: world",
      "Assistant: Echo: world",
    ],
  });
  yield* Browser().expectStatusText({ text: "Say something" });
}
```

### 10.4 `hostRestartPreservesState`

Verifies that stopping and restarting the host with journaling preserves the
full conversation state. After restart, the browser must be explicitly
reloaded because `useChat` does not implement auto-reconnect.

```ts
export function* hostRestartPreservesState() {
  yield* Browser().open({});
  yield* Browser().expectStatusText({ text: "Say something" });

  yield* Browser().fill({ name: "Message", value: "before restart" });
  yield* Browser().click({ role: "button", name: "Send" });
  yield* Browser().expectVisible({ text: "Echo: before restart" });

  // Host dies — browser sees disconnection
  yield* Host().restart({});
  yield* Browser().expectStatusText({ text: "Disconnected" });

  // Reload to reconnect through the proxy (now targeting new host)
  yield* Browser().reload({});

  // Transcript restored from journal replay
  yield* Browser().expectTranscript({
    messages: [
      "You: before restart",
      "Assistant: Echo: before restart",
    ],
  });
  yield* Browser().expectStatusText({ text: "Say something" });

  // Verify the workflow can continue after restart
  yield* Browser().fill({ name: "Message", value: "after restart" });
  yield* Browser().click({ role: "button", name: "Send" });
  yield* Browser().expectVisible({ text: "Echo: after restart" });
}
```

### 10.5 `secondBrowserIsReadOnly`

Verifies that when a second browser session connects, it receives the
transcript but is set to read-only mode. The second session uses a separate
`BrowserContext` so it gets its own `clientSessionId` in `localStorage`.

```ts
export function* secondBrowserIsReadOnly() {
  yield* Browser().open({});
  yield* Browser().expectStatusText({ text: "Say something" });

  yield* Browser().fill({ name: "Message", value: "hello" });
  yield* Browser().click({ role: "button", name: "Send" });
  yield* Browser().expectVisible({ text: "Echo: hello" });

  // Open a second browser (separate BrowserContext = separate clientSessionId)
  yield* Browser().openSession({ sessionId: "second" });

  // Second session gets read-only view
  yield* Browser().expectStatusText({ text: "Session owned by another browser" });
  yield* Browser().expectDisabled({ role: "textbox", name: "Message" });
  yield* Browser().expectDisabled({ role: "button", name: "Send" });

  // Second session has the transcript
  yield* Browser().expectTranscript({
    messages: ["You: hello", "Assistant: Echo: hello"],
  });

  // Switch back to first session and verify it still works
  yield* Browser().switchSession({ sessionId: "default" });
  yield* Browser().expectEnabled({ role: "textbox", name: "Message" });

  yield* Browser().closeSession({ sessionId: "second" });
}
```

### 10.6 Failure Semantics

A workflow fails if any agent operation throws. Assertion operations throw
on Playwright auto-retry timeout. Input operations throw if the target
element is not found. Failures propagate as workflow errors; the runner
catches them and reports them as test failures to Vitest.

### 10.7 Cleanup

The runner owns cleanup, not the workflow. Workflows do not need explicit
teardown steps. The runner's `finally` block (§9.3 step 9) handles all
resource cleanup.

---

## 11. Assertion Model

### 11.1 Auto-Retry via Playwright

All `expect*` operations delegate to Playwright's auto-retrying assertions:

- No `sleep()` or `waitFor()` calls in workflows.
- Playwright retries for up to 5 seconds before failing.
- This naturally handles async rendering, WebSocket delivery delays, and
  React state updates.

### 11.2 `expectTranscript` Encapsulation

`expectTranscript` is the single operation that encapsulates DOM structure
knowledge. Its implementation locates the transcript container via
`page.getByRole("log")`, collects `.message` child elements, and compares
their text content against the expected array. If the DOM structure changes,
only this function needs updating.

### 11.3 What Assertions Must NOT Do

- Inspect WebSocket message payloads.
- Read internal React state.
- Query by `data-testid` or CSS class (except inside `expectTranscript`).
- Assert against DOM element counts outside of `expectTranscript`.

---

## 12. Prerequisites

The following changes MUST be completed before the first browser test can run.

### 12.1 UI Accessibility Improvements

| File | Change | Rationale |
| --- | --- | --- |
| `browser/src/components/MessageInput.tsx` | Add `aria-label="Message"` to `<input>` | Enables `getByRole("textbox", { name: "Message" })` |
| `browser/src/components/Transcript.tsx` | Add `role="log"` to transcript `<div>` | Enables `getByRole("log")` for transcript assertions |
| `browser/src/components/StatusBanner.tsx` | Add `role="status"` to status `<div>` | Enables `getByRole("status")` for status assertions |

### 12.2 Dynamic Host Port

`src/browser-transport.ts` currently hardcodes port 3000. It must accept a
port parameter (default 3000 for dev, 0 for tests). The host must print the
actual bound port to stdout in a parseable format:

```
TISYN_HOST_READY port=54321
```

The runner parses this line to construct `wsUrl`.

### 12.3 `useChat` URL Derivation

`browser/src/useChat.ts` must derive the WebSocket URL from
`window.location` instead of hardcoding `ws://localhost:3000`:

```ts
export function useChat(url = `ws://${window.location.host}`) {
```

### 12.4 New Dependencies

| Package | Purpose |
| --- | --- |
| `playwright` | Browser automation library API |
| `@playwright/test` | Playwright assertion library (`expect`) |
| `@effectionx/converge` | Convergence-based readiness polling |

Added as `devDependencies` of `@tisyn/example-multi-agent-chat`.

### 12.5 Test Infrastructure Files

| File | Purpose |
| --- | --- |
| `test/browser/helpers/scenario.ts` | `runScenario()` — lifecycle, proxy, agents |
| `test/browser/helpers/host-agent.ts` | Host agent implementation (process control) |
| `test/browser/helpers/browser-agent.ts` | Browser agent implementation (Playwright) |
| `test/browser/helpers/when-ready.ts` | `whenReady` convergence check |
| `test/browser/helpers/proxy.ts` | Reverse proxy (static files + WS forwarding) |
| `test/browser/workflows/*.workflow.ts` | Workflow source files |
| `test/browser/build-test-workflows.ts` | Compiler script |
| `test/browser/acceptance.test.ts` | Vitest test file |

---

## 13. Layer Responsibilities

| Layer | Owns | Must Not |
| --- | --- | --- |
| **Workflow** | Scenario sequencing: open, fill, click, assert, reload, restart | Call `whenReady`, manage processes, reference Playwright APIs, know URLs |
| **Host Agent** | `stop` and `restart` of the host process | Define scenario policy or assertion logic |
| **Browser Agent** | Playwright page interaction and assertion, `appUrl` knowledge | Expose Playwright types to workflow code |
| **Runner (`runScenario`)** | Temp dir, process spawn, reverse proxy, `whenReady`, Playwright context, agent install, teardown | Contain scenario logic |

---

## 14. Failure Semantics

### 14.1 Workflow Assertion Failure

If any `expect*` operation fails (Playwright assertion timeout), the workflow
throws. The runner catches this, runs teardown, and reports the test as failed
to Vitest.

### 14.2 Process Failure

If the host process exits unexpectedly, the Browser agent's next operation
will fail (e.g. WebSocket disconnect causes status text change to
`"Disconnected"`, and a subsequent `expectStatusText({ text: "Say something" })`
times out). The runner's teardown still runs.

### 14.3 `whenReady` Timeout

If `whenReady` times out (10s), `runScenario` throws before the workflow
starts. The test fails with a message identifying which condition was not met.

---

## 15. Recovery-Oriented Scenarios

This testing architecture specifically targets scenarios where page-only
testing is insufficient:

- **Transcript restores after reload** -- requires browser reload and
  WebSocket reconnection.
- **Host restart preserves state** -- requires process kill, re-spawn, journal
  replay, proxy retarget, browser reload, and transcript restoration.
- **Second browser is read-only** -- requires multiple browser contexts
  connecting to the same host, with ownership semantics.
- **Reconnect resumes pending prompt** -- requires WebSocket disconnect/
  reconnect while the workflow is blocked on `waitForUser`.

---

## 16. Rejected Alternatives

### 16.1 `waitUntilReady` as a Workflow Operation

**Rejected.** Readiness is a precondition, not a scenario step. Every
workflow would repeat the same boilerplate. `whenReady` is runner-owned and
based on `@effectionx/converge`.

### 16.2 Single `baseUrl`

**Rejected.** The system has two independent endpoints (`wsUrl` for the host,
`appUrl` for the proxy). Collapsing them hides the proxy architecture.

### 16.3 `data-testid` Selectors

**Rejected.** The required ARIA additions (§8.2) are genuine accessibility
improvements that benefit all users.

### 16.4 Shared Browser Contexts

**Rejected.** `localStorage`-based session identity means shared contexts
would leak `clientSessionId` between tests.

### 16.5 `Host().start()` as a Workflow Operation

**Rejected.** Starting the host is infrastructure, not scenario logic.

### 16.6 Vite Preview as Transport

**Rejected.** Vite preview does not support runtime-configurable WebSocket
proxying. The host port is dynamic per test, and restart scenarios require
retargeting the proxy without restarting the preview server. A runner-owned
reverse proxy is simpler and supports all scenarios.

### 16.7 `VITE_WS_URL` Injection

**Rejected.** Build-time URL injection would require rebuilding the browser
app per test (or per host port). The reverse proxy approach avoids this
entirely.

---

## 17. Rationale

This model is preferable to the existing WebSocket-level e2e test for
acceptance testing because it validates what the demo actually promises:

- A real host process runs and serves WebSocket connections.
- A real browser app renders and responds to user interaction.
- User-visible behavior works correctly across process restarts, page reloads,
  and multi-session scenarios.
- Durable journaling and replay are observable through the UI.

The WebSocket-level test remains valuable for fast protocol-correctness
feedback. The browser tests add coverage for the full vertical slice from
user interaction to workflow execution and back.
