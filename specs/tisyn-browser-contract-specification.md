# Tisyn Browser Contract Specification

**Version:** 0.1.0
**Implements:** Tisyn System Specification 1.0.0
**Depends on:** Tisyn Blocking Scope Specification 0.1.0,
Tisyn Scoped Effects Specification 0.1.0
**Status:** Draft

---

## 1. Overview

This specification defines the browser as a transport-bound
contract for authored Tisyn workflows. A workflow that needs
browser-backed delegated work binds a browser contract in a
scope via `useTransport`, acquires a handle via `useAgent`,
and issues browser commands as ordinary durable external
effects. All live Playwright state remains in runtime/transport
ownership. No live browser objects cross the workflow's
durability boundary.

The target authored surface is:

````typescript
yield* scoped(function* () {
  yield* useTransport(Browser, browserTransport({
    headless: false,
    viewport: { width: 1280, height: 720 },
  }));

  const browser = yield* useAgent(Browser);

  yield* browser.navigate("https://example.com");
  const content = yield* browser.content();
  const analysis = yield* llm.sample({ prompt: content });
  yield* browser.click({ selector: analysis.nextSelector });
});
````

The browser contract introduces no new IR forms, no new kernel
evaluation rules, no new journal event types, and no new
runtime lifecycle phases. It is an application of the existing
scoped transport binding model to the browser domain.

### 1.1 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are
used as defined in RFC 2119.

### 1.2 Normative Scope

This specification covers:

- the browser transport factory: shape, semantics, and
  lifecycle rules
- the browser contract: required operations, input/output
  shapes, and error conditions
- page identity model for multi-page support
- compiler obligations for the browser contract
- runtime obligations for browser transport lifecycle
- replay semantics for browser-scoped workflows

This specification does NOT cover:

- Playwright API internals or transport implementation details
- browser transport wire protocol
- agent protocol extensions for browser-specific streaming
  or events
- session management across WebSocket reconnections
- browser pool or dynamic-count browser management

### 1.3 Design Decisions (Non-Normative)

> The following decisions are already settled and are not
> reopened by this specification:
>
> - The browser is a transport-bound contract, not a
>   workflow-visible resource or capability token.
> - Browser operations are ordinary durable external effects.
>   No volatile or non-journaled effect class is introduced.
> - Live Playwright state (browser instances, pages, contexts)
>   MUST NOT appear as workflow values.
> - The existing two-event journal algebra
>   (`YieldEvent | CloseEvent`) is not widened.
> - `useAgent(Browser)` follows existing compile-time erasure
>   semantics. No runtime handle value is produced.
> - `browserTransport(config)` returns an `AgentTransportFactory`,
>   following the same factory pattern as all existing transports
>   (stdio, websocket, worker, inprocess). No pure-data
>   descriptor model is used. No transport resolver registry
>   is needed.

---

## 2. Normative Scope

### 2.1 What This Specification Defines

This specification defines the normative contract between
authored workflows and the browser transport. An authored
workflow that conforms to this specification can issue browser
commands through a scoped transport binding and receive
serializable results that journal as ordinary `YieldEvent`s.

### 2.2 What This Specification Does Not Define

This specification does not define:

- the internal implementation of the browser transport
  (Playwright API usage, browser process management, CDP
  session handling)
- transport-layer error recovery or retry semantics
- browser extension or plugin management
- file download or upload through the browser
- network interception or request modification
- cookie or storage management beyond what is exposed through
  the contract operations
- audio, video, or WebRTC interaction
- browser DevTools protocol access from workflows

These concerns are transport-implementation details that MAY be
addressed by transport-level documentation but are not part of
the contract visible to workflows.

---

## 3. Relationship to Other Specifications

### 3.1 Blocking Scope Specification

The browser contract is installed within a blocking scope via
`useTransport`. All scope lifecycle rules from the blocking
scope specification apply: scope entry evaluates the binding
expression (§6.1 R2), the transport is installed for the
scope's lifetime (§6.1 R1), and scope exit shuts down the
transport (§6.2 R6). The browser transport factory is the
binding expression's evaluated value — a generator function
that creates an `AgentTransport` when called at scope entry.

### 3.2 Scoped Effects Specification

The browser contract follows the scoped effects model:
`useTransport(Browser, factory)` binds the agent identity,
`useAgent(Browser)` provides a compile-time handle, and
handle method calls lower to `Eval("browser.methodName", ...)`
dispatch nodes. Middleware installed via `Effects.around`
applies to browser effects identically to any other agent
effects.

### 3.3 Compiler Specification

The compiler treats the browser contract as an ordinary agent
contract. `Browser` is declared via `declare function Browser`,
`useAgent(Browser)` erases at compile time, and method calls
lower to external `Eval` nodes. No compiler changes beyond
those already specified in the blocking scope specification are
required.

### 3.4 Kernel Specification

