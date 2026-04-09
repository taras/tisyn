---
"@tisyn/kernel": minor
"@tisyn/runtime": minor
"@tisyn/transport": minor
"@tisyn/cli": minor
"@tisyn/conformance": minor
"@tisyn/agent": minor
"@tisyn/compiler": minor
---

Rename EventResult status from `"err"` to `"error"` for clarity. Preserve error name through catch/rethrow by changing `errorToValue()` to return structured `{ message, name }` and making `Throw` recognize structured error values.
