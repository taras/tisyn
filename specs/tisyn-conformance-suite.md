# Tisyn Conformance Test Suite Specification

**Version:** 1.1.0
**Suite version field:** `"suite_version": "2.0.0"`
**Tests against:** Language Spec 1.0.0, Compiler Spec 1.1.0,
Kernel Spec 1.0.0, Agent Spec 1.1.0
**Status:** Normative

---

## 1. Purpose and Scope

### 1.1 What Conformance Means

A Tisyn implementation is conforming if and only if:

1. Its observable outputs match this specification for ALL
   applicable test cases at its claimed level.
2. Two conforming implementations at the same level produce
   identical observable outputs when substituted for each
   other at any layer boundary.

### 1.2 Observable Outputs

The ONLY outputs tested are:

- Final result value (canonical JSON).
- Journal event sequence (canonical JSON, ordered).
- Wire message transcripts (structural JSON).
- Error type (exact string from §4.1).

Error message text is NEVER compared.

### 1.3 Out of Scope

Performance, transport internals, internal data structures,
error message wording, agent operation logic.

---

## 2. Conformance Levels and Tiers

### 2.1 Levels

| Level | Name | Covers |
|-------|------|--------|
| 1 | IR | Validation, malformed IR rejection |
| 2 | Compiler | Deterministic compilation, correct lowering |
| 3 | Kernel | Evaluation, resolve, replay, concurrency, cancellation, journaling |
| 4 | Agent | Protocol compliance, error handling, cancellation |

Level 3 implies Level 1. All others independent.

### 2.2 Tiers

**Core:** MUST pass for conformance at the test's level.

**Extended:** Failure MUST be reported but does not prevent
a conformance claim. Extended tests cover edge cases and
cross-implementation traps.

### 2.3 Interoperability

Requires Level 3 + Level 4 Core from two implementations.

---

### 2.4 Terminology

| Canonical term | Definition |
|---------------|-----------|
| **event** | A single journal entry (Yield or Close) |
| **effect** | An external operation the kernel yields to the execution layer |
| **result** | The EventResult of an event or the final value of an execution |
| **execution** | A complete run: validation → evaluation → journal |
| **coroutine** | A unit of concurrent evaluation with its own event stream |
| **descriptor** | The `{id, data}` object the kernel yields when suspending |
| **description** | The `{type, name}` object stored in journal Yield events |
| **fixture** | A complete test case JSON file |

---

## 3. Execution Model

### 3.1 What an Execution Is

An **execution** is the complete processing of one IR tree:

```
1. Validate(IR)     → accept or MalformedIR
2. Evaluate(IR, env) → result + journal
```

Step 1 MUST complete before step 2 begins. If step 1 fails,
step 2 MUST NOT occur and no journal is produced.

### 3.2 Coroutine State Machine

Each coroutine has exactly one state at any point:

```
CREATED → RUNNING → COMPLETED
                  → FAILED
                  → CANCELLED
            ↕
         SUSPENDED
```

**Transitions:**

| From | To | Trigger | Event emitted |
|------|----|---------|--------------|
| CREATED | RUNNING | Coroutine begins evaluation | (none) |
| RUNNING | SUSPENDED | Kernel yields external effect | (none — Yield emitted on resume) |
| SUSPENDED | RUNNING | Effect result received | Yield event |
| RUNNING | COMPLETED | Evaluation finishes with value | Close(ok) |
| RUNNING | FAILED | Runtime error | Close(err) |
| RUNNING | CANCELLED | Cancel signal received | Close(cancelled) |
| SUSPENDED | CANCELLED | Cancel signal while waiting | Close(cancelled) — NO Yield |

**Invalid transitions (MUST NOT occur):**

- Any transition FROM a terminal state (COMPLETED, FAILED,
  CANCELLED).
- SUSPENDED → COMPLETED (must resume first).
- CREATED → any terminal state (must run first).
- Emitting any event after Close.

### 3.3 Effect Evaluation

When the kernel encounters an external Eval node:

```
1. Resolve arguments via resolve(data, env).
2. Construct descriptor: { id, data: resolved }.
3. Coroutine → SUSPENDED.
4. Execution layer dispatches to agent (or feeds replay result).
5. Result received → coroutine → RUNNING.
6. Yield event emitted (persist-before-resume).
7. Evaluation continues with result value.
```

### 3.4 Journal Emission Rule

Events are emitted at exactly these points:

- **Yield:** emitted when a SUSPENDED coroutine resumes
  (transition SUSPENDED → RUNNING). Contains the effect's
  description and the result received.
- **Close:** emitted when a coroutine enters a terminal state
  (RUNNING → COMPLETED/FAILED/CANCELLED).

No other events exist. No events are emitted during CREATED
or during RUNNING between yields.

---

## 4. Normative Definitions

### 4.1 Error Taxonomy