No kernel changes are required. Browser effects are ordinary
external effects. The kernel classifies them as `EXTERNAL`,
yields effect descriptors, and resumes with results. The
kernel does not know it is evaluating browser operations.

---

## 4. Terminology

**Browser contract.** The typed interface declaring the set of
browser operations available to authored workflows. The
contract defines operation names, input shapes, and output
shapes. It is declared as an agent contract via
`declare function Browser`.

**Browser transport factory.** A generator function conforming
to `AgentTransportFactory` — `() => Operation<AgentTransport>`.
The factory is the evaluated value of the `browserTransport(config)`
call expression. When called at scope entry, it launches a
browser, creates a default page, and returns an `AgentTransport`
with bidirectional message channels. The factory follows the
same structural pattern as `inprocessTransport`,
`stdioTransport`, `websocketTransport`, and `workerTransport`.

**Browser transport.** A runtime-owned transport implementation
that maps browser contract operations to live Playwright API
calls. Created by calling the browser transport factory at
scope entry. Destroyed at scope exit.

**Page identifier.** A plain string value that identifies a
browser page within the scope of a single browser transport
instance. Page identifiers are created by navigation
operations, returned as ordinary effect results, and accepted
as parameters by subsequent operations. They are serializable
data, not live page references.

**Active page.** The page that browser operations target when
no explicit page identifier is provided. The browser transport
MUST maintain an active page. The active page is set by
`navigate` when it creates a new page, and by `selectPage`
when the workflow explicitly selects a different page.

---

## 5. Authored Model

### 5.1 Contract Declaration

The browser contract MUST be declared as an agent contract
with the following ambient declaration:

````typescript
import type { Workflow } from "@tisyn/agent";
import type {
  NavigateParams, NavigateResult,
  ClickParams, ClickResult,
  FillParams, FillResult,
  ContentParams, ContentResult,
  ScreenshotParams, ScreenshotResult,
  SelectPageParams, SelectPageResult,
  ClosePageParams, ClosePageResult,
} from "@tisyn/transport/browser";

declare function Browser(): {
  navigate(params: NavigateParams): Workflow<NavigateResult>;
  click(params: ClickParams): Workflow<ClickResult>;
  fill(params: FillParams): Workflow<FillResult>;
  content(params: ContentParams): Workflow<ContentResult>;
  screenshot(params: ScreenshotParams): Workflow<ScreenshotResult>;
  selectPage(params: SelectPageParams): Workflow<SelectPageResult>;
  closePage(params: ClosePageParams): Workflow<ClosePageResult>;
};
````

The exact TypeScript types for parameter and result shapes are
defined in §7. The declaration above establishes the operation
set and the agent identity prefix `"browser"`.

### 5.2 Scope Setup

The browser MUST be installed within a scope's setup prefix:

````typescript
yield* scoped(function* () {
  yield* useTransport(Browser, browserTransport({
    headless: false,
  }));

  const browser = yield* useAgent(Browser);
  // ... body using browser handle ...
});
````

BT1. `useTransport(Browser, expr)` MUST appear in the setup
     prefix. The second argument MUST evaluate to an
     `AgentTransportFactory` — a generator function conforming
     to `() => Operation<AgentTransport>`.

BT2. `useAgent(Browser)` MUST appear in the body, after all
     setup statements. It MUST have a corresponding
     `useTransport(Browser, ...)` in the setup prefix.

BT3. Handle method calls (`browser.navigate(...)`,
     `browser.click(...)`, etc.) MUST appear as `yield*`
     expressions in the body. They are ordinary external
     effects.

These rules are applications of the blocking scope
specification §3.3–§3.7 to the browser contract. No new
authored-language rules are introduced.

### 5.3 Representative Authored Pattern

````typescript
yield* scoped(function* () {
  yield* useTransport(Browser, browserTransport({
    headless: false,
    viewport: { width: 1280, height: 720 },
  }));
  yield* useTransport(Llm, workerTransport({
    url: "./llm-worker.js",
  }));

  const browser = yield* useAgent(Browser);
  const llm = yield* useAgent(Llm);

  // Navigate and extract content
  yield* browser.navigate({ url: "https://example.com" });
  const page = yield* browser.content();

  // LLM decides next action
  const decision = yield* llm.sample({
    prompt: `Given this page:\n${page.text}\nWhat should I click?`,
  });

  // Execute browser action
  yield* browser.click({ selector: decision.selector });

  // Extract final result
  const result = yield* browser.content();
  return result.text;
});
````

### 5.4 Authored Surface vs. Compilation vs. Runtime

