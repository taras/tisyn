---
"@tisyn/agent": minor
"@tisyn/ir": minor
"@tisyn/compiler": minor
"@tisyn/runtime": minor
"@tisyn/transport": minor
"@tisyn/kernel": minor
"@tisyn/protocol": minor
"@tisyn/validate": minor
"@tisyn/durable-streams": minor
---

Add `Workflow<T>` public type, `IrInput`/`TypedIrNode` IR exports, `./protocol-server` transport sub-path, and multi-agent chat example with browser acceptance tests.

- `@tisyn/agent`: export `Workflow<T>` type for use in agent declaration files
- `@tisyn/ir`: export `IrInput` and `TypedIrNode` types; fix `Call()` signature and typed IR node construction
- `@tisyn/compiler`: fix codegen for composite declarations, `while` loop Case A bindings, and IR `print()` output
- `@tisyn/runtime`: align `execute()` with single-payload `Eval()` canonical form
- `@tisyn/transport`: add `./protocol-server` sub-path export
