---
"@tisyn/cli": minor
---

Support `journal.file(...)` at runtime. `tsn` now opens a file-backed journal instead of failing when a descriptor configures file journaling, and it reports a configuration error only when the resolved file path is empty.