| Concern | Layer | Mechanism |
|---|---|---|
| `browserTransport({...})` | Authored expression | Compiled to IR expression in scope binding metadata |
| `useTransport(Browser, ...)` | Authored setup | Compiled to binding entry; no IR node emitted for `useTransport` itself |
| `useAgent(Browser)` | Authored body | Compile-time erasure; no IR node emitted |
| `browser.navigate(...)` | Authored body | Lowered to `Eval("browser.navigate", ...)` |
| Factory evaluation | Runtime | Binding expression evaluated at scope entry against execution environment |
| Factory invocation | Runtime | Evaluated factory called to create live `AgentTransport`; browser launched |
| Effect dispatch | Runtime | `Eval("browser.navigate", ...)` dispatched through bound transport |
| Transport shutdown | Runtime | Scope exit triggers transport shutdown; browser closed |

---

## 6. Browser Transport Factory Semantics

### 6.1 Factory Configuration

The `browserTransport(config)` function accepts configuration
and returns an `AgentTransportFactory`. The following
configuration fields are defined:

````typescript
interface BrowserTransportConfig {
  /**
   * Whether to run the browser in headless mode.
   * Default: true.
   */
  headless?: boolean;

  /**
   * Default viewport dimensions for new pages.
   * Default: { width: 1280, height: 720 }.
   */
  viewport?: { width: number; height: number };

  /**
   * Browser engine to use.
   * Default: "chromium".
   */
  engine?: "chromium" | "firefox" | "webkit";

  /**
   * Additional browser launch arguments.
   * Default: [].
   */
  launchArgs?: string[];
}
````

BF1. `browserTransport(config)` MUST return an
     `AgentTransportFactory` — a generator function with
     signature `() => Operation<AgentTransport>`. This follows
     the same factory pattern as `inprocessTransport`,
     `stdioTransport`, `websocketTransport`, and
     `workerTransport`.

BF2. All configuration fields are OPTIONAL. The factory MUST
     apply the specified defaults when fields are absent.

BF3. The binding expression that invokes `browserTransport(...)`
     is part of the IR's scope metadata. The expression — not
     its evaluated result — is the durable input for the
     browser binding. On replay, the runtime re-evaluates that
     expression against the replay-time execution environment
     to obtain a factory. The factory itself is not a
     separately journaled artifact.

### 6.2 Factory Constructor

The authored surface provides `browserTransport(config)` as a
function that captures configuration and returns a factory:

````typescript
function browserTransport(
  config?: BrowserTransportConfig
): AgentTransportFactory {
  return function* (): Operation<AgentTransport> {
    // Launch browser with config, create channels,
    // set up protocol server, return AgentTransport
  };
}
````

BF4. `browserTransport` is an authored-surface convenience. It
     is NOT a compiler built-in. The compiler compiles it as
     an ordinary call expression in the scope binding metadata.

### 6.3 Factory Invocation at Scope Entry

At scope entry, the runtime evaluates the binding expression
to obtain a factory, then calls the factory to create a live
transport.

BF5. The runtime MUST evaluate the binding expression using the
     kernel evaluator (blocking scope specification §6.1 R2).
     The result MUST be an `AgentTransportFactory`.

BF6. The runtime MUST call the factory to create a live
     `AgentTransport`. The factory generator launches a browser
     process (or connects to a browser service), creates a
     browser context with the configuration fields, and creates
     one default page.

BF7. If browser launch fails (e.g., browser binary not found,
     insufficient system resources, sandbox failure), the
     factory MUST throw. This failure propagates as a runtime
     initialization error. This failure is classified as an
     execution-environment failure (see §10.2), not as replay
     divergence.

BF8. The factory MUST create one default page at launch. The
     default page MUST be the active page. The default page's
     identifier MUST be a deterministic string (e.g.,
     `"page:0"`).

---

## 7. Browser Contract Operation Semantics

### 7.1 General Rules

OP1. Every browser contract operation is an ordinary external
     effect. Its effect ID is `"browser.<operationName>"`.

OP2. Every operation's input MUST be a JSON-serializable data
     object. Every operation's output MUST be a JSON-
     serializable data object.

OP3. Every operation's result is journaled as a standard
     `YieldEvent`. No browser operation produces non-journaled
     side effects visible to the workflow.

OP4. Operations that accept an optional `page` parameter
     operate on the active page when `page` is omitted. When
     `page` is provided, the operation targets the identified
     page.

OP5. Page identifiers MUST be plain strings. The transport
     allocates page identifiers using a deterministic scheme
     scoped to the transport instance (e.g., `"page:0"`,
     `"page:1"`, `"page:2"`). Page identifiers MUST be stable
     for the lifetime of the page.

OP6. If an operation references a page identifier that does not
     correspond to an open page, the transport MUST return an
     error result. The error MUST be a normal effect error (an
     `Err` result), not a transport-level crash.

### 7.2 `browser.navigate`

**Effect ID:** `"browser.navigate"`

**Input:**

````typescript
interface NavigateParams {
  /** URL to navigate to. */
  url: string;

  /**
   * Target page. Omit to use the active page.
   */
  page?: string;

  /**
   * Maximum time to wait for navigation in milliseconds.
   * Default: 30000.
   */
  timeout?: number;
}
````

**Output:**

