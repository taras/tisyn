---
"@tisyn/cli": minor
---

Decouple browser/WebSocket ingress from agent transport creation. `startServer()` now returns `LocalServerBinding` with a connection stream instead of raw `WebSocketServer`. Add `loadLocalBinding()` that prefers `createBinding()` over `createTransport()` for local/inprocess modules. Reorder Phase D startup so server starts before transport installation, enabling `bindServer()` hooks to wire connection handling before workflows execute.