| Error type | Cause | When | Close? | Replay behavior |
|-----------|-------|------|--------|----------------|
| `MalformedIR` | Invalid IR structure | Validation | NO journal | N/A |
| `UnboundVariable` | Ref lookup failed | Runtime | Close(err) | Re-raised from stored result |
| `NotCallable` | Call on non-Fn | Runtime | Close(err) | Re-raised from stored result |
| `ArityMismatch` | Wrong arg count | Runtime | Close(err) | Re-raised from stored result |
| `TypeError` | Invalid operand type | Runtime | Close(err) | Re-raised from stored result |
| `DivisionByZero` | div/mod by zero | Runtime | Close(err) | Re-raised from stored result |
| `ExplicitThrow` | throw node evaluated | Runtime | Close(err) | Re-raised from stored result |
| `EffectError` | Agent returned error | Runtime | Close(err) | Stored Yield(err) re-delivered |
| `DivergenceError` | Replay mismatch | Runtime (replay) | Close(err) | N/A (is the replay failure) |

**Normative constraints:**

- Implementations MUST map to these exact strings.
- `MalformedIR` MUST occur at validation; all others MUST
  occur at runtime.
- Every runtime error MUST produce exactly one Close(err).
- `MalformedIR` MUST NOT produce any events.

**Partial journal before error:** Zero or more Yield events
MAY precede Close(err). If effects executed successfully before
the error, their Yield events MUST appear in the journal.

**Kernel error `name`:** MUST match the canonical type from
this table. Agent errors copy `name` verbatim from agent
response. Kernel MUST NOT modify agent error `name`.

### 4.2 IR Validation Model

Two phases, both MUST complete before evaluation begins.

**Phase 1 — Structural:** Grammar conformance. Missing fields,
wrong types, extra fields on IR nodes → MalformedIR.

**Phase 2 — Semantic:** Single-Quote rule, positions table.

**NOT validated:** Ref binding. Unbound Refs → UnboundVariable
at runtime. Implementations MUST NOT reject IR for unbound Refs.

**Scope:** Recursive over entire tree. MUST NOT skip subtrees.

**Boundary enforcement:** Implementations MUST NOT defer Phase 1
or Phase 2 checks to runtime. Implementations MUST NOT perform
runtime checks (Ref binding, type checks) during validation.

**Failure:** Either phase fails → entire IR rejected. No
evaluation. No journal.

### 4.3 Canonical Encoding

These rules define a single deterministic encoding for every
JSON value. Two values are **canonically equal** if and only
if their canonical encodings produce byte-identical UTF-8
sequences.

No normalization, re-parsing, or transformation is permitted
before comparison. Comparison is raw byte equality.

**Rules:**

1. Lexicographic key order (Unicode code point), every level.
2. No whitespace between any tokens.
3. Numbers per §4.7.
4. Strings: shortest RFC 8259 escapes for control characters,
   literal UTF-8 for all others. `/` MUST NOT be escaped.
   Non-ASCII MUST NOT use `\uXXXX` escapes.
5. IR nodes: only specified fields. Extra fields → MalformedIR.

Unless explicitly overridden, ALL comparisons in this spec
use canonical equality.

### 4.4 Coroutine Identity

Root: `"root"`. Child N of parent P: `P + "." + N` (0-indexed).
MUST match `^root(\.\d+)*$`. Never reused. Spawn order = `exprs`
array order.

### 4.5 Journal Event Schema

Events MUST contain exactly the specified fields. Events MUST
be emitted in canonical key order. The harness compares emitted
bytes directly with no normalization.

**Yield:** `{"coroutineId":"…","description":{"name":"…","type":"…"},"result":{…},"type":"yield"}`

**Close:** `{"coroutineId":"…","result":{…},"type":"close"}`

**Success result:** `{"status":"ok","value":<Val>}` — `value`
MUST always be present. Void → `null`.

**Error result:** `{"error":{"message":"…"},"status":"err"}` —
`message` MUST be a non-empty string. MAY include `"name"`
(string, also non-empty). MUST NOT include other fields.

**Cancelled result:** `{"status":"cancelled"}` — no other fields.

### 4.6 Effect Descriptor Mapping

`parseEffectId(id)`: split on first dot. `"a.b.c"` → type
`"a"`, name `"b.c"`. Undotted → both equal full ID. Total,
deterministic, one-way.

### 4.7 Canonical Numbers

Reference: ECMAScript `Number.prototype.toString()`. Shortest
round-trip form. Integers without decimal/exponent. Negative
zero → `0`. Exponents: lowercase `e`, explicit sign, no leading
zeros. NaN and Infinity MUST NOT appear.

### 4.8 Correlation IDs

Format: `"{taskId}:{yieldIndex}"`. Byte-equal comparison. No
normalization.

### 4.9 Object Traversal

ALL key iteration MUST use lexicographic order (Unicode code
point). Implementations MUST NOT rely on host-language iteration
order.

---

## 5. Determinism Guarantees

### 5.1 Core Invariant

> Given identical IR and identical effect results, the kernel
> MUST produce identical journal events in identical order and
> an identical final result. Every time. Across implementations.

This is the foundational guarantee. All other guarantees derive
from it.

### 5.2 What This Requires

- No randomness in evaluation.
- No timing-dependent behavior.
- No host-language-dependent ordering.
- No uninitialized state.
- Deterministic object key traversal (§4.9).
- Deterministic coroutine ID generation (§4.4).
- Deterministic cancellation ordering (§8.3).

### 5.3 Replay Corollary

> Given identical IR and a stored journal, replay MUST produce
> identical results and an identical final journal (stored events
> + any new events). The replay cursor advances deterministically.

### 5.4 Compiler Corollary

> `compile(source)` MUST produce byte-identical canonical JSON
> on every invocation for the same source.