````typescript
interface NavigateResult {
  /** The page identifier of the navigated page. */
  page: string;

  /** HTTP status code of the main frame response. */
  status: number;

  /** Final URL after any redirects. */
  url: string;
}
````

NAV1. `navigate` loads the specified URL in the target page.

NAV2. The result MUST include the page identifier, the HTTP
      status code, and the final URL after redirects.

NAV3. If navigation fails (network error, timeout, invalid
      URL), the transport MUST return an error result with a
      descriptive message. The error is a normal effect error.

NAV4. On success, the navigated page becomes the active page.

### 7.3 `browser.click`

**Effect ID:** `"browser.click"`

**Input:**

````typescript
interface ClickParams {
  /** CSS selector identifying the element to click. */
  selector: string;

  /** Target page. Omit to use the active page. */
  page?: string;

  /** Maximum time to wait for selector in milliseconds.
      Default: 30000. */
  timeout?: number;
}
````

**Output:**

````typescript
interface ClickResult {
  /** Whether the click succeeded. */
  ok: true;
}
````

CLK1. `click` waits for the selector to become visible and
      actionable, then performs a click action on the matched
      element.

CLK2. If the selector does not match any element within the
      timeout, the transport MUST return an error result.

CLK3. If the selector matches multiple elements, the transport
      MUST click the first match.

### 7.4 `browser.fill`

**Effect ID:** `"browser.fill"`

**Input:**

````typescript
interface FillParams {
  /** CSS selector identifying the input element to fill. */
  selector: string;

  /** Value to fill. */
  value: string;

  /** Target page. Omit to use the active page. */
  page?: string;

  /** Maximum time to wait for selector in milliseconds.
      Default: 30000. */
  timeout?: number;
}
````

**Output:**

````typescript
interface FillResult {
  /** Whether the fill succeeded. */
  ok: true;
}
````

FIL1. `fill` clears the target input element and types the
      specified value.

FIL2. If the selector does not match an input-like element
      within the timeout, the transport MUST return an error
      result.

### 7.5 `browser.content`

**Effect ID:** `"browser.content"`

**Input:**

````typescript
interface ContentParams {
  /** Target page. Omit to use the active page. */
  page?: string;

  /**
   * Content format.
   * "text": returns visible text content.
   * "html": returns full HTML.
   * Default: "text".
   */
  format?: "text" | "html";
}
````

**Output:**

````typescript
interface ContentResult {
  /** The extracted content. */
  text: string;

  /** The page's current URL. */
  url: string;

  /** The page's title. */
  title: string;
}
````

CON1. `content` extracts the page's content in the requested
      format.

CON2. When `format` is `"text"`, the transport MUST return
      the visible text content of the page, equivalent to
      `innerText` of the document body. When `format` is
      `"html"`, the transport MUST return the full outer HTML
      of the document.

CON3. The result MUST include the current URL and page title
      alongside the content.

### 7.6 `browser.screenshot`

**Effect ID:** `"browser.screenshot"`

**Input:**

````typescript
interface ScreenshotParams {
  /** Target page. Omit to use the active page. */
  page?: string;

  /**
   * Whether to capture the full scrollable page.
   * Default: false (viewport only).
   */
  fullPage?: boolean;

  /**
   * Image format.
   * Default: "png".
   */
  format?: "png" | "jpeg";

  /**
   * JPEG quality (1-100). Only used when format is "jpeg".
   * Default: 80.
   */
  quality?: number;
}
````

**Output:**

````typescript
interface ScreenshotResult {
  /** Base64-encoded image data. */
  data: string;

  /** MIME type of the image. */
  mimeType: string;

  /** Width of the captured image in pixels. */
  width: number;

  /** Height of the captured image in pixels. */
  height: number;
}
````

SCR1. `screenshot` captures a visual representation of the
      page and returns it as base64-encoded data.

SCR2. The result MUST include the encoded image data, MIME
      type, and pixel dimensions.

SCR3. Screenshot data may be large. The transport SHOULD
      respect the requested format and quality settings to
      manage result size. The journal records the full result;
      journal size management is outside this specification's
      scope.

### 7.7 `browser.selectPage`

**Effect ID:** `"browser.selectPage"`

**Input:**

````typescript
interface SelectPageParams {
  /** Page identifier to select as active. */
  page: string;
}
````

**Output:**

````typescript
interface SelectPageResult {
  /** The newly active page identifier. */
  page: string;

  /** Current URL of the selected page. */
  url: string;
}
````

SEL1. `selectPage` changes the active page to the identified
      page.

SEL2. If the page identifier does not correspond to an open
      page, the transport MUST return an error result per OP6.

### 7.8 `browser.closePage`

**Effect ID:** `"browser.closePage"`

**Input:**

````typescript
interface ClosePageParams {
  /** Page identifier to close. */
  page: string;
}
````

**Output:**

