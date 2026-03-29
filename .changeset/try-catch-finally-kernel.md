---
"@tisyn/kernel": minor
---

Implement `"try"` evaluation in the kernel. Supports catch clauses (with optional binding), finally clauses (with optional `finallyPayload` binding to the body outcome value), and correct propagation of non-catchable errors. `EffectError` moved from `@tisyn/runtime` into `@tisyn/kernel` and re-exported for downstream use. `isCatchable` helper determines which errors a `try` node may catch.
