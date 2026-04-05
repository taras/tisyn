---
"@tisyn/cli": minor
---

Add first-class TypeScript module loading for descriptor modules and transport binding modules via `tsx/esm/api`. Supports `.ts`, `.mts`, `.cts` alongside `.js`, `.mjs`, `.cjs` at all CLI module-loading sites (descriptors, workflow modules, local/inprocess transport bindings). The `tsx` loader is imported lazily so JavaScript-only workflows pay no startup cost.
