# @tisyn/cli

## 0.6.4

### Patch Changes

- Updated dependencies [6c83c81]
  - @tisyn/runtime@0.17.0
  - @tisyn/transport@0.17.0
  - @tisyn/compiler@0.17.0
  - @tisyn/ir@0.17.0
  - @tisyn/durable-streams@0.17.0

## 0.6.3

### Patch Changes

- Updated dependencies [f4012af]
- Updated dependencies [f4012af]
- Updated dependencies [f4012af]
  - @tisyn/durable-streams@0.16.0
  - @tisyn/runtime@0.16.0
  - @tisyn/transport@0.16.0
  - @tisyn/compiler@0.16.0
  - @tisyn/ir@0.16.0

## 0.6.2

### Patch Changes

- Updated dependencies [4766e26]
- Updated dependencies [0f255bf]
- Updated dependencies [43e8c48]
- Updated dependencies [969d91f]
- Updated dependencies [33c6391]
- Updated dependencies [dde36c6]
- Updated dependencies [2037b6b]
- Updated dependencies [29707e6]
- Updated dependencies [e7d62c6]
- Updated dependencies [51d11f5]
- Updated dependencies [4766e26]
  - @tisyn/compiler@0.15.0
  - @tisyn/runtime@0.15.0
  - @tisyn/transport@0.15.0
  - @tisyn/ir@0.15.0
  - @tisyn/durable-streams@0.15.0

## 0.6.1

### Patch Changes

- Updated dependencies [c792d86]
- Updated dependencies [c792d86]
  - @tisyn/runtime@0.14.0
  - @tisyn/transport@0.14.0
  - @tisyn/compiler@0.14.0
  - @tisyn/ir@0.14.0
  - @tisyn/durable-streams@0.14.0

## 0.6.0

### Minor Changes

- a779cb7: Support `journal.file(...)` at runtime. `tsn` now opens a file-backed journal instead of failing when a descriptor configures file journaling, and it reports a configuration error only when the resolved file path is empty.

### Patch Changes

- Updated dependencies [a779cb7]
- Updated dependencies [db46668]
  - @tisyn/durable-streams@0.13.0
  - @tisyn/runtime@0.13.0
  - @tisyn/compiler@0.13.0
  - @tisyn/transport@0.13.0
  - @tisyn/ir@0.13.0

## 0.5.0

### Minor Changes

- c5ad446: Migrate CLI to rooted import-graph pipeline with runtime binding support

  - `tsn run` now executes source workflows through the rooted import graph, compiling the selected export and its transitive helper bindings together
  - Selecting a missing export now fails clearly with exit code 2 (`E-GRAPH-002`)
  - `generate` and `build` now use `roots` instead of the legacy single-file source assembly path
  - The legacy `input` config field is rejected with a clear migration error pointing to `roots`
  - Config validation now checks that `roots` is a non-empty string array and that output paths are writable

### Patch Changes

- Updated dependencies [c5ad446]
- Updated dependencies [9801960]
  - @tisyn/compiler@0.12.0
  - @tisyn/transport@0.12.0
  - @tisyn/runtime@0.12.0
  - @tisyn/ir@0.12.0
  - @tisyn/durable-streams@0.12.0

## 0.4.0

### Minor Changes

- 12c9cfa: Rename EventResult status from `"err"` to `"error"` for clarity. Preserve error name through catch/rethrow by changing `errorToValue()` to return structured `{ message, name }` and making `Throw` recognize structured error values.

### Patch Changes

- Updated dependencies [46200b6]
- Updated dependencies [12c9cfa]
- Updated dependencies [37bbb63]
  - @tisyn/compiler@0.11.0
  - @tisyn/runtime@0.11.0
  - @tisyn/transport@0.11.0
  - @tisyn/ir@0.11.0
  - @tisyn/durable-streams@0.11.0

## 0.3.1

### Patch Changes

- ae8d61c: Enforce curly braces on all control flow statements.
- Updated dependencies [d918311]
- Updated dependencies [ae8d61c]
- Updated dependencies [ae02508]
- Updated dependencies [ae02508]
- Updated dependencies [7004d09]
  - @tisyn/transport@0.10.0
  - @tisyn/compiler@0.10.0
  - @tisyn/config@0.10.1
  - @tisyn/ir@0.10.0
  - @tisyn/runtime@0.10.0
  - @tisyn/durable-streams@0.10.0

