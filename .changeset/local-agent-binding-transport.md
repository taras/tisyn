---
"@tisyn/transport": minor
---

Add `LocalAgentBinding` and `LocalServerBinding` types as the stable contract for local/inprocess transport modules. `LocalAgentBinding` pairs a transport factory with an optional `bindServer` hook for receiving browser connections. `LocalServerBinding` provides the server address and accepted WebSocket connections as a typed stream. Move `@types/ws` to dependencies for the `WebSocket` type in `LocalServerBinding`.
