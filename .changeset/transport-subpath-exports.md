---
"@tisyn/transport": patch
---

Move Node.js-specific transports to subpath exports to fix browser bundling.

- Main entry no longer re-exports `stdioTransport`, `websocketTransport`, `workerTransport`, `ssePostTransport`, `createStdioAgentTransport`, or `createSsePostAgentTransport`
- Each transport is now available via its own subpath: `@tisyn/transport/stdio`, `@tisyn/transport/websocket`, `@tisyn/transport/worker`, `@tisyn/transport/sse-post`, `@tisyn/transport/stdio-agent`, `@tisyn/transport/sse-post-agent`
