---
"@tisyn/transport": patch
---

Replace `installEnforcement()` with `Effects.around()` in protocol server for cross-boundary middleware installation. Use `BoundAgentsContext.expect()` and `.set()` in `useTransport()` instead of manual scope access.
