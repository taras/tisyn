---
"@tisyn/compiler": minor
---

Add `yield* useConfig()` authored form recognition (lowers to `ExternalEval("__config", Q(null))`) and input schema metadata emission (`inputSchemas` export in generated modules).
