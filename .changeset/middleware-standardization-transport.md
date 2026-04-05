---
"@tisyn/transport": patch
---

Replace the protocol-server enforcement path with ordinary `Effects.around()` middleware for cross-boundary constraints. Remote bindings installed through `useTransport()` / `installRemoteAgent()` now report availability through routing-owned `resolve` middleware instead of a separate bound-agent registry. Transport no longer uses `BoundAgentsContext`.
