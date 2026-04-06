---
"@tisyn/transport": patch
---

Persist the real-browser executor across full document navigations by registering it with Playwright init scripts and re-waiting for executor readiness after durable browser navigations.