---

## 6. Global Invariants

The following invariants MUST hold for every conforming
execution. Each is independently testable.

**I1.** Every coroutine produces exactly one Close event.

**I2.** No events are emitted for a coroutine after its Close.

**I3.** Every Yield event corresponds to exactly one effect
that was dispatched and resolved.

**I4.** Coroutine IDs are unique within an execution and
match `^root(\.\d+)*$`.

**I5.** Journal events are append-only. Never modified,
deleted, or reordered after emission.

**I6.** Yield events are durably persisted before the kernel
resumes (persist-before-resume).

**I7.** Replay consumes stored events in positional order per
coroutine. No search, no reordering.

**I8.** The journal is the sole source of truth for execution
history. No side channel exists.

---

## 7. Formal Test Case Schemas

Every fixture is a JSON object conforming to one of the schemas
below. Harness implementations MUST validate fixtures against
these schemas before execution.

### 7.1 Common Fields

```
{
  "id":            string,              // REQUIRED. Unique. Stable.
  "suite_version": "2.0.0",            // REQUIRED. Must match spec.
  "tier":          "core"|"extended",   // REQUIRED.
  "level":         1|2|3|4,            // REQUIRED.
  "category":      string,              // REQUIRED. Dot-separated.
  "spec_ref":      string,              // REQUIRED. E.g. "kernel.5.1".
  "description":   string,              // REQUIRED. One sentence.
  "timeout_ms":    integer              // OPTIONAL. Default: 30000.
}
```

**`suite_version` handling:** If the fixture's `suite_version`
is a higher MAJOR than the runner supports, the runner MUST
skip the fixture and report "unsupported version." If the
MAJOR matches but MINOR is higher, the runner MUST attempt
execution (forward-compatible within a major version). Unknown
fields in fixtures MUST be ignored by the runner.

### 7.2 Evaluation Test

```
{
  …common,
  "type": "evaluation",
  "ir":   <Expr>,                    // REQUIRED.
  "env":  { string: Val },           // REQUIRED. Values only.
  "expected_result": EventResult,    // REQUIRED.
  "expected_journal": [ Event, … ]   // REQUIRED. ≥1 Close.
}
```

**Normative:** Implementations MUST produce the exact
`expected_result` and `expected_journal` for this fixture.

### 7.3 Effect Test

```
{
  …common,
  "type": "effect",
  "ir":   <Expr>,
  "env":  { string: Val },
  "effects": [
    { "descriptor": { "id": string, "data": <Val> },
      "result": EventResult,
      "coroutineId": string              // OPTIONAL. If present,
    }, …                                 // harness verifies coroutine.
  ],                                 // REQUIRED. Ordered.
  "expected_result": EventResult,    // REQUIRED.
  "expected_journal": [ Event, … ]   // REQUIRED.
}
```

For concurrent fixtures, the `effects` array lists effects in
spawn-order scheduling order (§8.4). If `coroutineId` is
present on an effect entry, the harness MUST verify that the
suspension occurred on that coroutine; mismatch → FAIL.

### 7.4 Replay Test

```
{
  …common,
  "type": "replay",
  "ir":   <Expr>,
  "env":  { string: Val },
  "stored_journal": [ Event, … ],   // REQUIRED. May be empty.
  "live_effects": [
    { "descriptor": {…}, "result": EventResult }, …
  ],                                 // REQUIRED. May be empty.
  "expected_result": EventResult,    // REQUIRED.
  "expected_journal": [ Event, … ]   // REQUIRED. Full journal.
}
```

### 7.5 Negative Test

**Validation error** (no journal):

```
{
  …common,
  "type": "negative_validation",
  "ir":   <MalformedExpr>,           // REQUIRED.
  "expected_error": "MalformedIR"    // REQUIRED. Always this.
}
```

No `env`, `effects`, or `expected_journal`. Absence is normative.

**Runtime error** (journal produced):

```
{
  …common,
  "type": "negative_runtime",
  "ir":   <Expr>,
  "env":  { string: Val },           // REQUIRED.
  "effects": [ … ],                 // REQUIRED. May be empty.
  "expected_error": "<ErrorType>",   // REQUIRED. From §4.1.
  "expected_journal": [ Event, … ]   // REQUIRED. Ends with Close(err).
}
```

### 7.6 Protocol Test

```
{
  …common,
  "type": "protocol",
  "transcript": [ { "direction": "agent→host"|"host→agent",
                     "message": <JSON-RPC> }, … ],
  "expected_outcome": string
}
```

### 7.7 Compiler Test

```
{
  …common,
  "type": "compiler",
  "source": string,
  "expected_ir": <Expr>              // Canonical JSON. Byte match.
}
```

### 7.8 The `"<any>"` Sentinel

When `error.message` in an expected event is `"<any>"`, the
harness MUST accept any non-empty string. Applies ONLY to
`error.message`. MUST NOT appear in any other field.

**Harness implementation rule:** The harness MUST apply
sentinel logic ONLY when comparing the `error.message` field
of an expected event AND the expected value is exactly the
5-character string `<any>`. The harness MUST NOT apply sentinel
logic to any other field. If the actual output's `error.message`
is the literal string `"<any>"`, the harness MUST accept it
(it is a valid non-empty string).

---

## 8. Concurrency Ordering

