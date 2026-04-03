# Tisyn Browser Contract — Conformance Test Plan

**Version:** 0.3.0
**Tests:** Tisyn Browser Contract Specification 0.3.0
**Status:** Draft

---

## 1. Test Plan Scope

This test plan defines conformance criteria for the browser
contract as specified in the Tisyn Browser Contract
Specification v0.3.0. It covers:

- capability composition in both in-process and real-browser modes
- execute envelope semantics and error propagation
- navigate operation semantics and error propagation
- transport lifecycle management
- compiler acceptance of the browser contract authored form
- runtime scope orchestration and replay semantics

---

## 2. Test Suites

### 2.1 Transport Tests (`browser.test.ts`)

#### 2.1.1 Capability Composition — In-Process Mode

| ID | Test | Validates |
|----|------|-----------|
| BC-T-001 | Installed local capability is available to incoming IR | §5.1, §5.3 |
| BC-T-002 | Multiple capabilities compose correctly | §5.3 |
| BC-T-003 | Uninstalled capability causes local error | §5.3 |
| BC-T-004 | No host fallback for missing local capabilities | §5.3 |

#### 2.1.2 Capability Composition — Real-Browser Mode

| ID | Test | Validates |
|----|------|-----------|
| BC-T-005 | Executor bundle injected via page.addScriptTag | §5.4, §6.3 |
| BC-T-006 | Transport drives page.evaluate with IR, returns result | §4.1, §6.2 |
| BC-T-007 | Executor error propagates as thrown Error | §6.4 |

#### 2.1.3 Execute Envelope

| ID | Test | Validates |
|----|------|-----------|
| BC-T-008 | Returns JSON-serializable result value | §4.1 |
| BC-T-009 | Executor error throws Error with message | §6.4 |
| BC-T-010 | Each execute call gets fresh capability scope | §5.3 |

#### 2.1.4 Transport Lifecycle

| ID | Test | Validates |
|----|------|-----------|
| BC-T-011 | Factory creates transport in in-process mode | §6.2 |
| BC-T-012 | In-process mode does not touch Playwright | §6.2 |
| BC-T-013 | Real-browser mode shuts down browser on scope exit | §6.3 |

#### 2.1.5 Navigate Operation — Real-Browser Mode

| ID | Test | Validates |
|----|------|-----------|
| BC-T-014 | navigate({ url }) calls page.goto(url) | §4.1, §6.2 |
| BC-T-015 | navigate then execute operate on same implicit page | §6.3 |
| BC-T-016 | navigate error propagates | §6.4 |

#### 2.1.6 Navigate Operation — In-Process Mode

| ID | Test | Validates |
|----|------|-----------|
| BC-T-017 | navigate throws in in-process mode | §6.2 |

### 2.2 Compiler Acceptance Tests (`browser-contract.test.ts`)

| ID | Test | Validates |
|----|------|-----------|
| BC-C-001 | Browser scope compiles with navigate and execute | §4.3 |
| BC-C-003 | useAgent(Browser) erased from IR | §4.3 |
| BC-C-008 | browser.navigate lowers to Eval | §4.3 |
| BC-C-007 | browserTransport() compiled as ordinary call | §4.3 |

### 2.3 Runtime Scope Tests (`browser-scope.test.ts`)

#### 2.3.1 Fresh Execution

| ID | Test | Validates |
|----|------|-----------|
| BC-R-001 | Scope with browser binding executes body | §6.2 |
| BC-R-002 | browser.execute effect dispatches through bound transport | §4.1, §6.2 |
| BC-R-007 | browser.navigate effect dispatches through bound transport | §4.1, §6.2 |
| BC-R-003 | Multiple browser.execute effects dispatch sequentially | §4.1, §7.1 |

#### 2.3.2 Replay

| ID | Test | Validates |
|----|------|-----------|
| BC-R-004 | Completed scope replays without live dispatch | §7.2 |
| BC-R-005 | Completed replay produces same result value | §7.2 |
| BC-R-006 | Incomplete scope transitions to live dispatch at frontier | §7.3 |
| BC-R-008 | Completed replay covers both navigate and execute | §7.2 |

---

## 3. Test Infrastructure

### 3.1 Transport Tests

- **In-process composition:** Uses `browserTransport({ capabilities })` with test agents (`Calc`, `Greet`) defined via `localCapability()`. No Playwright mock needed.
- **Real-browser mode:** Mocks `playwright-core` at module level. `page.evaluate` returns predetermined result envelopes. `page.addScriptTag`, `page.waitForFunction`, and `page.goto` are verified.
- **Navigate tests:** Use `Browser.navigate({ url })` via `invoke`. Real-browser tests verify `mockPage.goto` calls. In-process test verifies thrown error.

### 3.2 Compiler Acceptance Tests

Uses `compileOne()` from `@tisyn/compiler` with an ambient browser contract preamble containing `NavigateParams`, `ExecuteParams`, and `declare function Browser()` with both operations. Helpers extract scope nodes and eval nodes from the IR. Tests live in the transport package.

### 3.3 Runtime Scope Tests

Uses `execute()` from `@tisyn/runtime` with hand-constructed scope IR and `inprocessTransport(browserAgent, handlers)` via env. Browser agent declaration includes both `navigate` and `execute` operations. Replay tests use `InMemoryStream` with stored/partial journals. Tests live in the transport package.

---

## 4. Coverage Summary

| Area | Tests | Status |
|------|-------|--------|
| In-process composition | 4 | Implemented |
| Real-browser composition | 3 | Implemented |
| Execute envelope | 3 | Implemented |
| Transport lifecycle | 3 | Implemented |
| Navigate — real-browser | 3 | Implemented |
| Navigate — in-process | 1 | Implemented |
| Compiler acceptance | 4 | Implemented |
| Runtime fresh execution | 4 | Implemented |
| Runtime replay | 4 | Implemented |
| **Total** | **29** | |
