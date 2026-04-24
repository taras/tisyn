---
"@tisyn/durable-streams": minor
---

Add `@tisyn/durable-streams/browser` subpath exporting `DurableStream`, `InMemoryStream`, `ReplayIndex`, and `YieldEntry`. Browser bundles can import from this subpath to avoid pulling `FileStream`'s `node:fs` / `node:path` dependencies transitively.