### 8.1 Within a Coroutine

Totally ordered. Yields in emission order. Close after all
Yields. Exactly one Close per coroutine (invariant I1).

### 8.2 Across Coroutines (Normal Execution)

Sibling events MAY interleave. Causal constraints:

**C1.** Child C's Close MUST precede parent P's Close.

**C2.** For `all`: child C's Close MUST precede parent P's
Yield that reports the `all` result.

**C3.** Within a coroutine: emission order preserved.

A total ordering is **valid** iff it satisfies C1, C2, C3.
Any violation is a conformance FAIL.

### 8.3 Cancellation (Deterministic)

`Close(cancelled)` events in reverse creation order. This is
deterministic (§5.2). Cancellation fixtures use exact ordering.

### 8.4 Scheduling Order (Normative)

For conformance testing, the execution layer MUST evaluate
concurrent children in **spawn order** (child 0 first, child 1
second, etc.). Each child runs until it suspends or completes
before the next child begins its first evaluation step.

After all children have completed their initial evaluation
step, subsequent scheduling rounds continue in spawn order:
child 0 resumes first, runs until it suspends or completes,
then child 1, etc.

This defines a deterministic round-robin schedule. The
consequence: given identical IR and identical effect results,
the journal event ordering is fully deterministic, including
for concurrent fixtures. Implementations MAY use different
scheduling internally, but their observable output MUST match
the output that spawn-order scheduling would produce.

---

## 9. Conformance Runner

### 9.1 Architecture

```
Fixture → Runner → Implementation Under Test → Output → Comparator → PASS/FAIL
```

### 9.2 Execution Procedures

**Evaluation test:**

```
1. Parse fixture. Validate against §7.2.
2. Provide IR and env to kernel.
3. Kernel evaluates. No suspensions expected.
4. If kernel suspends: FAIL ("unexpected effect").
5. Collect: result, journal.
6. Compare result: canonical equality with expected_result.
7. Compare journal: per §9.4.
```

**Effect test:**

```
1. Parse fixture. Validate against §7.3.
2. Provide IR and env to kernel.
3. Let N = 0.
4. On each kernel suspension:
   a. If N ≥ len(effects): FAIL ("more effects than expected").
   b. Compare descriptor: canonical equality on "id" AND "data".
   c. If mismatch: FAIL ("unexpected descriptor at N").
   d. Feed effects[N].result to kernel.
   e. N = N + 1.
5. After completion:
   a. If N < len(effects): FAIL ("fewer effects than expected").
   b. Compare result.
   c. Compare journal: per §9.4.
```

**Replay test:**

```
1. Parse fixture. Validate against §7.4.
2. Provide IR to validator. Validator MUST accept (the
   fixture IR is well-formed). If validator rejects: FAIL
   ("replay fixture IR is malformed").
3. Initialize replay state per §10.1.
4. Provide IR, env, and replay state to kernel.
   The kernel MUST validate IR before evaluation, exactly
   as in live execution (§3.1). Replay MUST NOT exempt
   IR from validation.
5. Kernel drives replay internally (§10.1 algorithm).
6. For live effects post-replay: harness feeds from
   live_effects using same descriptor matching as effect test.
7. Collect result, full journal.
8. Compare result. Compare journal: per §9.4.
```

**Negative validation test:**

```
1. Parse fixture. Validate against §7.5.
2. Provide IR to validator.
3. Validator MUST reject with expected_error type.
4. MUST NOT produce any events.
5. If accepts, wrong type, or events emitted: FAIL.
```

**Negative runtime test:**

```
1. Parse fixture. IR passes validation.
2. Provide IR and env to kernel.
3. Feed effects as in effect test.
4. Kernel MUST raise expected_error.
5. Compare journal (MUST end with Close(err) for root).
```

**Protocol test:**

```
1. Parse fixture.
2. Execute transcript entries in order.
3. Compare implementation messages (structural equality).
4. Verify expected_outcome.
```

### 9.3 Timeout

No output within `timeout_ms` (default 30000) → FAIL.

### 9.4 Journal Comparison

Mode selection from fixture:

- Flat `expected_journal` array, category NOT "cancellation"
  → **sequential mode**.
- `expected_journal` has `"partial_order": true`
  → **concurrent mode**.
- Category contains "cancellation"
  → **cancellation mode** (exact sequential).

**Sequential mode:**

```
compare_sequential(actual, expected):
  1. len(actual) ≠ len(expected) → FAIL.
  2. For i = 0 .. len(expected)-1:
     a. A = canonical(actual[i]).
     b. E = canonical(expected[i]).
     c. Apply "<any>" sentinel (§7.8).
     d. A ≠ E → FAIL at position i.
  3. PASS.
```

**Concurrent mode:**

```
compare_concurrent(actual, expected_po):
  PO = expected_po.per_coroutine  // {coroutineId: [Event]}
  C  = expected_po.causal         // [[before_ref, after_ref]]

  1. Partition actual by coroutineId → groups.
  2. For each K in PO:
     a. K not in groups → FAIL ("missing coroutine").
     b. compare_sequential(groups[K], PO[K]).
     c. Remove K from groups.
  3. groups not empty → FAIL ("unexpected coroutine").
  4. For each [A_ref, B_ref] in C:
     a. Resolve refs to global positions in actual.
     b. position(A) ≥ position(B) → FAIL ("causal violation").
  5. PASS.
```

