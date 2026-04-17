// Public surface of @tisyn/spec-workflows.
//
// The simple acquire → assemble workflows are exported here. The
// corpus-verification pipeline (verify-corpus.ts) and its supporting
// agent/reviewer modules live in sibling files and are invoked directly
// via `tsn run`; they are not re-exported because they are full workflow
// descriptors (wiring helpers that the compiler reachability sweep
// rejects when reached through a library import).

export { draftSpec } from "./draft-spec.ts";
export { amendSpec } from "./amend-spec.ts";
export { reviewSpec } from "./review-spec.ts";
export { draftTestPlan } from "./draft-test-plan.ts";
export { consistencyCheck } from "./consistency-check.ts";
