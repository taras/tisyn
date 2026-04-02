# Tisyn Browser Contract — Conformance Test Plan

**Version:** 0.1.0
**Tests:** Tisyn Browser Contract Specification 0.1.0
**Status:** Draft

---

## 1. Test Plan Scope

### 1.1 What This Plan Covers

This test plan defines conformance criteria for the browser
transport-bound contract as specified in the Tisyn Browser
Contract Specification v0.1.0. It covers:

- compiler acceptance and rejection of browser contract
  authored forms per §5 and §8
- IR lowering of browser scope setup (`useTransport`,
  `useAgent`) and browser method calls per §8
- runtime browser transport lifecycle: scope entry, effect
  dispatch, scope exit and shutdown per §9
- browser contract operation semantics: required operations,
  input/output shapes, page identity, and error conventions
  per §7
- replay semantics: completed scope replay, incomplete scope
  frontier transition, descriptor re-evaluation, transport
  idle during replay per §10
- failure classification: initialization failure, operation
  errors per §10.7 and §7.9
- journal invariant: two-event model preserved, no new event
  types per §10.6
- middleware and scope interaction: browser effects visible to
  scope-local middleware per §9.3 RR12

### 1.2 What This Plan Does Not Cover

The following are explicitly outside the scope of this test
plan. They correspond to the deferred extensions listed in
browser contract specification §11.

- workflow-visible opaque runtime values (§11.1)
- dynamic-count browser instances (§11.2)
- non-agent-like resource coordination (§11.3)
- generalized capability token semantics (§11.4)
- browser-to-browser cross-scope coordination (§11.5)
- compile-time descriptor validation (§11.6)
- browser session persistence across scopes (§11.7)
- transport implementation internals (§11.8)
- mid-session crash recovery with continued interaction
  (§11.9)

Tests that would validate deferred behavior are listed in §13
(Explicit Non-Tests) for tracking purposes.

### 1.3 Observability Model

All tests compare observable outputs only:

- **Compiler tests:** acceptance (produces conforming IR) or
  rejection (produces a diagnostic identifying the violated
  constraint). Diagnostics are compared by violated-rule
  category, not by message wording or error code number.
- **Runtime tests:** result value, result status, and journal
  event sequence. Journal events are compared using canonical
  JSON equality per the existing conformance harness.
- **Replay tests:** journal event sequence after replay matches
  the expected sequence. Deterministic reconstruction from IR
  and environment is verified by comparing replay output to
  original output.
- **Operation tests:** browser contract operation inputs and
  outputs validated as serializable JSON. Tests use a mock
  browser transport (§1.5) that implements the contract
  interface without launching a real browser.

No test depends on Playwright API internals, browser process
management details, transport wire protocol specifics, or
implementation-internal page management data structures.

### 1.4 Tiers

**Core:** Tests that every conforming implementation MUST pass.
A browser contract implementation is non-conforming if any Core
test fails.

**Extended:** Tests for edge cases, boundary conditions, and
diagnostic quality. Recommended but not required for initial
conformance.

### 1.5 Mock Browser Transport

Runtime, operation, and replay tests in this plan use a
**mock browser transport** that satisfies the browser contract
operation semantics (§7) without launching a real browser
process. The mock transport:

- is created by a factory function matching the
  `AgentTransportFactory` signature
- maintains an in-memory page registry and active-page state
- returns deterministic, pre-configured results for each
  operation
- reports operation errors in the standard effect error
  convention (ERR1)

The mock isolates contract-level conformance from Playwright
availability and external website dependencies. End-to-end
tests against a real browser are integration tests and are
maintained separately.

---

## 2. Fixture Schema

### 2.1 Compiler Acceptance Fixture

Uses the existing `CompilerAcceptanceFixture` type from the
blocking scope test plan. The `expected_ir_shape` field
validates scope node structure, binding keys, and body IR
shape.

### 2.2 Compiler Rejection Fixture

Uses the existing `CompilerRejectionFixture` type from the
blocking scope test plan. The `violated_rule` field references
constraint identifiers from the specifications that define the
violated rule. Browser contract compiler rejections fall into
two categories:

- **Inherited handle rules.** The `useAgent` handle
  restrictions H1–H4 are defined in the blocking scope
  specification §3.7. They apply to all `useAgent` handle
  bindings, including `useAgent(Browser)`. These are
  compile-time restrictions on an erased binding — the
  compiler rejects source that would require the handle to
  exist as a runtime value. No runtime browser-handle value
  exists; the restrictions prevent authored source from
  depending on one. The `violated_rule` field cites the
  blocking scope rule (e.g., `"H1"`) with the understanding
  that the rule is inherited, not browser-specific.

- **Inherited setup rules.** The setup-ordering rules (S2,
  UT3, UA3) are defined in the blocking scope specification
  §3.3–§3.6. They apply to browser scope setup identically
  to any other scoped agent contract.

