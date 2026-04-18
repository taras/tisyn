---
"@tisyn/spec": minor
---

BREAKING: authoring helpers are PascalCase again — `Spec`, `Section`, `Rule`,
`Relationship`, `OpenQuestion`, `ErrorCode`, `Concept`, `Invariant`, `Term`,
`TestPlan`, `TestPlanSection`, `TestCategory`, `TestCase`, `CoverageEntry`.
Replaces the lowercase helpers (`spec`, `section`, …) shipped earlier in the
v2 realignment. Consumers must update call sites with a case-only rename;
there is no lowercase alias bridge.
