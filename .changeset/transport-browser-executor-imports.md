---
"@tisyn/transport": patch
---

Switch `@tisyn/transport/browser-executor` internals to import `execute` and `InMemoryStream` from the new `@tisyn/runtime/execute` and `@tisyn/durable-streams/browser` subpaths, so Vite/browser bundles of `createBrowserExecutor` and `createInProcessRunner` no longer drag Node built-ins through transitive root re-exports. No public API change.
