# Tisyn Browser Contract Specification

**Version:** 0.2.0
**Implements:** Tisyn System Specification 1.0.0
**Depends on:** Tisyn Blocking Scope Specification 0.1.0,
Tisyn Scoped Effects Specification 0.1.0
**Status:** Draft

---

## 1. Overview

This specification defines the browser as a transport-bound
contract for authored Tisyn workflows. The browser contract
provides a single cross-boundary operation — `Browser.execute`
— that sends IR into a browser execution environment for local
execution. Browser-local agents (like DOM interaction agents)
are composed at transport setup time via a first-class capability
composition interface owned by the transport.

The target authored surface is:

```typescript
yield* scoped(function* () {
  yield* useTransport(Browser, browserTransport({
    capabilities: [domCapability()],
  }));

  const browser = yield* useAgent(Browser);
  return yield* browser.execute({ workflow: someIr });
});
```

No live browser objects cross the workflow's durability
boundary. The host journal records one `browser.execute`
YieldEvent per call. Inner sub-operations dispatched to
browser-local agents are NOT individually journaled at the
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
  a single `execute` operation.
- **Cross-boundary operation** — an operation that crosses the
  host-to-browser boundary.
- **Browser-local agent** — an agent whose handlers run inside
  the browser execution environment, not on the host.
- **LocalCapability** — a function that installs agent dispatch
  middleware into the current scope. The single composition
  interface for browser-local agents.
- **In-process mode** — execution mode where IR is executed
  directly in the host process with configured capabilities.
- **Real-browser mode** — execution mode where IR crosses the
  `page.evaluate` boundary into a Playwright-managed browser page.
- **Executor bundle** — an IIFE script built using
  `createBrowserExecutor()` that defines `window.__tisyn_execute`
  in the browser page.

---

## 4. Cross-Boundary Contract

### 4.1 Single Operation

The browser contract exposes exactly one host-visible operation:

```typescript
Browser.execute({ workflow: IrInput }): Workflow<Json>
```

Where:
- `IrInput` — the IR expression to execute in the browser
  environment.
- `Json` — the serializable return value.

### 4.2 Runtime Declaration

```typescript
export const Browser = agent("browser", {
  execute: operation<ExecuteParams, Json>(),
});
```

### 4.3 Authored Declaration

Workflows include an ambient declaration for compiler discovery:

```typescript
interface ExecuteParams { workflow: unknown }
declare function Browser(): {
  execute(params: ExecuteParams): Workflow<unknown>;
};
```

The compiler discovers `Browser` via this `declare function`.
`toAgentId("Browser")` produces `"browser"`. Method calls lower
to `Eval("browser.execute", ...)`. No browser-specific compiler
rules exist.

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

Internally: `implementAgent(declaration, handlers).install()`.

### 5.3 Unified Model

The same `LocalCapability` objects are used in both execution
modes:

- **In-process:** passed to `browserTransport({ capabilities })`
- **Real-browser:** passed to `createBrowserExecutor(capabilities)`

The transport owns both APIs. The composition mechanism is
identical regardless of execution mode.

### 5.4 In-Page Executor

`createBrowserExecutor(capabilities)` is a transport-provided
function that defines `window.__tisyn_execute` in the browser
page. Before each IR execution, it installs all configured
capabilities:

```typescript
function createBrowserExecutor(capabilities: LocalCapability[]): void;
```

Users import this in their executor script and bundle it into
an IIFE for browser injection.

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

**In-process mode** (`executor` omitted): the transport
executes IR directly using `@tisyn/runtime` with the configured
capabilities. Each execute call creates a fresh scoped
environment, installs capabilities, and runs the IR.

**Real-browser mode** (`executor` provided): the transport
injects the executor IIFE into a Playwright page and sends IR
via `page.evaluate`. The executor bundle must be built using
`createBrowserExecutor()` with the desired capabilities.

### 6.3 Transport Lifecycle

1. Launch Playwright browser
2. Create browser context + default page
3. If `url` configured, navigate to it
4. If `executor` provided, inject via `page.addScriptTag`
   and wait for `__tisyn_execute` availability
5. Register cleanup (`browser.close()`) on scope exit
6. Wire bidirectional channels + protocol server

### 6.4 Error Propagation

If the executor returns `{ status: "err", error: { message } }`,
the transport throws an `Error` with the message. This applies
to both execution modes.

---

## 7. Replay Semantics

### 7.1 Host Journal

Each `Browser.execute` call produces one `YieldEvent` in the
host journal. Inner sub-operations dispatched to browser-local
agents are not individually journaled at the host level.

### 7.2 Completed Scope Replay

When a completed scope is replayed, all `browser.execute`
YieldEvents are served from the stored journal. The transport
is installed at scope entry but receives no dispatch during
replay. The scope completes with the same result.

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
- Individual browser operations (navigate, click, fill, etc.)
  as host-visible effects

---

## 9. Exports

`@tisyn/transport/browser` exports:

| Export | Kind | Description |
|--------|------|-------------|
| `Browser` | `DeclaredAgent` | Runtime agent declaration |
| `browserTransport` | Function | Transport factory |
| `LocalCapability` | Type | Composition primitive |
| `localCapability` | Function | Capability constructor |
| `createBrowserExecutor` | Function | In-page executor setup |
| `ExecuteParams` | Interface | Execute operation params |
| `BrowserTransportConfig` | Interface | Factory configuration |
