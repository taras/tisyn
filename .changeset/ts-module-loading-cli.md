---
"@tisyn/cli": minor
---

Add first-class TypeScript module loading for descriptor and transport binding modules. CLI bootstrap loading delegates to `@tisyn/runtime`'s shared `loadModule()`, wrapping errors into CLI exit codes.
