# Tisyn Browser Contract — Conformance Test Plan

**Version:** 0.2.0
**Tests:** Tisyn Browser Contract Specification 0.2.0
**Status:** Draft

---

## 1. Test Plan Scope

This test plan defines conformance criteria for the browser
contract as specified in the Tisyn Browser Contract
Specification v0.2.0. It covers:

- capability composition in both in-process and real-browser modes
- execute envelope semantics and error propagation
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
| BC-T-012 | Transport shuts down on scope exit | §6.3 |

### 2.2 Compiler Tests (`browser-contract.test.ts`)

| ID | Test | Validates |
|----|------|-----------|
| BC-C-001 | Minimal browser scope compiles with single execute | §4.3 |
| BC-C-003 | useAgent(Browser) erased from IR | §4.3 |
| BC-C-007 | browserTransport() compiled as ordinary call | §4.3 |

### 2.3 Runtime Tests (`browser-scope.test.ts`)

#### 2.3.1 Fresh Execution

| ID | Test | Validates |
|----|------|-----------|
| BC-R-001 | Scope with browser binding executes body | §6.2 |
| BC-R-002 | browser.execute effect dispatches through bound transport | §4.1, §6.2 |
| BC-R-003 | Multiple browser.execute effects dispatch sequentially | §4.1, §7.1 |

#### 2.3.2 Replay

| ID | Test | Validates |
|----|------|-----------|
| BC-R-004 | Completed scope replays without live dispatch | §7.2 |
| BC-R-005 | Completed replay produces same result value | §7.2 |
| BC-R-006 | Incomplete scope transitions to live dispatch at frontier | §7.3 |

---

## 3. Test Infrastructure

### 3.1 Transport Tests

- **In-process composition:** Uses `browserTransport({ capabilities })` with test agents (`Calc`, `Greet`) defined via `localCapability()`. No Playwright mock needed.
- **Real-browser mode:** Mocks `playwright-core` at module level. `page.evaluate` returns predetermined result envelopes. `page.addScriptTag` and `page.waitForFunction` are verified.

### 3.2 Compiler Tests

Uses `compileOne()` with an ambient browser contract preamble containing `ExecuteParams` and `declare function Browser()`. Helpers extract scope nodes and eval nodes from the IR.

### 3.3 Runtime Tests

Uses hand-constructed scope IR with `inprocessTransport(browserAgent, handlers)` via env. Replay tests use `InMemoryStream` with stored/partial journals.

---

## 4. Coverage Summary

| Area | Tests | Status |
|------|-------|--------|
| In-process composition | 4 | Implemented |
| Real-browser composition | 3 | Implemented |
| Execute envelope | 3 | Implemented |
| Transport lifecycle | 2 | Implemented |
| Compiler acceptance | 3 | Implemented |
| Runtime fresh execution | 3 | Implemented |
| Runtime replay | 3 | Implemented |
| **Total** | **21** | |
