// Type-level regression test: TestCase and TestCategory must be reachable as
// interface types via the public barrel (not merely as the call signature of
// the value constructor). If this file fails to compile, fix the declaration
// merging in constructors.ts or the export in index.ts.
//
// This file is compiled by `tsc --build` (not excluded by tsconfig), so it
// survives vitest's type-erasure transform and locks the public type surface
// at build time. It emits an empty module.

import type { TestCase, TestCategory } from "./index.ts";
import type { TestCase as RawTestCase, TestCategory as RawTestCategory } from "./types.ts";

// The types reached through the barrel must be assignable in both directions
// to the raw interfaces from types.ts — i.e. they are the same shape, not the
// constructor function's call signature.
type _AssertTestCaseEq = TestCase extends RawTestCase
  ? RawTestCase extends TestCase
    ? true
    : never
  : never;
type _AssertTestCategoryEq = TestCategory extends RawTestCategory
  ? RawTestCategory extends TestCategory
    ? true
    : never
  : never;

const _caseOk: _AssertTestCaseEq = true;
const _categoryOk: _AssertTestCategoryEq = true;

export { _caseOk, _categoryOk };
