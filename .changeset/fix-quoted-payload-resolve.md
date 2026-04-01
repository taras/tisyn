---
"@tisyn/kernel": patch
---

Fix quoted-payload execution bug where `resolve()` traversed into Quote contents, dispatching nested effects that should remain inert data.

- Quote now strips one layer and returns contents as opaque data without further traversal
- Nested Eval, Ref, or Quote nodes inside quoted payloads are preserved as values by origin/context
