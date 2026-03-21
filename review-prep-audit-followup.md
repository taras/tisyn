# Review Prep: Audit Follow-Up Patch

Date: 2026-03-21
Repo: `/Users/tarasmankovski/Repositories/cowboyd/tisyn`
Branch: `add-compound-concurrency`

## Scope

Prepared review guidance for the current uncommitted patch touching:

- `packages/conformance/src/fixtures.ts`
- `packages/conformance/src/harness.ts`
- `packages/ir/src/guards.ts`
- `packages/kernel/src/canonical.ts`
- `packages/kernel/src/eval.ts`
- `packages/runtime/src/execute.ts`
- `packages/runtime/src/replay.test.ts`

This pass used the refined audit assessment as the review baseline.

## Status Summary

No blocking issues found in the current patch.

The changes are consistent with the refined audit:

- `Eval.id === ""` remains rejected.
- extra-field rejection was removed, which matches the downgrade from bug to spec gap.
- divergence is now returned from `execute()` as an error result while still persisting `Close(err)`.
- compound effect env attachment now uses a wrapper instead of spread, removing key-collision risk.
- the conformance harness now compares canonical event encodings rather than field-by-field slices.
- canonical string behavior was not changed; only a clarifying comment was added.

## Review Checkpoints

### 1. Validation policy

Observed in `packages/ir/src/guards.ts`:

- `eval` still rejects empty string ids:
  - `typeof value["id"] !== "string" || value["id"] === ""`
- extra-field rejection was removed for `eval`, `quote`, `ref`, and `fn`

Assessment:

- This matches the refined audit.
- No regression on the confirmed `Eval.id` bug.
- No new tests should claim extra fields are malformed unless the spec decision changes.

### 2. Divergence handling

Observed in `packages/runtime/src/execute.ts`:

- `driveKernel()` still persists `Close(err)` before re-throwing `DivergenceError`
- public `execute()` now catches `DivergenceError` and returns:
  - `{ result: { status: "err", error: { name: "DivergenceError", ... } }, journal }`

Observed in `packages/runtime/src/replay.test.ts`:

- replay divergence tests now assert returned error results instead of thrown exceptions

Assessment:

- This is a good API cleanup.
- The fatal journaling behavior is preserved.
- The public surface is now consistent with other runtime failures.

### 3. Compound env wrapper

Observed in `packages/kernel/src/eval.ts`:

- compound external descriptors now emit:
  - `{ __tisyn_inner: inner, __tisyn_env: env }`

Observed in `packages/runtime/src/execute.ts`:

- compound interception unwraps that structure immediately and uses:
  - `compoundData.__tisyn_inner.exprs`
  - `compoundData.__tisyn_env`

Assessment:

- This removes the previous collision risk from `{ ...(inner as object), __env: env }`.
- The wrapper is still internal to the orchestration boundary.
- No behavior change was detected in the targeted tests.

### 4. Harness strictness

Observed in `packages/conformance/src/harness.ts`:

- journal comparison now uses canonical byte comparison
- `<any>` sentinel handling is limited to expected error messages

Assessment:

- This strengthens the harness in the intended direction.
- The sentinel logic is narrow enough to avoid masking structural mismatches.
- It keeps the expected error `name` unchanged and only substitutes the message.

### 5. Fixture set alignment

Observed in `packages/conformance/src/fixtures.ts`:

- removed `NEG_022` extra-field rejection fixture
- added `KERN_050` for construct field ordering
- added `DET_002` for sorted resolve keys

Assessment:

- This matches the refined audit priorities.
- The fixture set no longer encodes the downgraded extra-field issue as mandatory conformance.

### 6. Canonical string behavior

Observed in `packages/kernel/src/canonical.ts`:

- no behavior change
- only a comment explaining the current `JSON.stringify` choice and the possible spec/conformance mismatch

Assessment:

- Correct to leave behavior unchanged until the spec question is settled.

## Verification Run

Executed successfully:

- `pnpm --filter @tisyn/ir test`
- `pnpm --filter @tisyn/runtime test`
- `pnpm --filter @tisyn/conformance test`
- `pnpm build`

Results:

- `@tisyn/ir`: 322 tests passed
- `@tisyn/runtime`: 33 tests passed
- `@tisyn/conformance`: 12 tests passed
- TypeScript build passed

## What To Re-Check During Final Review

- confirm no additional edits reintroduce extra-field conformance tests
- confirm no later patch changes `race` error-selection behavior without resolving the spec inconsistency
- confirm no wrapper keys like `__tisyn_inner` leak outside runtime compound orchestration
- confirm any future harness sentinel expansion stays limited to explicit wildcard cases

## Suggested Review Outcome

If the patch stays in its current shape, this is ready for normal code review rather than audit triage.

Primary review focus should be:

- clarity of comments around spec inconsistency for `race`
- whether `DivergenceError` return-shape should be documented in runtime API docs/tests beyond replay
- whether the new conformance fixtures should be expanded further in a follow-up
