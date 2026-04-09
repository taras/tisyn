# Tisyn Browser Contract Specification

**Version:** 0.3.0
**Implements:** Tisyn System Specification 1.0.0
**Depends on:** Tisyn Blocking Scope Specification 0.1.0,
Tisyn Scoped Effects Specification 0.1.0
**Status:** Draft

---

## 1. Overview

This specification defines the browser as a transport-bound
contract for authored Tisyn workflows. The browser contract
provides two host-visible operations:

- `Browser.navigate({ url })` — moves the browser's implicit
  current page to a URL.
- `Browser.execute({ workflow })` — sends IR into the browser
  execution environment for local execution.

Browser-local agents (like DOM interaction agents) are composed
at transport setup time via a first-class capability composition
interface owned by the transport. DOM operations and other
browser-local actions happen inside `execute`, not as separate
host-visible browser methods.

The target authored surface is:

```typescript
yield* scoped(function* () {
  yield* useTransport(Browser, browserTransport({
    capabilities: [domCapability()],
  }));

  const browser = yield* useAgent(Browser);
  yield* browser.navigate({ url: "https://example.com" });
  return yield* browser.execute({ workflow: someIr });
});
```

No live browser objects cross the workflow's durability boundary.
The host journal records one YieldEvent per `navigate` or
`execute` call. Inner sub-operations dispatched to browser-local
agents inside `execute` are NOT individually journaled at the
host level.

---

## 2. Normative References

- **Tisyn System Specification 1.0.0** — defines the IR
  evaluation model, scope semantics, and durable replay.
- **Tisyn Blocking Scope Specification 0.1.0** — defines
  how `scope` IR nodes bind agent transports.
- **Tisyn Scoped Effects Specification 0.1.0** — defines
  how effects are dispatched and journaled.

---

## 3. Terminology

- **Browser contract** — the `Browser` agent declaration with
  `navigate` and `execute` operations.
- **Cross-boundary operation** — an operation that crosses the
  host-to-browser boundary. Both `navigate` and `execute` are
  cross-boundary operations.
- **Implicit current page** — the single browser page owned by
  the transport. `navigate` changes its URL; `execute` runs IR
  against it. No page IDs or multi-page API in v1.
- **Navigate operation** — host-visible operation that moves the
  implicit current page to a URL via `page.goto()`.
- **Execute operation** — host-visible operation that sends IR
  into the browser for batched local execution.
- **Browser-local agent** — an agent whose handlers run inside
  the browser execution environment, not on the host.
- **LocalCapability** — a function that installs agent dispatch
  middleware into the current scope. The single composition
  interface for browser-local agents.
- **In-process mode** — execution mode where IR is executed
  directly in the host process with configured capabilities.
  Navigate is unsupported in this mode.
- **Real-browser mode** — execution mode where IR crosses the
  `page.evaluate` boundary into a Playwright-managed browser page.
  Both navigate and execute operate on the implicit current page.
- **Executor bundle** — an IIFE script built using
  `createBrowserExecutor()` that defines `window.__tisyn_execute`
  in the browser page.

---

## 4. Cross-Boundary Contract

### 4.1 Contract Operations

The browser contract exposes two host-visible operations:

```typescript
Browser.navigate({ url: string }): Workflow<void>
Browser.execute({ workflow: IrInput }): Workflow<Json>
```

**Navigate** moves the transport's implicit current page to the
given URL. It is a host-visible, transport-backed operation that
produces a YieldEvent in the host journal.

**Execute** sends IR into the browser for local execution against
the current page. Browser-local agents dispatched inside execute
are not individually host-journaled. The result is a single
JSON-serializable value.

### 4.2 Runtime Declaration

```typescript
export interface NavigateParams { url: string }
export interface ExecuteParams { workflow: IrInput }

export const Browser = agent("browser", {
  navigate: operation<NavigateParams, void>(),
  execute: operation<ExecuteParams, Json>(),
});
```

### 4.3 Authored Declaration

Workflows include an ambient declaration for compiler discovery:

```typescript
interface NavigateParams { url: string }
interface ExecuteParams { workflow: unknown }
declare function Browser(): {
  navigate(params: NavigateParams): Workflow<void>;
  execute(params: ExecuteParams): Workflow<unknown>;
};
```

The compiler discovers `Browser` via this `declare function`.
`toAgentId("Browser")` produces `"browser"`. Method calls lower
to `Eval("browser.navigate", ...)` and `Eval("browser.execute", ...)`
respectively. No browser-specific compiler rules exist.

---

## 5. Capability Composition

### 5.1 Composition Primitive

A `LocalCapability` is a function that installs agent dispatch
middleware into the current Effection scope:

```typescript
type LocalCapability = () => Operation<void>;
```

### 5.2 Constructor

`localCapability()` creates a `LocalCapability` from an agent
declaration and handlers:

```typescript
function localCapability<Ops>(
  declaration: AgentDeclaration<Ops>,
  handlers: ImplementationHandlers<Ops>,
): LocalCapability;
```

Internally: installs dispatch and resolve middleware via `Effects.around()`, equivalent to what `Agents.use(declaration, handlers)` does for local bindings.

### 5.3 Unified Model

The same `LocalCapability` objects are used in both execution
modes:

- **In-process:** passed to `browserTransport({ capabilities })`
- **Real-browser:** passed to `createBrowserExecutor(capabilities)`

The transport owns both APIs. The composition mechanism is
identical regardless of execution mode.

### 5.4 In-Page Executor

`createBrowserExecutor(capabilities)` is a transport-provided
public function that defines `window.__tisyn_execute` in the
browser page. Before each IR execution, it installs all
configured capabilities:

```typescript
function createBrowserExecutor(capabilities: LocalCapability[]): void;
```

Users import this from `@tisyn/transport/browser-executor` in
their executor script and bundle it into an IIFE for browser
injection.

---

## 6. Transport Factory

### 6.1 Configuration

```typescript
interface BrowserTransportConfig {
  headless?: boolean;
  viewport?: { width: number; height: number };
  engine?: "chromium" | "firefox" | "webkit";
  launchArgs?: string[];
  url?: string;
  capabilities?: LocalCapability[];
  executor?: string;
}
```

### 6.2 Execution Modes

**In-process mode** (`executor` omitted): the transport executes
IR locally in the host process using the standard runtime with
the configured capabilities. Each execute call creates a fresh
scoped environment, installs capabilities, and runs the IR.
Navigate is unsupported in this mode and throws an error:
`"Browser.navigate requires real-browser mode (provide executor config)"`.

**Real-browser mode** (`executor` provided): the transport
launches a Playwright browser, creates one browser context with
one implicit current page, and injects the executor IIFE.
Navigate calls `page.goto(url)` on the implicit current page.
Execute calls `page.evaluate(...)` to send IR into the injected
executor.

### 6.3 Transport Lifecycle

1. If `executor` provided: lazily load playwright-core
2. Launch Playwright browser
3. Create browser context + default page (implicit current page)
4. If `url` configured, navigate to it
5. Inject executor via `page.addScriptTag` and wait for
   `__tisyn_execute` availability
6. Register cleanup (`browser.close()`) on scope exit
7. Wire bidirectional channels + protocol server

Both `navigate` and `execute` operate on the same implicit
current page throughout the transport's lifetime.

### 6.4 Error Propagation

Navigate errors (e.g., network failures from `page.goto`)
propagate as thrown Errors.

If the executor returns `{ status: "error", error: { message } }`,
the transport throws an `Error` with the message. This applies
to both execution modes.

---

## 7. Replay Semantics

### 7.1 Host Journal

Each `Browser.navigate` and `Browser.execute` call produces one
`YieldEvent` in the host journal. Inner sub-operations dispatched
to browser-local agents inside `execute` are not individually
journaled at the host level.

### 7.2 Completed Scope Replay

When a completed scope is replayed, all `browser.navigate` and
`browser.execute` YieldEvents are served from the stored journal.
The transport is installed at scope entry but receives no dispatch
during replay. The scope completes with the same result.

### 7.3 Incomplete Scope Replay

When an incomplete scope is replayed, stored YieldEvents are
served from the journal up to the frontier. At the frontier,
the runtime transitions to live dispatch. The transport receives
the dispatch and executes against a fresh browser environment.

### 7.4 Deferred Requirements

The following are deferred to future versions:
- RP5: replay-time page-registry bookkeeping
- RP10: halt at frontier for incomplete replay
- RR20: page-registry consistency during replay
- RP9: mid-session crash recovery

---

## 8. Non-Goals (v1)

- Standardized Dom agent (Dom() is not part of the core contract)
- Built-in executor bundler
- Host callbacks from inside browser execution
- Multi-page management as cross-boundary operations
- Individual DOM operations (click, fill, etc.) as host-visible
  browser methods
- openPage, selectPage, closePage, screenshot

---

## 9. Exports

`@tisyn/transport/browser` exports:

| Export | Kind | Description |
|--------|------|-------------|
| `Browser` | `DeclaredAgent` | Runtime agent declaration |
| `browserTransport` | Function | Transport factory |
| `LocalCapability` | Type | Composition primitive |
| `localCapability` | Function | Capability constructor |
| `NavigateParams` | Interface | Navigate operation params |
| `ExecuteParams` | Interface | Execute operation params |
| `BrowserTransportConfig` | Interface | Factory configuration |

`@tisyn/transport/browser-executor` exports:

| Export | Kind | Description |
|--------|------|-------------|
| `createBrowserExecutor` | Function | In-page executor setup |
