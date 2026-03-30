# @tisyn/cli

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
