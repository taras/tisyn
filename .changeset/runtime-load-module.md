---
"@tisyn/runtime": minor
---

Add `Runtime` context API with `Runtime.loadModule(specifier, parentURL)` and `Runtime.around(...)` for middleware-interceptable module loading. Export shared default loader (`loadModule`, `isTypeScriptFile`) and error types (`ModuleLoadError`, `UnsupportedExtensionError`, `ModuleNotFoundError`, `LoaderInitError`).