````typescript
interface ClosePageResult {
  /** Whether the close succeeded. */
  ok: true;

  /**
   * If the closed page was the active page, the identifier
   * of the new active page. Null if no pages remain.
   */
  activePage: string | null;
}
````

CLS1. `closePage` closes the identified page and releases its
      resources within the transport.

CLS2. The workflow MUST NOT close the last remaining page. If
      the workflow attempts to close the last page, the
      transport MUST return an error result. The scope
      boundary owns the browser's full lifecycle; the last
      page is closed when the scope exits and the transport
      shuts down.

CLS3. If the closed page was the active page, the transport
      MUST select another open page as the new active page.
      The selection order is implementation-defined, but the
      result MUST report which page is now active.

### 7.9 Error Result Convention

ERR1. All browser operations MUST use the standard effect
      error convention: an `Err` result with a `message`
      field describing the failure.

ERR2. Browser operation errors are catchable via the
      workflow's `try/catch` mechanism. They are ordinary
      effect errors, not transport crashes.

ERR3. Transport-level failures (browser process crash,
      unrecoverable connection loss to the browser) MUST
      surface as scope-level errors that propagate per the
      blocking scope specification's error rules (§7.2
      T4–T6).

### 7.10 Operation Extensibility

EXT1. The operation set defined in §7.2–§7.8 is the minimum
      required contract for this specification version.
      Transport implementations MAY support additional
      operations beyond this set.

EXT2. Additional operations MUST follow the same conventions:
      `"browser.<operationName>"` effect IDs, JSON-serializable
      inputs and outputs, optional `page` parameter, standard
      error results.

EXT3. Workflows that use operations not defined in this
      specification are not guaranteed portable across
      transport implementations.

---

## 8. Compiler Requirements

The browser contract introduces no new compiler machinery. All
compilation rules follow from existing specifications. This
section documents the specific obligations for clarity.

### 8.1 Contract Declaration

CR1. The compiler MUST accept `declare function Browser` as an
     agent contract declaration, per the existing agent
     declaration mechanism.

CR2. The compiler MUST resolve method names declared on the
     `Browser` contract and validate them against the contract
     when compiling handle method calls.

### 8.2 Scope Setup Compilation

CR3. `yield* useTransport(Browser, browserTransport({...}))`
     MUST compile per blocking scope specification §9.2. The
     second argument is compiled as an expression and placed
     in the scope node's binding metadata.

CR4. The `browserTransport(...)` call expression MUST be
     compiled as an ordinary call expression. The compiler
     MUST NOT treat `browserTransport` as a special form or
     built-in.

### 8.3 Handle Compilation

CR5. `const browser = yield* useAgent(Browser)` MUST compile
     per blocking scope specification §9.4. The compiler
     records a handle binding and emits no IR.

CR6. `yield* browser.navigate({...})` MUST compile per
     blocking scope specification §9.5. The compiler emits
     `Eval("browser.navigate", compiledArgs)`.

CR7. All browser method calls follow the same pattern:
     `Eval("browser.<methodName>", compiledArgs)`. The effect
     ID prefix `"browser"` is derived from the contract
     identity via the existing `toAgentId` transform.

### 8.4 No New Compiler Rules

CR8. The compiler MUST NOT introduce browser-specific
     compilation rules, special forms, or validation beyond
     what is specified for generic agent contracts in the
     blocking scope specification.

---

## 9. Runtime Requirements

### 9.1 Scope Entry

When the runtime processes a scope whose binding metadata
contains a `browserTransport(...)` call expression:

RR1. The runtime MUST evaluate the binding expression per
     blocking scope specification §6.1 R2. The result MUST
     be an `AgentTransportFactory`.

RR2. The runtime MUST call the factory to create a live
     `AgentTransport`. The factory launches a browser process
     (or connects to a browser service), creates a browser
     context with the configuration, and creates one default
     page.

RR3. The runtime MUST register the live browser transport in
     the scope-local bound-agents registry under the
     `"browser"` agent prefix.

RR4. If any step of expression evaluation or factory
     invocation fails, the runtime MUST fail with a runtime
     initialization error before body execution begins.

### 9.2 Effect Dispatch

RR5.  When the runtime receives an effect descriptor with an
      ID prefixed by `"browser."`, it MUST dispatch the effect
      through the browser transport registered in the current
      scope (or an ancestor scope, per scoped effects
      specification §4).

RR6.  The browser transport MUST translate the effect
      descriptor's operation name and data into the
      corresponding Playwright API calls and return a
      serializable result.

RR7.  The runtime MUST journal the result as a standard
      `YieldEvent` per existing journaling rules. Browser
      effects are not special-cased.

RR8.  Middleware installed in the scope via `Effects.around`
      MUST apply to browser effects. The middleware dispatch
      chain processes browser effects identically to any other
      agent effects.

### 9.3 Scope Exit and Shutdown

RR9.  When the enclosing scope exits — by normal completion,
      error, or cancellation — the runtime MUST shut down the
      browser transport.

