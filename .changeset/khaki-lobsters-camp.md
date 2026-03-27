---
"@tisyn/agent": minor
"@tisyn/compiler": minor
"@tisyn/ir": minor
"@tisyn/runtime": patch
"@tisyn/transport": minor
---

This release improves Tisyn's authoring, typing, and transport foundations.

`@tisyn/compiler` adds the `generateWorkflowModule` API for ambient service-factory code generation, strengthens contract-signature validation and type discovery, fixes generated-module correctness, and preserves correct while-loop lowering for per-iteration bindings.

`@tisyn/agent` now exposes a public `Workflow<T>` type and related typing improvements for declared agents and generated workflow modules.

`@tisyn/ir` tightens `IrInput` and `Call()` typing, aligns `Eval()` with a single-payload canonical form, and improves `print()` so generated constructor output remains valid and round-trippable.

`@tisyn/transport` adds a `protocol-server` subpath export to support server-side transport wiring through a stable package entrypoint.

`@tisyn/runtime` includes compatibility updates from the Effection 4.0.2 downgrade and related execution/runtime cleanup.