### 2.3 Runtime Fixture

````typescript
interface BrowserRuntimeFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "browser_runtime";
  ir: Expr;                    // hand-constructed scope IR
  env: Record<string, Val>;    // execution environment;
                               //   contains factory function
                               //   (e.g., browserTransport)
  expected: {
    status: "ok" | "err";
    value?: Val;
    journal: Array<YieldEntry | CloseEntry>;
  };
}
````

The `env` record supplies the `browserTransport` factory
function. When the binding expression `browserTransport(config)`
is evaluated, the factory returns an `AgentTransportFactory`
that the runtime uses to create the transport instance for the
scope. The `inprocessTransport` pattern provides pre-configured
mock responses through the factory itself, so no separate
`mock_responses` field is needed.

### 2.4 Replay Fixture

````typescript
interface BrowserReplayFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  category: string;
  spec_ref: string;
  description: string;
  type: "browser_replay";
  ir: Expr;
  env: Record<string, Val>;    // contains factory function
  stored_journal: Array<YieldEntry | CloseEntry>;
  expected: {
    status: "ok" | "err";
    value?: Val;
    error_class?: string;
    journal: Array<YieldEntry | CloseEntry>;
  };
}
````

---

## 3. Compiler Acceptance Tests

These tests verify that the compiler accepts valid browser
contract authored forms and produces conforming IR.

| ID | Tier | Rule | Description | Source shape | Expected |
|---|---|---|---|---|---|
| BC-C-001 | Core | §5.2 BT1, §8.1 CR1 | Minimal browser scope: useTransport + useAgent + one navigate call | `scoped(function*() { yield* useTransport(Browser, browserTransport({})); const b = yield* useAgent(Browser); return yield* b.navigate({url:"x"}); })` | Accepted; scope node with one binding key `"browser"`, body contains `Eval("browser.navigate", ...)` |
| BC-C-002 | Core | §5.2 BT1, §8.2 CR3–CR4 | Browser transport with inline configuration | `useTransport(Browser, browserTransport({ headless: false, viewport: { width: 1280, height: 720 } }))` | Accepted; binding metadata contains call expression for `browserTransport` |
| BC-C-003 | Core | §5.2 BT2, §8.3 CR5 | useAgent(Browser) erased from IR | `const browser = yield* useAgent(Browser);` in body after useTransport | Accepted; no useAgent node in IR; handle binding recorded |
| BC-C-004 | Core | §8.3 CR6–CR7 | Multiple browser method calls lower to distinct Evals | Body with navigate, click, content calls | Accepted; body contains `Eval("browser.navigate", ...)`, `Eval("browser.click", ...)`, `Eval("browser.content", ...)` |
| BC-C-005 | Core | §5.2 BT1, BT3 | Browser scope with multiple agent bindings | useTransport for both Browser and Llm; useAgent for both; interleaved method calls | Accepted; two binding keys; body contains both `browser.*` and `llm.*` Evals |
| BC-C-006 | Core | §8.3 CR7 | All seven contract methods compile to correct effect IDs | Body calling navigate, click, fill, content, screenshot, selectPage, closePage | Accepted; seven distinct `Eval("browser.<methodName>", ...)` nodes |
| BC-C-007 | Extended | §8.2 CR4, §6.2 BD6 | browserTransport is compiled as ordinary call, not built-in | `browserTransport({})` in binding expression | Accepted; binding metadata contains `Call(Ref("browserTransport"), ...)`, not a special node |
| BC-C-008 | Extended | §5.2 BT1 | Browser transport with all optional fields | `browserTransport({ headless: true, viewport: {width:800,height:600}, engine:"firefox", launchArgs:["--no-sandbox"] })` | Accepted; binding expression contains full configuration |

---

## 4. Compiler Rejection Tests

These tests verify that the compiler rejects invalid browser
contract authored forms with appropriate diagnostics.

### 4.1 Inherited Handle Restrictions (Blocking Scope §3.7)

The following tests verify that the compiler rejects browser
handle misuse per the `useAgent` handle restrictions defined in
blocking scope specification §3.7 (H1–H4). These restrictions
apply to all `useAgent` handle bindings. They are compile-time
rules that prevent authored source from treating an erased
binding as a runtime value. The browser handle is not a runtime
capability token — it is a compile-time construct that the
compiler uses to resolve method calls to `Eval` nodes and then
discards. These tests confirm that the compiler enforces the
same restrictions for `useAgent(Browser)` as for any other
`useAgent` binding.