### 9.5 Runner Edge Cases

- **Extra events:** FAIL. MUST NOT silently ignore.
- **Fewer events:** FAIL.
- **Event after Close:** FAIL ("event after Close for C").
- **Multiple Close:** FAIL ("duplicate Close for C").

### 9.6 Runner Invariant Checks

Before journal comparison, the runner MUST independently verify
on the ACTUAL journal:

- **I1 check:** Every coroutineId that appears in the journal
  has exactly one Close event.
- **I2 check:** No events appear for a coroutineId after that
  coroutine's Close event.

Violation of either is FAIL, regardless of whether the actual
journal matches the expected journal. This prevents a buggy
fixture from masking non-conformant behavior.

---

## 10. Replay Conformance

### 10.1 Replay Algorithm

Replay is **per-coroutine** and **positional**.

```
STATE:
  cursors: { coroutineId → integer }  // 0-indexed per coroutine
  closes:  { coroutineId → bool }

INITIALIZE(stored_journal):
  For each event in stored_journal:
    If Yield: append to per-coroutine yield list, preserving order.
    If Close: set closes[coroutineId] = true.
  Set all cursors to 0.

ON_KERNEL_YIELD(coroutine C, descriptor D):
  Let cursor = cursors[C]  (default 0 if absent)
  Let yields_C = stored yields for C (empty if absent)

  IF cursor < len(yields_C):                         // CASE 1
    Let stored = yields_C[cursor]
    Let yielded = parseEffectId(D.id)
    IF yielded.type = stored.description.type
       AND yielded.name = stored.description.name:
      Feed stored.result to kernel.
      cursors[C] = cursor + 1.
      Emit Yield event with stored.description and stored.result.
    ELSE:
      RAISE DivergenceError.                         // D1

  ELSE IF closes[C] exists:                          // CASE 2
    RAISE DivergenceError.                           // D2

  ELSE:                                              // CASE 3
    Transition to live dispatch for coroutine C.
    (Harness feeds from live_effects.)
```

Coroutine C absent from stored_journal → cursor=0, yields
empty, closes absent → immediate CASE 3 (live dispatch).

**ON_COROUTINE_CANCEL during replay:** Cancellation during
replay follows live execution rules (§3.2). The coroutine
transitions to CANCELLED and emits Close(cancelled).
Unconsumed stored Yields for C are abandoned — NOT a
divergence. The cursor for C is never advanced further.

**Close events during replay:** Close events are NOT replayed
from the stored journal. They are emitted by the coroutine
state machine (§3.2) independently. Stored Close events
serve ONLY as sentinels for D2 divergence detection. They
are never "consumed" or "replayed."

**Replay Yield description source:** In CASE 1, the emitted
Yield event MUST use the stored event's `description` and
`result` fields byte-for-byte. Implementations MUST NOT
recompute the description from the current descriptor
during replay.

### 10.2 Description Matching

Compares ONLY `type` and `name`. Arguments are NOT compared.
This is normative.

**Rationale:** Code evolves between original execution and
replay. Arguments change; effect identity stays the same.

**Consequence:** Same type+name, different data → match
succeeds, stored result returned. NOT a divergence. Tested
by REPLAY-050.

### 10.3 Positional Matching

Per-coroutine cursor. Starts at 0. Advances by 1. NO search.

Two identical `(a.op, a.op)` → first stored feeds first
yielded, second feeds second. Tested by REPLAY-053.

### 10.4 Exhaustive Divergence Conditions

ALL conditions that produce DivergenceError:

| ID | Condition | Trigger |
|----|-----------|---------|
| D1 | Description mismatch | Stored Yield at cursor has different type or name |
| D2 | Continue past Close | All stored Yields consumed AND Close exists for C |

NOT a divergence:

| Condition | Why |
|-----------|-----|
| Argument difference | §10.2: only type+name compared |
| Fewer effects than stored | Execution simply shorter; journal contains only produced events |
| Unknown coroutine | Treated as fresh (CASE 3) |

**End-of-execution rule:** When a coroutine reaches a terminal
state during replay, any unconsumed stored Yields for that
coroutine are silently abandoned. The implementation MUST NOT
treat unconsumed stored Yields as an error or divergence.
Stored Yields for coroutine IDs the kernel never spawns are
silently ignored.

---

## 11. Journal Conformance

### 11.1 Allowed Event Sequences

For each coroutine, the event sequence MUST match:

```
Yield* Close
```

Zero or more Yields followed by exactly one Close. No events
after Close. No Close without a coroutine having started.

### 11.2 Ordering Invariants

**O1.** Events totally ordered by global position.
**O2.** Per-coroutine Yields in emission order.
**O3.** Per-coroutine Close after all Yields.
**O4.** Child Close before parent's consuming event.
**O5.** Parent Close after all children's Closes.

### 11.3 Yield-Effect Correspondence

Every Yield event corresponds to exactly one effect that was:
dispatched to an agent (live execution) OR fed from the stored
journal (replay). No Yield exists without a corresponding
effect evaluation.

### 11.4 Append-Only

Events are appended. Never modified, deleted, or reordered.

---

## 12. Test Suite: Core Fixtures