## 0.3.0

### Minor Changes

- 34533e6: Decouple browser/WebSocket ingress from agent transport creation. `startServer()` now returns `LocalServerBinding` with a connection stream instead of raw `WebSocketServer`. Add `loadLocalBinding()` that prefers `createBinding()` over `createTransport()` for local/inprocess modules. Reorder Phase D startup so server starts before transport installation, enabling `bindServer()` hooks to wire connection handling before workflows execute.
- f7c4d57: `tsn run` can compile `.ts` workflow sources at runtime; bare `Fn` IR nodes are auto-invoked via `Call` for execution
- 9a4ba47: Add first-class TypeScript module loading for descriptor and transport binding modules. CLI bootstrap loading delegates to `@tisyn/runtime`'s shared `loadModule()`, wrapping errors into CLI exit codes.

### Patch Changes

- e6696fb: Forward resolved per-agent config to `createBinding()` for local/inprocess transport modules
- Updated dependencies [e6696fb]
- Updated dependencies [e6696fb]
- Updated dependencies [34533e6]
- Updated dependencies [f7c4d57]
- Updated dependencies [8d82f9c]
  - @tisyn/config@0.10.0
  - @tisyn/runtime@0.9.0
  - @tisyn/transport@0.9.0
  - @tisyn/compiler@0.9.0
  - @tisyn/ir@0.9.0
  - @tisyn/durable-streams@0.9.0

## 0.2.0

### Minor Changes

- 8eb99d9: Add `tsn run` and `tsn check` commands with full startup lifecycle including descriptor loading, input schema flag derivation, transport/server installation, and config-aware workflow execution.
- 7ad2031: Make `tsn run` expose resolved descriptor config to workflows through `Config.useConfig(Token)` while keeping invocation inputs separate from workflow config.

### Patch Changes

- Updated dependencies [7ad2031]
- Updated dependencies [38d9ffc]
- Updated dependencies [8eb99d9]
- Updated dependencies [6b2a66a]
- Updated dependencies [7ad2031]
- Updated dependencies [38d9ffc]
- Updated dependencies [7ad2031]
- Updated dependencies [8eb99d9]
- Updated dependencies [6b2a66a]
- Updated dependencies [38d9ffc]
  - @tisyn/compiler@0.9.0
  - @tisyn/config@0.9.0
  - @tisyn/ir@0.9.0
  - @tisyn/runtime@0.9.0
  - @tisyn/transport@0.9.0
  - @tisyn/durable-streams@0.9.0

## 0.1.8

### Patch Changes

- Updated dependencies [b515855]
  - @tisyn/compiler@0.8.0

## 0.1.7

### Patch Changes

- Updated dependencies [f074970]
  - @tisyn/compiler@0.7.0

## 0.1.6

### Patch Changes

- Updated dependencies [e4dc3d9]
  - @tisyn/compiler@0.6.0

## 0.1.5

### Patch Changes

- @tisyn/compiler@0.5.2

## 0.1.4

### Patch Changes

- @tisyn/compiler@0.5.1

## 0.1.3

### Patch Changes

- Updated dependencies [e71915d]
- Updated dependencies [9786a15]
- Updated dependencies [d4a051a]
  - @tisyn/compiler@0.5.0

## 0.1.2

### Patch Changes

- @tisyn/compiler@0.4.0

## 0.1.1

### Patch Changes

- Updated dependencies [473f5ab]
- Updated dependencies [4375b0a]
  - @tisyn/compiler@0.3.0

## 0.1.0

### Minor Changes

- 0ae5309: Add `@tisyn/cli` — the `tsn` command-line tool for generating and building Tisyn workflow modules.

  Two commands: `tsn generate <input>` compiles a single declaration file to a workflow module, and `tsn build` runs config-driven multi-pass generation using a `tisyn.config.ts` file. Built with Effection-native design throughout: all I/O runs inside `Operation<T>` generators via `yield* call()`.