| ID | Tier | Rule | Description | Source shape | Violated rule |
|---|---|---|---|---|---|
| BC-C-020 | Core | Blocking scope §3.7 H1 | Browser handle passed as effect argument | `yield* llm.sample({ browser: browser })` | H1 (inherited) |
| BC-C-021 | Core | Blocking scope §3.7 H2 | Browser handle returned from scope | `return browser;` | H2 (inherited) |
| BC-C-022 | Core | Blocking scope §3.7 H3 | Browser handle stored in array | `const arr = [browser];` | H3 (inherited) |
| BC-C-023 | Core | Blocking scope §3.7 H3 | Browser handle stored in object | `const obj = { b: browser };` | H3 (inherited) |
| BC-C-024 | Core | Blocking scope §3.7 H4 | Browser handle conditionally assigned | `let b; if (cond) { b = yield* useAgent(Browser); }` | H4 (inherited) |

> **Note on inheritance.** These tests exercise existing
> blocking scope compiler rules applied to the browser
> contract. They are not browser-specific rules. The browser
> contract specification §8.4 CR8 explicitly states that the
> compiler MUST NOT introduce browser-specific compilation
> rules. These rejections exist because H1–H4 apply to all
> `useAgent` handle bindings uniformly. If the blocking scope
> test plan already exercises H1–H4 for a generic agent
> contract, these tests confirm the same behavior holds for
> the `Browser` contract specifically.

### 4.2 Inherited Setup Violations (Blocking Scope §3.3–§3.6)

These tests verify that the compiler rejects browser scope
setup violations per blocking scope specification §3.3–§3.6.
Browser contract specification §5.2 BT1–BT3 explicitly
identify these as applications of the blocking scope rules
to the browser contract.

| ID | Tier | Rule | Description | Source shape | Violated rule |
|---|---|---|---|---|---|
| BC-C-030 | Core | Browser §5.2 BT2; blocking scope UA3 | useAgent(Browser) without corresponding useTransport | `const b = yield* useAgent(Browser)` with no useTransport(Browser, ...) | UA3 (inherited) |
| BC-C-031 | Core | Browser §5.2 BT1; blocking scope S2 | useTransport(Browser, ...) in body, not setup prefix | useTransport after useAgent or body statement | S2 (inherited) |
| BC-C-032 | Core | Browser §5.2 BT1; blocking scope UT3 | Duplicate useTransport for same contract | Two `useTransport(Browser, ...)` in setup | UT3 (inherited) |
| BC-C-033 | Extended | Browser §8.4 CR8; compiler E010 | Browser method call without yield* | `browser.navigate({url:"x"})` without yield* | E010 (inherited) |

---

## 5. IR Lowering Tests

These tests verify that correctly compiled browser contract
source produces the expected IR structure.

| ID | Tier | Rule | Description | Input | Expected IR shape |
|---|---|---|---|---|---|
| BC-L-001 | Core | §8.2 CR3 | useTransport produces binding metadata | `yield* useTransport(Browser, browserTransport({}))` | Scope node binding metadata contains key `"browser"` mapped to compiled call expression |
| BC-L-002 | Core | §8.3 CR5 | useAgent produces no IR node | `const browser = yield* useAgent(Browser)` | No node in IR corresponds to useAgent; next body statement appears directly |
| BC-L-003 | Core | §8.3 CR6 | browser.navigate lowers to Eval with correct ID | `yield* browser.navigate({ url: "x" })` | `Eval("browser.navigate", compiledArgs)` |
| BC-L-004 | Core | §8.3 CR7 | browser.click lowers to Eval with correct ID | `yield* browser.click({ selector: "#btn" })` | `Eval("browser.click", compiledArgs)` |
| BC-L-005 | Core | §8.3 CR7 | browser.fill lowers to Eval with correct ID | `yield* browser.fill({ selector: "#input", value: "hello" })` | `Eval("browser.fill", compiledArgs)` |
| BC-L-006 | Core | §8.3 CR7 | browser.content lowers to Eval with correct ID | `yield* browser.content()` | `Eval("browser.content", compiledArgs)` |
| BC-L-007 | Core | §8.3 CR7 | browser.screenshot lowers to Eval with correct ID | `yield* browser.screenshot({ fullPage: true })` | `Eval("browser.screenshot", compiledArgs)` |
| BC-L-008 | Core | §8.3 CR7 | browser.selectPage lowers to Eval with correct ID | `yield* browser.selectPage({ page: "page:1" })` | `Eval("browser.selectPage", compiledArgs)` |
| BC-L-009 | Core | §8.3 CR7 | browser.closePage lowers to Eval with correct ID | `yield* browser.closePage({ page: "page:1" })` | `Eval("browser.closePage", compiledArgs)` |
| BC-L-010 | Core | §7.1 OP2, §5.4 | Page identifiers in effect payloads are plain strings | `yield* browser.click({ selector: "#btn", page: "page:1" })` | Compiled args contain string literal `"page:1"` as ordinary data, not a special node |
| BC-L-011 | Extended | §5.3 | Full representative pattern lowers correctly | Full source from §5.3 with Browser + Llm | Scope with two bindings; body contains interleaved `browser.*` and `llm.*` Evals; no useAgent nodes in IR |

