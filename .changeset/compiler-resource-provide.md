---
"@tisyn/compiler": minor
---

Compile authored `resource(function*() { ... })` and `provide(value)` forms to IR.

- `emitResource` validates generator argument, compiles body with provide placement rules (P2–P7)
- `emitProvide` checks `inResourceBody` context, compiles value expression
- Nested `resource()` inside resource bodies rejected at compile time (MVP restriction)
- `ResourceEval` and `ProvideEval` IR builders exported
