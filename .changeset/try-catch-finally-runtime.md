---
"@tisyn/runtime": minor
---

Re-export `EffectError` from the package entry point so consumers can `import { EffectError } from "@tisyn/runtime"` directly. Add integration tests for try/catch/finally at the runtime level, including the `finallyPayload` binding contract and the inner-Try fallback for uncaught-error paths.