---

## 6. Runtime Lifecycle Tests

These tests use hand-constructed browser scope IR to verify
runtime behavior independently of the compiler. They use the
mock browser transport (§1.5).

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| BC-R-010 | Core | RR6–RR7 | Browser transport installed at scope entry | Scope with valid browser binding; body issues one browser.navigate | Effect dispatched through browser transport; YieldEvent recorded |
| BC-R-011 | Core | BD11 | Default page created at launch | Scope body calls browser.content() immediately (no navigate) | Content returned for default page with identifier `"page:0"` |
| BC-R-012 | Core | RR13–RR14 | Transport shut down on normal scope exit | Scope body completes normally | Transport shut down; CloseEvent written |
| BC-R-013 | Core | RR13 | Transport shut down on scope error | Scope body throws an error | Transport shut down; scope Close(err) |
| BC-R-014 | Core | RR13 | Transport shut down on cancellation | Scope cancelled externally | Transport shut down; scope Close(cancelled) |
| BC-R-015 | Core | RR8, BD10 | Browser launch failure reported as initialization error | Mock transport configured to fail on launch | Runtime initialization error; no body execution; no YieldEvents |
| BC-R-016 | Core | RR16 | Shutdown failure does not propagate as workflow error | Mock transport configured to fail on shutdown; body completes normally | Scope result is ok; no error propagation from shutdown |

---

## 7. Browser Operation Tests

These tests verify contract operation semantics using the mock
browser transport. Each test dispatches the operation through a
scoped browser binding using hand-constructed IR.

### 7.1 Navigate

| ID | Tier | Rule | Description | Action | Expected |
|---|---|---|---|---|---|
| BC-O-001 | Core | NAV1–NAV2 | Navigate returns page, status, url | `browser.navigate({ url: "https://example.com" })` | Result: `{ page: "page:0", status: 200, url: "https://example.com" }` |
| BC-O-002 | Core | NAV4 | Navigate sets active page | Navigate, then content() without page param | Content returned from navigated page |
| BC-O-003 | Core | NAV3 | Navigate failure returns error result | Navigate to unreachable URL | Err result with message; catchable in workflow |
| BC-O-004 | Core | OP4 | Navigate with explicit page parameter | Navigate with `page: "page:0"` | Result targets specified page |

### 7.2 Click

| ID | Tier | Rule | Description | Action | Expected |
|---|---|---|---|---|---|
| BC-O-010 | Core | CLK1 | Click returns ok result | `browser.click({ selector: "#btn" })` | Result: `{ ok: true }` |
| BC-O-011 | Core | CLK2 | Click with missing selector returns error | Selector not found | Err result with message |
| BC-O-012 | Core | OP4 | Click on non-active page via page param | `browser.click({ selector: "#btn", page: "page:1" })` | Click targets specified page |

### 7.3 Fill

| ID | Tier | Rule | Description | Action | Expected |
|---|---|---|---|---|---|
| BC-O-020 | Core | FIL1 | Fill returns ok result | `browser.fill({ selector: "#input", value: "hello" })` | Result: `{ ok: true }` |
| BC-O-021 | Core | FIL2 | Fill with invalid selector returns error | Selector not found or not an input | Err result with message |

### 7.4 Content

| ID | Tier | Rule | Description | Action | Expected |
|---|---|---|---|---|---|
| BC-O-030 | Core | CON1–CON3 | Content returns text, url, title | `browser.content()` after navigate | Result: `{ text: "...", url: "https://example.com", title: "Example" }` |
| BC-O-031 | Core | CON2 | Content with format "html" | `browser.content({ format: "html" })` | Result text contains HTML markup |
| BC-O-032 | Core | CON2 | Content with format "text" (default) | `browser.content()` with no format | Result text is visible text, not HTML |
| BC-O-033 | Core | OP4 | Content from specific page via page param | `browser.content({ page: "page:1" })` | Content from specified page, not active page |

### 7.5 Screenshot

| ID | Tier | Rule | Description | Action | Expected |
|---|---|---|---|---|---|
| BC-O-040 | Core | SCR1–SCR2 | Screenshot returns base64 data, mimeType, dimensions | `browser.screenshot()` | Result: `{ data: "...", mimeType: "image/png", width: N, height: N }` |
| BC-O-041 | Extended | SCR1 | Screenshot with fullPage option | `browser.screenshot({ fullPage: true })` | Result height reflects full page |
| BC-O-042 | Extended | SCR1 | Screenshot with jpeg format and quality | `browser.screenshot({ format: "jpeg", quality: 50 })` | Result mimeType is `"image/jpeg"` |

