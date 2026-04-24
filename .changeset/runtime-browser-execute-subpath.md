---
"@tisyn/runtime": minor
---

Add `@tisyn/runtime/execute` subpath so consumers bundling `execute()` for the browser can import it without pulling the Node-only loader/config code re-exported from the root entrypoint. Closes #106.