RR10. Transport shutdown MUST close all open pages, close the
      browser context, and terminate the browser process (or
      disconnect from the browser service).

RR11. Shutdown follows the blocking scope specification's
      teardown ordering rules (§7). Transport shutdown occurs
      as part of scope teardown.

RR12. If transport shutdown fails (browser process does not
      terminate cleanly), the runtime SHOULD log the failure
      but MUST NOT propagate it as a workflow error. The scope
      has already completed; shutdown failure is a cleanup
      concern.

### 9.4 Page Management

RR13. The browser transport MUST track open pages and their
      identifiers internally.

RR14. Page identifiers MUST be allocated using a deterministic
      scheme scoped to the transport instance. The scheme MUST
      produce the same identifiers for the same sequence of
      page-creating operations.

RR15. The transport MUST maintain an active page. Initially,
      the active page is the default page created at launch
      (BF8). The active page changes per NAV4 and SEL1.

RR16. Page identifiers, active page state, and the page
      tracking registry are transport-internal state. They
      MUST NOT be exposed to the kernel and MUST NOT be
      written to the journal as separate events.

---

## 10. Replay Requirements

### 10.1 Replay Model

Browser-scoped workflows use the same kernel-level replay
model as all scoped workflows: stored `YieldEvent` results are
served from the journal and the kernel does not re-dispatch
effects during the replay phase. The browser transport is not
dispatched during replay. Replay does not require re-execution
of browser operations against the external world.

This version of the browser contract does NOT guarantee that a
browser scope can replay to a mid-session frontier and then
continue issuing new browser commands against a reconstructed
browser state. Mid-session crash recovery with continued
browser interaction is explicitly out of scope (§10.5).

### 10.2 Factory Re-Evaluation and Re-Invocation

RP1. **Factory re-evaluation.** On replay, the runtime
     re-evaluates the binding expression from the IR against
     the execution environment. The result MUST be an
     `AgentTransportFactory`. The expression is in the IR;
     the evaluated factory is produced fresh from the IR and
     the environment, not read from the journal.

RP2. **Factory re-invocation.** The runtime MUST call the
     factory to create a live browser transport at scope
     entry, identically to fresh execution (RR2). A fresh
     browser instance is launched. This instance has no
     prior interaction state — it reflects the factory's
     configuration only.

### 10.3 Journal Replay

RP3. **Stored result replay.** During the replay phase, stored
     `YieldEvent` results for browser effects are served from
     the journal to the kernel. The kernel receives stored
     results and advances, identically to replay for any other
     effect type. The browser transport receives no dispatch
     during the replay phase.

RP4. **Transport idle during replay.** The browser transport
     MUST NOT execute any browser operations during the replay
     phase. The transport exists (it was created at scope entry
     per RP2), but it is idle. Its internal state reflects the
     factory's initial configuration — a fresh browser with
     one default page — not the cumulative state of prior
     interactions.

### 10.4 Completed Scope Replay

RP5. **Full replay.** If the journal contains a `CloseEvent`
     for the browser scope's coroutineId, the scope completed
     during the original execution. On replay, all browser
     effect results are served from the journal, the scope
     completes, and the transport is shut down. No live
     browser interaction occurs. This is the normal replay
     case.

RP6. **Full replay correctness.** Full replay of a completed
     browser scope produces the same result value, the same
     journal event sequence, and the same scope completion
     status as the original execution. This is identical to
     full replay for any other scope type.

### 10.5 Incomplete Scope Replay (Crash Recovery)

RP7. **Incomplete replay definition.** If the journal does NOT
     contain a `CloseEvent` for the browser scope's
     coroutineId, the scope did not complete during the
     original execution (the process crashed mid-session).
     The journal contains a prefix of the scope's browser
     effect results.

RP8. **No mid-session continuation guarantee.** This
     specification version does NOT guarantee that the runtime
     can replay the stored prefix and then continue issuing
     new live browser commands against a correctly
     reconstructed browser state. The browser transport's live
     browser instance has a fresh default page (RP4). It does
     not reflect the cumulative state (DOM, cookies, SPA
     transitions, page content) produced by the replayed
     operations. Issuing new browser commands against this
     fresh instance would produce results inconsistent with
     the workflow's expectations.

RP9. **v0.1.0 runtime behavior on incomplete replay.** When
     the runtime reaches the replay frontier for a browser
     scope (all stored `YieldEvent`s served, no `CloseEvent`
     found), the runtime transitions to live dispatch. The
     next browser effect is dispatched to the transport as an
     ordinary live effect. Because the fresh browser transport
     has no prior interaction state (RP4), the dispatch will
     execute against a blank browser. This will likely produce
     errors or incorrect results: selectors will not match,
     page content will differ from expectations, and
     navigation state will be absent. This is the natural
     behavior of the existing runtime replay machinery — the
     runtime does not distinguish browser effects from any
     other effect type at the replay frontier. No runtime
     changes are made for v0.1.0; this behavior is documented,
     not prescribed.