### 7.6 Page Management

| ID | Tier | Rule | Description | Action | Expected |
|---|---|---|---|---|---|
| BC-O-050 | Core | OP5, BD11 | Default page identifier is deterministic string | Scope entry, no navigate | Default page is `"page:0"` |
| BC-O-051 | Core | SEL1 | selectPage changes active page | Navigate (page:0), navigate to new URL creating page:1, selectPage(page:0), content() | Content from page:0 |
| BC-O-052 | Core | SEL2, OP6 | selectPage with invalid page ID returns error | `browser.selectPage({ page: "nonexistent" })` | Err result; not a transport crash |
| BC-O-053 | Core | CLS1, CLS3 | closePage closes page and reports new active | Close page:1 while page:0 exists | Result: `{ ok: true, activePage: "page:0" }` |
| BC-O-054 | Core | CLS2 | closePage on last remaining page returns error | Only one page open; attempt to close it | Err result; page remains open |
| BC-O-055 | Core | OP5 | Page identifiers stable for page lifetime | Navigate, record page ID, navigate again, record page ID | Same page ID returned both times for same page |
| BC-O-056 | Core | OP6 | Operation with closed page ID returns error | Close page:1, then click on page:1 | Err result per OP6 |
| BC-O-057 | Extended | RR18 | Page identifiers follow deterministic scheme | Create three pages via navigations | IDs follow sequential scheme (e.g., page:0, page:1, page:2) |

### 7.7 Error Convention

| ID | Tier | Rule | Description | Action | Expected |
|---|---|---|---|---|---|
| BC-O-060 | Core | ERR1 | Operation error uses standard Err convention | Any failing browser operation | Err result with `message` field |
| BC-O-061 | Core | ERR2 | Operation error is catchable via try/catch | Failing navigate inside try/catch | Catch block receives error; workflow continues |
| BC-O-062 | Core | ERR3 | Transport crash propagates as scope error | Mock transport simulates browser process crash | Scope Close(err); error propagates per blocking scope §7.2 |

### 7.8 Serialization Boundary

| ID | Tier | Rule | Description | Action | Expected |
|---|---|---|---|---|---|
| BC-O-070 | Core | OP2 | Operation inputs are JSON-serializable | All seven operations dispatched | All inputs pass JSON.stringify/parse roundtrip |
| BC-O-071 | Core | OP2 | Operation outputs are JSON-serializable | All seven operations return results | All results pass JSON.stringify/parse roundtrip |
| BC-O-072 | Core | OP5, §4 | Page identifiers are plain strings, not objects | Navigate result page field | `typeof result.page === "string"` |
| BC-O-073 | Core | §1.3 | No Playwright objects in workflow scope | Scope body accesses only results from browser effects | No non-serializable values reach the kernel or journal |

---

## 8. Replay Tests — Completed Scope

These tests verify full replay of browser scopes that
completed during the original execution. All stored results
are served from the journal. No browser interaction occurs.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| BC-RP-001 | Core | RP6–RP7 | Single navigate replays identically | Journal: one navigate YieldEvent + CloseEvent(ok) | Same result value; same journal; status ok |
| BC-RP-002 | Core | RP6–RP7 | Multi-operation sequence replays identically | Journal: navigate + click + fill + content YieldEvents + CloseEvent(ok) | Same result value; same journal; status ok |
| BC-RP-003 | Core | RP3 | Stored results served to kernel, not dispatched | Complete journal; mock transport records dispatch calls | Zero dispatch calls to mock transport during replay |
| BC-RP-004 | Core | RP4 | Transport idle during replay | Complete journal | Mock transport reports zero browser operations executed |
| BC-RP-005 | Core | RP1 | Factory re-evaluated on replay | Complete journal; env contains `browserTransport` | Binding expression evaluated; factory invoked; transport created |
| BC-RP-006 | Core | RP2 | Fresh browser transport instance created on replay | Complete journal | Mock transport instantiation count = 1 for the replay execution |
| BC-RP-007 | Core | RP11 | No extra journal events from replay | Complete journal (N YieldEvents + 1 CloseEvent) | After replay: journal contains exactly the same N+1 events |
| BC-RP-011 | Core | RP6 | Scope with error result replays identically | Journal: navigate YieldEvent + CloseEvent(err) | Same error; same journal; status err |
| BC-RP-012 | Extended | RP7 | Replay of scope with browser + other agent effects | Journal: browser.navigate + llm.sample + browser.click YieldEvents + CloseEvent(ok) | All results replayed correctly; interleaved agent effects handled normally |

---

## 9. Replay Tests — Incomplete Scope

