# @tisyn/durable-streams

## 0.16.0

### Minor Changes

- f4012af: Add `@tisyn/durable-streams/browser` subpath exporting `DurableStream`, `InMemoryStream`, `ReplayIndex`, and `YieldEntry`. Browser bundles can import from this subpath to avoid pulling `FileStream`'s `node:fs` / `node:path` dependencies transitively.

### Patch Changes

- @tisyn/kernel@0.16.0

## 0.15.0

### Patch Changes

- @tisyn/kernel@0.15.0

## 0.14.0

### Patch Changes

- @tisyn/kernel@0.14.0

## 0.13.0

### Minor Changes

- a779cb7: Add a file-backed durable stream via `FileStream`, exported from the package root. It stores durable events as NDJSON on disk, treats a missing file as an empty journal, and reports malformed lines with path and line-number context for debugging.

### Patch Changes

- @tisyn/kernel@0.13.0

## 0.12.0

### Patch Changes

- @tisyn/kernel@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [12c9cfa]
  - @tisyn/kernel@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [ae8d61c]
  - @tisyn/kernel@0.10.0

## 0.9.0

### Patch Changes

- @tisyn/kernel@0.9.0

## 0.9.0

### Patch Changes

- Updated dependencies [38d9ffc]
  - @tisyn/kernel@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [b515855]
  - @tisyn/kernel@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [f074970]
  - @tisyn/kernel@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [1f58703]
  - @tisyn/kernel@0.6.0

## 0.5.2

### Patch Changes

- @tisyn/kernel@0.5.2

## 0.5.1

### Patch Changes

- @tisyn/kernel@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [e71915d]
- Updated dependencies [9786a15]
  - @tisyn/kernel@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [0393e25]
  - @tisyn/kernel@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [4375b0a]
  - @tisyn/kernel@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [3302f6a]
  - @tisyn/kernel@0.2.0