All fixtures are **Core** unless marked [Extended]. Each is a
complete, machine-readable JSON object. All fixtures are
**normative**: implementations MUST produce the exact
`expected_result` and `expected_journal` specified.

### 12.1 KERN-001: Integer literal

```json
{
  "id": "KERN-001", "suite_version": "2.0.0",
  "tier": "core", "level": 3,
  "category": "kernel.evaluation.literal",
  "spec_ref": "kernel.1.4", "type": "evaluation",
  "description": "Integer literal evaluates to itself",
  "ir": 42,
  "env": {},
  "expected_result": {"status":"ok","value":42},
  "expected_journal": [
    {"coroutineId":"root","result":{"status":"ok","value":42},"type":"close"}
  ]
}
```

### 12.2 KERN-020: Let binding

```json
{
  "id": "KERN-020", "suite_version": "2.0.0",
  "tier": "core", "level": 3,
  "category": "kernel.evaluation.let",
  "spec_ref": "kernel.5.1", "type": "evaluation",
  "description": "Let binds value and makes it available in body",
  "ir": {"tisyn":"eval","id":"let","data":{"tisyn":"quote","expr":{
    "body":{"tisyn":"ref","name":"x"},"name":"x","value":1}}},
  "env": {},
  "expected_result": {"status":"ok","value":1},
  "expected_journal": [
    {"coroutineId":"root","result":{"status":"ok","value":1},"type":"close"}
  ]
}
```

### 12.3 KERN-034: Call-site resolution

```json
{
  "id": "KERN-034", "suite_version": "2.0.0",
  "tier": "core", "level": 3,
  "category": "kernel.evaluation.call",
  "spec_ref": "kernel.5.5", "type": "evaluation",
  "description": "Free variable resolves at call site, not definition site",
  "ir": {"tisyn":"eval","id":"let","data":{"tisyn":"quote","expr":{
    "body":{"tisyn":"eval","id":"let","data":{"tisyn":"quote","expr":{
      "body":{"tisyn":"eval","id":"let","data":{"tisyn":"quote","expr":{
        "body":{"tisyn":"eval","id":"call","data":{"tisyn":"quote","expr":{
          "args":[],"fn":{"tisyn":"ref","name":"f"}}}},
        "name":"x","value":2}}},
      "name":"f","value":{"tisyn":"fn","params":[],"body":{"tisyn":"ref","name":"x"}}}}},
    "name":"x","value":1}}},
  "env": {},
  "expected_result": {"status":"ok","value":2},
  "expected_journal": [
    {"coroutineId":"root","result":{"status":"ok","value":2},"type":"close"}
  ]
}
```

### 12.4 KERN-080: Sequential effects

```json
{
  "id": "KERN-080", "suite_version": "2.0.0",
  "tier": "core", "level": 3,
  "category": "kernel.effects.sequential",
  "spec_ref": "kernel.4.3", "type": "effect",
  "description": "Two effects in let chain, second uses first result",
  "ir": {"tisyn":"eval","id":"let","data":{"tisyn":"quote","expr":{
    "body":{"tisyn":"eval","id":"let","data":{"tisyn":"quote","expr":{
      "body":{"tisyn":"ref","name":"b"},
      "name":"b",
      "value":{"tisyn":"eval","id":"x.step2","data":[{"tisyn":"ref","name":"a"}]}}}},
    "name":"a",
    "value":{"tisyn":"eval","id":"x.step1","data":[]}}}},
  "env": {},
  "effects": [
    {"descriptor":{"id":"x.step1","data":[]},"result":{"status":"ok","value":10}},
    {"descriptor":{"id":"x.step2","data":[10]},"result":{"status":"ok","value":20}}
  ],
  "expected_result": {"status":"ok","value":20},
  "expected_journal": [
    {"coroutineId":"root","description":{"name":"step1","type":"x"},"result":{"status":"ok","value":10},"type":"yield"},
    {"coroutineId":"root","description":{"name":"step2","type":"x"},"result":{"status":"ok","value":20},"type":"yield"},
    {"coroutineId":"root","result":{"status":"ok","value":20},"type":"close"}
  ]
}
```

### 12.5 KERN-071: Opaque value rule

```json
{
  "id": "KERN-071", "suite_version": "2.0.0",
  "tier": "core", "level": 3,
  "category": "kernel.resolve.opaque",
  "spec_ref": "kernel.3.2", "type": "effect",
  "description": "Value resembling Ref in env not resolved further",
  "ir": {"tisyn":"eval","id":"x.check","data":[{"tisyn":"ref","name":"v"}]},
  "env": {"v": {"tisyn":"ref","name":"y"}},
  "effects": [
    {"descriptor":{"id":"x.check","data":[{"tisyn":"ref","name":"y"}]},"result":{"status":"ok","value":true}}
  ],
  "expected_result": {"status":"ok","value":true},
  "expected_journal": [
    {"coroutineId":"root","description":{"name":"check","type":"x"},"result":{"status":"ok","value":true},"type":"yield"},
    {"coroutineId":"root","result":{"status":"ok","value":true},"type":"close"}
  ]
}
```

### 12.6 REPLAY-010: Partial replay to live

