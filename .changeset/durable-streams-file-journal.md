---
"@tisyn/durable-streams": minor
---

Add a file-backed durable stream via `FileStream`, exported from the package root. It stores durable events as NDJSON on disk, treats a missing file as an empty journal, and reports malformed lines with path and line-number context for debugging.
