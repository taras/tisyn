---
"@tisyn/runtime": minor
---

Add config resolution helpers — `applyOverlay` (entrypoint merge-by-id), `resolveEnv` (env variable resolution with type coercion), `resolveConfig` (full pipeline: overlay → validate → resolve → project), and `projectConfig` (strips descriptor metadata, produces runtime-ready shape).