These tests verify the v0.1.0 behavior for incomplete browser
scope replay. When the runtime reaches the journal frontier
(the stored journal ends without a CloseEvent), it transitions
to live dispatch. The fresh browser transport created at replay
start receives the live operations.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| BC-RP-030 | Core | RP8 | Runtime transitions to live dispatch at frontier | Journal: navigate + click YieldEvents, NO CloseEvent; IR body contains navigate + click + content | After replaying navigate and click from journal, content dispatched live to browser transport |
| BC-RP-031 | Core | RP8 | Fresh transport receives live dispatch after frontier | Journal: one navigate YieldEvent, no CloseEvent; IR body contains navigate + click | Navigate result served from journal; click dispatched to fresh browser transport; new YieldEvent recorded for click |
| BC-RP-032 | Core | RP8 | Scope completes normally after frontier transition | Journal: navigate YieldEvent, no CloseEvent; IR body returns after navigate + click | Navigate replayed; click dispatched live; scope completes with ok status and CloseEvent |

---

## 10. Failure Classification Tests

These tests verify that failures are classified per the browser
contract specification's failure taxonomy.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| BC-F-001 | Core | BD10, RR8 | Launch failure on fresh execution is initialization error | Mock transport fails to launch | Initialization error; no body execution; no YieldEvents |
| BC-F-002 | Core | RP12–RP13 | Launch failure on replay is same classification | Replay with complete journal; mock transport fails to launch | Initialization error; classified identically to BC-F-001 |
| BC-F-004 | Core | RP12 | Launch failure on replay is NOT replay divergence | Replay fails at launch | Error does NOT indicate journal corruption or divergence |
| BC-F-006 | Core | ERR2 | Browser operation error is ordinary effect error | Navigate fails with network error | Error catchable in try/catch; workflow may continue |
| BC-F-007 | Core | ERR3 | Transport crash is scope-level error | Browser process crash simulated | Scope Close(err); propagates per blocking scope §7.2 T4–T6 |

---

## 11. Journal Invariant Tests

These tests verify that browser contract usage preserves the
two-event durable stream algebra.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| BC-J-001 | Core | RP11, OP3 | Browser effects produce ordinary YieldEvents | Scope with navigate + click + content | Journal contains three YieldEvents with standard shape |
| BC-J-002 | Core | RP11 | Scope completion produces ordinary CloseEvent | Browser scope completes normally | Journal contains one CloseEvent with standard shape |
| BC-J-003 | Core | RP11 | No descriptor-resolution events in journal | Browser scope with valid descriptor | Journal contains only body-level YieldEvents + CloseEvent; no events for binding evaluation, descriptor resolution, or transport setup |
| BC-J-004 | Core | RP11 | No transport-lifecycle events in journal | Browser scope entry and exit | No journal events correspond to browser launch or shutdown |
| BC-J-005 | Core | RP11 | No page-tracking events in journal | Scope with multiple navigations creating pages | Journal contains only effect YieldEvents and CloseEvent; no page-registry events |
| BC-J-006 | Core | OP3 | Each browser operation journals exactly one YieldEvent | Five browser operations in sequence | Five YieldEvents, each with distinct yieldIndex |
| BC-J-007 | Extended | RP11 | Browser scope inside larger workflow: no event type changes | Outer workflow with non-browser effects before and after browser scope | All events are standard YieldEvents and CloseEvents; no new event types introduced |

---

## 12. Middleware / Scope Interaction Tests

These tests verify that browser effects participate normally in
the scoped middleware and transport binding system.

| ID | Tier | Rule | Description | Setup | Expected |
|---|---|---|---|---|---|
| BC-M-001 | Core | RR12 | Middleware sees browser effect IDs | Scope with Effects.around that records effectId; browser.navigate in body | Middleware receives effectId `"browser.navigate"` |
| BC-M-002 | Core | RR12 | Deny middleware blocks browser effect | Scope with middleware denying `"browser.click"`; body calls click | Click throws denied error; scope terminates with error |
| BC-M-003 | Core | RR12 | Augmentation middleware transforms browser effect data | Scope with middleware that adds a field to navigate params; body calls navigate | Transport receives augmented params |
| BC-M-004 | Core | RR12 | Pass-through middleware does not affect browser effects | Scope with pass-through middleware; body calls navigate + content | Both effects succeed with unmodified results |
| BC-M-005 | Core | RR9 | Browser transport binding inherited from ancestor scope | Outer scope binds Browser; inner scoped block calls browser.navigate (no inner binding) | Navigate dispatched through outer scope's browser transport |
| BC-M-006 | Extended | RR12 | Middleware applies to all browser operation types | Scope with logging middleware; body calls all seven operations | Middleware invoked for each of the seven effect IDs |

---

## 13. Explicit Non-Tests

The following tests are intentionally NOT part of this test
plan. They correspond to behavior deferred in browser contract
specification §11 or to capabilities not included in v0.1.0.