```json
{
  "id": "REPLAY-010", "suite_version": "2.0.0",
  "tier": "core", "level": 3,
  "category": "kernel.replay.partial",
  "spec_ref": "kernel.10.2", "type": "replay",
  "description": "First two effects replayed, third dispatched live",
  "ir": {"tisyn":"eval","id":"let","data":{"tisyn":"quote","expr":{
    "body":{"tisyn":"eval","id":"let","data":{"tisyn":"quote","expr":{
      "body":{"tisyn":"eval","id":"let","data":{"tisyn":"quote","expr":{
        "body":{"tisyn":"ref","name":"c"},
        "name":"c",
        "value":{"tisyn":"eval","id":"x.step3","data":[{"tisyn":"ref","name":"b"}]}}}},
      "name":"b",
      "value":{"tisyn":"eval","id":"x.step2","data":[{"tisyn":"ref","name":"a"}]}}}},
    "name":"a",
    "value":{"tisyn":"eval","id":"x.step1","data":[]}}}},
  "env": {},
  "stored_journal": [
    {"coroutineId":"root","description":{"name":"step1","type":"x"},"result":{"status":"ok","value":10},"type":"yield"},
    {"coroutineId":"root","description":{"name":"step2","type":"x"},"result":{"status":"ok","value":20},"type":"yield"}
  ],
  "live_effects": [
    {"descriptor":{"id":"x.step3","data":[20]},"result":{"status":"ok","value":30}}
  ],
  "expected_result": {"status":"ok","value":30},
  "expected_journal": [
    {"coroutineId":"root","description":{"name":"step1","type":"x"},"result":{"status":"ok","value":10},"type":"yield"},
    {"coroutineId":"root","description":{"name":"step2","type":"x"},"result":{"status":"ok","value":20},"type":"yield"},
    {"coroutineId":"root","description":{"name":"step3","type":"x"},"result":{"status":"ok","value":30},"type":"yield"},
    {"coroutineId":"root","result":{"status":"ok","value":30},"type":"close"}
  ]
}
```

### 12.7 REPLAY-020: Divergence detection

```json
{
  "id": "REPLAY-020", "suite_version": "2.0.0",
  "tier": "core", "level": 3,
  "category": "kernel.replay.divergence",
  "spec_ref": "kernel.10.4", "type": "replay",
  "description": "Different effect type than stored produces DivergenceError",
  "ir": {"tisyn":"eval","id":"b.op2","data":[]},
  "env": {},
  "stored_journal": [
    {"coroutineId":"root","description":{"name":"op1","type":"a"},"result":{"status":"ok","value":1},"type":"yield"}
  ],
  "live_effects": [],
  "expected_result": {"status":"err","error":{"message":"<any>","name":"DivergenceError"}},
  "expected_journal": [
    {"coroutineId":"root","result":{"status":"err","error":{"message":"<any>","name":"DivergenceError"}},"type":"close"}
  ]
}
```

### 12.8 NEG-020: Validation error

```json
{
  "id": "NEG-020", "suite_version": "2.0.0",
  "tier": "core", "level": 1,
  "category": "ir.validation.malformed",
  "spec_ref": "kernel.12.1", "type": "negative_validation",
  "description": "Eval node with numeric id is malformed",
  "ir": {"tisyn":"eval","id":42,"data":1},
  "expected_error": "MalformedIR"
}
```

### 12.9 NEG-001: Runtime error

```json
{
  "id": "NEG-001", "suite_version": "2.0.0",
  "tier": "core", "level": 3,
  "category": "kernel.negative.unbound",
  "spec_ref": "kernel.2.4", "type": "negative_runtime",
  "description": "Ref to unbound name produces UnboundVariable",
  "ir": {"tisyn":"ref","name":"unbound"},
  "env": {},
  "effects": [],
  "expected_error": "UnboundVariable",
  "expected_journal": [
    {"coroutineId":"root","result":{"status":"err","error":{"message":"<any>","name":"UnboundVariable"}},"type":"close"}
  ]
}
```

### 12.10 DET-005: Float serialization

```json
{
  "id": "DET-005", "suite_version": "2.0.0",
  "tier": "core", "level": 3,
  "category": "kernel.determinism.numbers",
  "spec_ref": "kernel.11.5", "type": "evaluation",
  "description": "0.1 + 0.2 serialized as 0.30000000000000004",
  "ir": {"tisyn":"eval","id":"add","data":{"tisyn":"quote","expr":{"a":0.1,"b":0.2}}},
  "env": {},
  "expected_result": {"status":"ok","value":0.30000000000000004},
  "expected_journal": [
    {"coroutineId":"root","result":{"status":"ok","value":0.30000000000000004},"type":"close"}
  ]
}
```

### 12.11 KERN-014: Short-circuit suppression

```json
{
  "id": "KERN-014", "suite_version": "2.0.0",
  "tier": "core", "level": 3,
  "category": "kernel.evaluation.shortcircuit",
  "spec_ref": "kernel.5.10", "type": "evaluation",
  "description": "And with falsy left does not dispatch right-side effect",
  "ir": {"tisyn":"eval","id":"and","data":{"tisyn":"quote","expr":{
    "a":false,
    "b":{"tisyn":"eval","id":"a.op","data":[]}}}},
  "env": {},
  "expected_result": {"status":"ok","value":false},
  "expected_journal": [
    {"coroutineId":"root","result":{"status":"ok","value":false},"type":"close"}
  ]
}
```

---

