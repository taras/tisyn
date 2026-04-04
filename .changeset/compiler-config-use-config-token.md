---
"@tisyn/compiler": minor
---

Recognize `yield* Config.useConfig(Token)`, lower it to `ExternalEval("__config", Q(null))`, and add `UC1`/`UC2`/`UC3` diagnostics for invalid config access forms.