> **Non-normative.** This limitation exists because browser
> interaction state — DOM, cookies, client-side application
> state, modal/wizard progression — is cumulative and
> external. Unlike agent effects whose results fully capture
> their workflow-visible output, browser effects produce
> side effects in the browser that subsequent operations
> depend on. Reconstructing that cumulative state would
> require either re-executing all prior browser operations
> against the live site (which makes replay dependent on
> external-world stability) or serializing browser state
> into the journal (which would require volatile or
> non-journaled mechanisms outside this specification's
> scope). Both approaches are deferred to future versions.

### 10.6 No New Event Types

RP10. **Two-event invariant.** Transport factory evaluation,
      browser launch, and page tracking are execution
      preconditions and transport-internal state. They MUST
      NOT produce journal events. The journal contains only
      `YieldEvent`s for browser contract operations and the
      scope's `CloseEvent`.

### 10.7 Failure Classification

RP11. **Replay-time initialization failure.** If the runtime
      cannot invoke the browser transport factory on replay
      (browser binary not found, insufficient resources,
      launch failure), this is an **execution-environment
      failure**. It is NOT replay divergence. The journal
      remains valid. The execution environment is not ready.

RP12. **Replay-time initialization failure is equivalent to
      fresh-execution initialization failure.** The same
      failure during fresh execution and during replay has the
      same classification: runtime initialization error per
      RR4. The distinction between replay and fresh execution
      does not affect failure semantics.

### 10.8 Applicability Summary

| Scenario | Supported | Reason |
|---|---|---|
| Browser scope completes fully; replay from journal | Yes | All results stored; full replay per RP5–RP6 |
| Browser scope completes fully; results used by subsequent workflow effects | Yes | Stored results replayed to kernel; kernel advances normally |
| Browser scope crashes mid-session; replay stored prefix | Yes | Stored results replayed to kernel per RP3 |
| Browser scope crashes mid-session; continue with new browser commands | Degraded | Transport state not reconstructed; RP8–RP9 apply. Live dispatch proceeds but against fresh browser; likely produces errors |
| Browser scope on fresh execution (no journal) | Yes | Normal live execution; all results journaled |

---

## 11. Deferred Items / Non-Goals

The following are explicitly out of scope for this
specification version.

### 11.1 Workflow-Visible Opaque Runtime Values

This specification does not introduce opaque runtime values
(capability tokens, live object references, or non-serializable
workflow values). Browser state is accessed exclusively through
the contract's command/response interface. If future use cases
require the workflow to hold an opaque reference to a live
browser or page object, that work belongs to the broader
runtime-value architecture, which is a separate design effort.

### 11.2 Dynamic-Count Browser Instances

This specification supports exactly one browser instance per
scope binding. If a workflow needs N browsers where N is
determined at runtime, it must create N scopes with N
bindings. This specification does not provide a pool, a
dynamic allocator, or a factory that creates browser instances
on demand within a single scope.

### 11.3 Non-Agent-Like Resource Coordination

The browser is modeled as an agent: request/response dispatch
through a transport. If a future resource needs a fundamentally
different interaction pattern (streaming data, shared mutable
state, pub/sub), the agent/transport abstraction does not fit.
That work belongs to the broader `resource` primitive design.

### 11.4 Generalized Capability Token Semantics

Tokens that can be passed between scopes, stored, revoked, or
attenuated are not part of this specification. Page identifiers
are plain strings within a single transport scope. They are not
transferable, revocable, or attenuatable.

### 11.5 Browser-to-Browser Coordination

If two scopes each have their own browser and need to
coordinate, this specification does not provide a mechanism.
Each scope owns its browser independently. Cross-scope
coordination is a separate design concern.

### 11.6 Compile-Time Factory Validation

The compiler does not validate that a `browserTransport({...})`
call produces a valid `AgentTransportFactory`. Runtime
validation at scope entry (RR4) is the enforcement point.
Compile-time validation for transport factory expressions is a
future ergonomic improvement.

### 11.7 Browser Session Persistence Across Scopes

Browser state (cookies, local storage, session data) does not
persist across scope boundaries. Each scope entry creates a
fresh browser. If future use cases require browser state
continuity across scopes, that requires a browser-state
serialization mechanism not defined here.

### 11.8 Transport Implementation Specification

This specification defines the contract between workflows and
the browser transport. It does not define how the transport
maps operations to Playwright APIs, manages browser processes,
or handles CDP sessions. A transport implementation guide MAY
be provided as a separate non-normative document.

### 11.9 Mid-Session Crash Recovery with Continued Interaction