## 13. Test Index

Tests marked [E] are Extended; all others Core.

| Category | IDs | Tier |
|----------|-----|------|
| IR validation | IR-001–051 | Core (IR-041 [E]) |
| Compiler | COMP-001–033, COMP-ERR-001–007 | Core |
| Kernel evaluation | KERN-001–015, 020–035, 040–047 | Core |
| Kernel construct/types | KERN-050, 060–064 | Core |
| Kernel resolve | KERN-070–072 | Core |
| Kernel effects | KERN-080–081 | Core |
| Replay | REPLAY-001–053 | Core |
| Concurrency | CONC-001–023 | Core |
| Agent protocol | PROTO-001–033 | Core |
| Agent extended | PROTO-040–051 | [E] |
| Determinism | DET-001–007 | Core |
| Negative | NEG-001–032 | Core |
| Journal ordering | JOUR-001–004 | Core |
| Journal extended | JOUR-005 | [E] |

---

## 14. Canonical Comparison

### 14.1 Single Rule

ALL comparisons use canonical byte equality (§4.3) unless
explicitly stated otherwise. Compute canonical encoding, compare
bytes. Identical → equal. Any difference → not equal.

No normalization permitted.

### 14.2 Exception

Wire messages (§7.6): structural JSON equality. This is the
ONLY exception in the entire specification.

---

## 15. Pass/Fail

### 15.1 Pass

ALL of: result matches, journal matches (per §9.4), protocol
messages match (structural), negative tests produce expected
error, no edge case violations (§9.5).

### 15.2 Fail

ANY of: different result, different journal, unexpected
descriptor, wrong error type, error when none expected, no
error when expected, extra events, fewer events, event after
Close, duplicate Close, timeout.

### 15.3 No Partial Credit

All Core tests at level N → conformant at N.

---

## 16. Agent Transport Independence

Protocol tests MUST NOT depend on timing, batching, or chunk
boundaries.

**Cancellation race invariant:** if `cancelling` set before
Yield written → NO Yield emitted. Only Close(cancelled).

---

## 17. Compiler Conformance

`compile(source)` N times → N byte-identical canonical JSON.
Output MUST satisfy §4.2 and §4.3.

---

## 18. Interoperability

```
1. Compile S with A → IR_A. Compile S with B → IR_B.
2. canonical(IR_A) === canonical(IR_B).
3. Evaluate IR_A with Kernel A, effects R → J_AA.
4. Evaluate IR_A with Kernel B, effects R → J_AB.
5. J_AA === J_AB (per §9.4).
```

---

## 19. Versioning and Compatibility

### 19.1 Spec Version

Every fixture MUST include `"suite_version": "2.0.0"`.

### 19.2 Compatibility Rules

**Backward:** Fixtures from version X.Y.Z MUST pass on any
runner supporting version X.*.* where * ≥ Y (within same
major).

**Forward:** Runners MUST skip fixtures with higher MAJOR.
Runners MUST attempt fixtures with same MAJOR, higher MINOR
(ignoring unknown fields).

### 19.3 Fixture Immutability

Published fixtures are immutable. Corrections add new fixtures
with new IDs; old fixtures marked `deprecated: true` but MUST
still pass.

---

## 20. Harness Requirements

1. Parse fixtures. Validate against schemas (§7).
2. Check `suite_version` compatibility (§19).
3. Execute per procedure (§9.2).
4. Compare per mode (§9.4).
5. Detect edge cases (§9.5).
6. Verify invariants (§9.6).
7. Support `"<any>"` sentinel in `error.message` only.
8. Report pass/fail per test with comparison detail.
9. Report Core vs Extended separately.
10. Enforce timeouts.
11. Support all seven test types.

---

## 21. Non-Conformance Examples

The following describe incorrect implementations that might
appear to pass. Each is non-conforming.

**NC-1: Lexical scoping.** Resolves Fn free variables at
definition site instead of call site. Fails KERN-034 (expects
2, lexical produces 1).

**NC-2: Runtime validation.** Checks single-Quote rule during
evaluation instead of validation. May produce journal events
before rejecting malformed IR. Any journal event from a
validation error is non-conforming.

**NC-3: Search-based replay.** Scans stored journal for
matching Yield instead of positional cursor. Fails REPLAY-053
(two identical effects get nondeterministic result assignment).

**NC-4: Argument-dependent replay.** Compares effect arguments
during replay. Fails REPLAY-050 (same type+name, different
args must match).

**NC-5: Non-canonical key order.** Emits events with keys in
insertion order. Byte-different from canonical. All journal
comparison fails.

**NC-6: Host-language iteration.** Uses Go's random map order
or unsorted object keys. Non-deterministic construct field
evaluation. Fails KERN-050, DET-002.

**NC-7: Forward cancellation order.** Cancels children 0→N
instead of N→0. Wrong Close(cancelled) order. Fails CONC-021.

**NC-8: Missing null for void.** Omits `value` field on void
success: `{"status":"ok"}` instead of `{"status":"ok","value":null}`.
Byte-different. All void-result tests fail.

**NC-9: Agent error name injection.** Adds `"name":"EffectError"`
to agent errors that didn't include name. Byte-different Yield
events.

**NC-10: Replay skips validation.** Bypasses IR validation
during replay. Accepts malformed IR on restart after code
change.
