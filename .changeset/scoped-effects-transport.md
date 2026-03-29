---
"@tisyn/transport": minor
---

Add `useTransport()` and middleware enforcement wiring to the transport package.

- New `useTransport(declaration, factory)` operation registers an agent in the scope-local bound-agents registry and installs the remote agent dispatch middleware; transport lifetime is scoped to the calling Effection scope
- `createProtocolServer` now extracts `params.middleware` from execute requests, validates it via `assertValidIr` + `isFnNode` (responding with `InvalidRequest` on failure), and installs an enforcement wrapper via `installEnforcement()` before executing the operation
