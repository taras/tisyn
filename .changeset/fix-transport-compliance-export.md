---
"@tisyn/transport": patch
---

Remove `transportComplianceSuite` from main entry to avoid requiring vitest at runtime.

- The compliance suite (which imports vitest) is no longer re-exported from `@tisyn/transport`
- Added `@tisyn/transport/compliance` subpath export for test authors who need it
