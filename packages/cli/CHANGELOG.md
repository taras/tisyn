# @tisyn/cli

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
  - @tisyn/compiler@1.0.0
  - @tisyn/config@0.9.0
  - @tisyn/ir@1.0.0
  - @tisyn/runtime@1.0.0
  - @tisyn/transport@1.0.0
  - @tisyn/durable-streams@1.0.0

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
