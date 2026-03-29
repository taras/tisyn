---
"@tisyn/validate": minor
---

Add validation for the `"try"` IR node. Grammar walker checks required fields; semantic pass enforces the single-Quote rule and try-specific constraints: at least one of `catchBody` or `finally` must be present, `catchParam` requires `catchBody`, and `finallyPayload` requires `finally`.