| ID | Deferred item | Spec ref | Why not tested |
|---|---|---|---|
| BC-X-001 | Workflow-visible opaque runtime values | §11.1 | Browser state accessed only through command/response; no opaque values specified |
| BC-X-002 | Dynamic-count browser instances | §11.2 | One browser per scope binding; pool/factory not specified |
| BC-X-003 | Non-agent-like resource coordination | §11.3 | Browser is an agent contract; alternative patterns not specified |
| BC-X-004 | Generalized capability tokens | §11.4 | Page IDs are plain strings; token semantics not specified |
| BC-X-005 | Browser-to-browser coordination | §11.5 | Cross-scope browser identity not specified |
| BC-X-006 | Compile-time descriptor validation | §11.6 | Runtime validation only; compiler does not validate descriptor content |
| BC-X-007 | Browser session persistence across scopes | §11.7 | Each scope entry creates fresh browser; persistence not specified |
| BC-X-008 | Transport implementation internals | §11.8 | Playwright API usage, CDP sessions, process management not specified |
| BC-X-009 | Replay-to-live continuation for incomplete scopes | §11.9 | v0.1.0 transitions to live dispatch at frontier; mid-session crash recovery not supported |
| BC-X-010 | Transport-level reconstruction during replay | §11.9 | Deferred; replay does not re-execute browser operations |
| BC-X-011 | Browser state serialization / checkpoints | §11.9 | No browser state snapshot mechanism specified |
| BC-X-012 | Operation extensibility conformance | §7.10 EXT1–EXT3 | Custom operations beyond the seven required operations are not conformance-tested |
| BC-X-013 | Page-registry bookkeeping during replay | RP5 | v0.1.0 does not require transport-side page-registry reconstruction from replayed results |
| BC-X-014 | Halt at frontier | RP10 | v0.1.0 transitions to live dispatch at frontier rather than halting with recovery_failure |
| BC-X-015 | Page-registry consistency across replay | RR20 | Page-registry state observable from mock transport is not a v0.1.0 conformance requirement |

---

## 14. Coverage Summary

### 14.1 Spec Section Coverage

| Spec section | Test category | Test IDs | Status |
|---|---|---|---|
| §5.1 Contract declaration | Compiler acceptance | BC-C-001, BC-C-006 | Covered |
| §5.2 Scope setup (BT1–BT3, inherited from blocking scope) | Compiler acceptance + rejection | BC-C-001–005, BC-C-030–032 | Covered |
| §5.4 Authored vs compiled vs runtime | IR lowering | BC-L-001–011 | Covered |
| §6.2 Descriptor constructor (BD5–BD6) | IR lowering | BC-C-007, BC-L-001 | Covered |
| §6.3 Descriptor resolution (BD7–BD11) | Runtime lifecycle | BC-R-010–011, BC-R-015 | Covered |
| §7.2 Navigate (NAV1–NAV4) | Operations | BC-O-001–004 | Covered |
| §7.3 Click (CLK1–CLK3) | Operations | BC-O-010–012 | Covered |
| §7.4 Fill (FIL1–FIL2) | Operations | BC-O-020–021 | Covered |
| §7.5 Content (CON1–CON3) | Operations | BC-O-030–033 | Covered |
| §7.6 Screenshot (SCR1–SCR3) | Operations | BC-O-040–042 | Covered |
| §7.7 SelectPage (SEL1–SEL2) | Operations | BC-O-051–052 | Covered |
| §7.8 ClosePage (CLS1–CLS3) | Operations | BC-O-053–054, BC-O-056 | Covered |
| §7.9 Error convention (ERR1–ERR3) | Operations + failure | BC-O-060–062 | Covered |
| §7.1 General rules (OP1–OP6) | Operations + serialization | BC-O-050, BC-O-055–056, BC-O-070–073 | Covered |
| §8.1–8.3 Compiler requirements (CR1–CR7) | Compiler acceptance + IR lowering | BC-C-001–008, BC-L-001–011 | Covered |
| §8.4 No new compiler rules (CR8) | Compiler rejection | BC-C-033 | Covered |
| Blocking scope §3.7 Handle restrictions (H1–H4, inherited) | Compiler rejection | BC-C-020–024 | Covered (inherited rules applied to Browser contract) |
| §9.2 Scope entry (RR4–RR8) | Runtime lifecycle | BC-R-010, BC-R-015 | Covered |
| §9.3 Effect dispatch (RR9–RR12) | Operations + middleware | BC-O-*, BC-M-001–006 | Covered |
| §9.4 Shutdown (RR13–RR16) | Runtime lifecycle | BC-R-012–014, BC-R-016 | Covered |
| §9.5 Page management (RR17–RR20) | Operations | BC-O-050–057 | Covered |
| §10.2 Descriptor re-evaluation (RP1–RP2) | Replay | BC-RP-005–006 | Covered |
| §10.3 Journal replay (RP3–RP4) | Replay | BC-RP-003–004 | Covered |
| §10.4 Completed scope (RP6–RP7) | Replay | BC-RP-001–002, BC-RP-011 | Covered |
| §10.5 Incomplete scope (RP8) | Replay | BC-RP-030–032 | Covered |
| §10.6 No new events (RP11) | Journal invariant | BC-J-001–007 | Covered |
| §10.7 Failure classification (RP12–RP13) | Failure classification | BC-F-001–002, BC-F-004 | Covered |
| §11 Deferred items | Non-tests | BC-X-001–015 | Explicitly excluded |