If a browser scope crashes mid-session, this specification does
not provide a mechanism to replay the stored prefix and then
continue issuing new browser commands against a reconstructed
browser state (§10.5 RP8–RP9). Reconstructing cumulative
browser interaction state (DOM, cookies, SPA transitions, page
content) from stored effect results would require either re-
executing prior browser operations against the live site during
replay or serializing browser state snapshots into the journal.
Both approaches introduce dependencies or mechanisms outside
this specification's scope. Future versions MAY address this
via transport-level replay-time reconstruction, browser state
serialization, or checkpoint mechanisms.

### 11.10 Page-Registry Bookkeeping During Replay

During replay, the transport does not receive dispatches
(RP3–RP4). The runtime replay path feeds stored results
directly to the kernel without dispatching to the transport.
Consequently, the transport's internal page registry is not
updated during replay — it reflects only the initial default
page from factory invocation (RP2). Maintaining page-registry
consistency during replay (tracking page identifiers from
replayed operations without executing browser commands) is
deferred. This bookkeeping becomes relevant only when
incomplete scope replay with continued interaction (§11.9) is
addressed.

---

## 12. Conformance Requirements

### 12.1 Conformance Categories

A conforming implementation MUST satisfy the following
categories:

**Compiler conformance.** The compiler MUST accept the browser
contract declaration (CR1), compile scope setup with browser
transport factory expressions (CR3–CR4), erase `useAgent`
(CR5), and lower handle method calls to `Eval("browser.*",
...)` nodes (CR6–CR7). The compiler MUST NOT introduce
browser-specific compilation rules (CR8).

**Runtime conformance.** The runtime MUST evaluate the binding
expression and call the resulting factory at scope entry
(RR1–RR3), dispatch browser effects through the bound
transport (RR5–RR7), apply scope middleware to browser effects
(RR8), shut down the transport at scope exit (RR9–RR11), and
manage page state per RR13–RR16.

**Contract conformance.** The browser transport MUST implement
all operations defined in §7 with the specified input/output
shapes. Inputs and outputs MUST be JSON-serializable. Error
results MUST follow the standard effect error convention
(ERR1–ERR3).

**Replay conformance.** The runtime MUST re-evaluate and re-
invoke the browser transport factory on replay (RP1–RP2),
serve stored results to the kernel during the replay phase
without dispatching to the transport (RP3–RP4), replay
completed browser scopes to identical results (RP5–RP6),
produce no new event types (RP10), and classify initialization
failures correctly (RP11–RP12).

### 12.2 Required Test Coverage

The conformance test plan (a separate document) MUST include
tests in the following categories:

| Category | Coverage target |
|---|---|
| Compiler acceptance | Browser contract declaration; scope setup with `browserTransport(...)`; `useAgent(Browser)` erasure; handle method lowering |
| Compiler rejection | Browser handle misuse (pass as argument, return, conditional assignment) per blocking scope §3.7 |
| Factory validation | Valid factory accepted; factory invocation creates transport; launch failure reported as initialization error |
| Runtime lifecycle | Scope entry creates browser; scope exit shuts down browser; binding failure before body; launch failure reported as initialization error |
| Effect dispatch | Each §7 operation dispatched, result returned, result journaled |
| Page management | Default page created at launch; page identifiers in results; active page tracking; closed-page error; select-page |
| Middleware integration | Scope middleware intercepts browser effects; deny rule blocks browser effect; augmentation modifies browser effect data |
| Error handling | Navigation failure; selector timeout; invalid page identifier; transport crash propagates as scope error |
| Replay — completed scope | Complete browser workflow (navigate + click + fill + content) replays identically from journal; same result value; same journal events |
| Replay — factory re-evaluation | Binding expression re-evaluated on replay; fresh transport instance created |
| Replay — transport idle | Transport receives no dispatch during replay phase; browser not interacted with |
| Replay — incomplete scope frontier | Partial journal (no CloseEvent) causes runtime to transition to live dispatch at frontier per RP9; fresh browser receives dispatch |
| Replay — initialization failure | Browser launch failure on replay classified as environment failure (RP11) |
| Replay — no extra events | No YieldEvents produced during replay phase; journal unchanged |

### 12.3 Non-Normative Test Guidance

> Tests SHOULD use hand-constructed IR for runtime and replay
> tests, following the established pattern from blocking scope
> and resource test plans. Compiler tests use authored
> TypeScript source.
>
> Transport behavior tests MAY use a mock browser transport
> that implements the contract without launching a real
> browser, to isolate contract conformance from Playwright
> availability.
>
> Replay tests for completed scopes SHOULD verify that the
> transport receives no dispatch during the replay phase
> by confirming the browser is not interacted with while
> stored results are served from the journal.
>
> Replay tests for incomplete scopes SHOULD verify that the
> runtime transitions to live dispatch at the frontier, and
> that the fresh transport receives the dispatch (which will
> likely produce errors due to missing prior state).
>
> End-to-end tests that launch a real browser and navigate to
> a test server are valuable but are integration tests, not
> conformance tests. They SHOULD be maintained separately.