### 14.2 Test Count Summary

| Category | Core | Extended | Total |
|---|---|---|---|
| Compiler acceptance | 6 | 2 | 8 |
| Compiler rejection — handle (inherited H1–H4) | 5 | 0 | 5 |
| Compiler rejection — setup (inherited S2, UT3, UA3) | 3 | 1 | 4 |
| IR lowering | 10 | 1 | 11 |
| Runtime lifecycle | 7 | 0 | 7 |
| Operations — navigate | 4 | 0 | 4 |
| Operations — click | 3 | 0 | 3 |
| Operations — fill | 2 | 0 | 2 |
| Operations — content | 4 | 0 | 4 |
| Operations — screenshot | 1 | 2 | 3 |
| Operations — page management | 7 | 1 | 8 |
| Operations — error convention | 3 | 0 | 3 |
| Operations — serialization boundary | 4 | 0 | 4 |
| Replay — completed scope | 8 | 1 | 9 |
| Replay — incomplete scope | 3 | 0 | 3 |
| Failure classification | 5 | 0 | 5 |
| Journal invariant | 6 | 1 | 7 |
| Middleware / scope interaction | 5 | 1 | 6 |
| **Total** | **86** | **10** | **96** |

Explicit non-tests: 15

---

## 15. Conformance Rule

An implementation passes browser contract conformance if and
only if:

1. All Core tier compiler acceptance fixtures produce a scope
   node conforming to the expected IR shape with correct
   binding keys and body Eval IDs.

2. All Core tier compiler rejection fixtures produce a
   diagnostic that identifies the violated constraint category.

3. All Core tier IR lowering fixtures produce the expected
   Eval node IDs and binding metadata structure.

4. All Core tier runtime lifecycle fixtures produce the
   expected result status, result value (canonical JSON
   equality), and journal event sequence (canonical JSON
   equality per event).

5. All Core tier operation fixtures produce the expected
   result shapes with correct fields and correct error
   behavior.

6. All Core tier replay fixtures — both completed and
   incomplete scope — produce the expected result status and
   journal event sequence. For completed scopes, mock
   transport observes zero dispatch calls during replay. For
   incomplete scopes, the runtime transitions to live dispatch
   at the journal frontier and the fresh transport receives
   subsequent operations.

7. All Core tier failure classification fixtures produce errors
   with the expected classification (environment failure, not
   divergence).

8. All Core tier journal invariant fixtures produce only
   standard `YieldEvent` and `CloseEvent` entries; no
   unexpected event types appear.

9. All Core tier middleware fixtures demonstrate that browser
   effects flow through the scope-local middleware chain.

10. No Core tier fixture produces an unexpected error, hangs,
    or crashes.

---

## Appendix A: Implementation Notes

> **Non-normative.** The following notes may help implementers
> build a test harness for the browser contract conformance
> plan.

### A.1 Mock transport construction

The mock browser transport should implement a
`MockBrowserTransport` factory (or equivalent) that:

- Returns an `AgentTransportFactory` when invoked with
  configuration
- Maintains an in-memory `Map<string, PageState>` for pages
- Provides pre-configured responses through the
  `inprocessTransport` pattern, where mock results are
  configured at factory creation time
- Exposes counters for dispatch calls, launch calls, and
  shutdown calls for observability in tests

### A.2 Replay fixture construction

Replay fixtures require constructing `stored_journal` entries
with the correct child coroutineId for the browser scope. The
child id follows the deterministic scheme:
`child_id(parent_id, spawn_index)` where `parent_id` is
typically `"root"` and `spawn_index` is `0` for the first
compound-external, giving child id `"root.0"`.

For incomplete scope fixtures, the journal MUST NOT contain a
`CloseEvent` for the browser scope's coroutineId. The expected
v0.1.0 behavior is that the runtime transitions to live
dispatch at the frontier.

### A.3 Cancellation test mechanics

BC-R-014 (cancellation shutdown) requires the test harness to
cancel the browser scope while the body is suspended on an
effect. This follows the same pattern as blocking scope
cancellation tests (SC-T-003): spawn the execution in a
structured scope, halt the parent after the body's first
YieldEvent, and verify transport shutdown and Close(cancelled).
