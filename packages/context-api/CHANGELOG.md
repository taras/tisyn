# @tisyn/context-api

## 0.15.0

### Minor Changes

- 29707e6: New in-repo package `@tisyn/context-api` — a workspace vendor
  of `@effectionx/context-api` PR #215
  (`feat/context-api-custom-groups`, commit `7b570a9`).
  Implements middleware composition with user-declared groups,
  per-group append/prepend ordering, and Effection-scope
  inheritance. MIT-licensed, preserving upstream attribution.

  Tisyn's `@tisyn/effects`, `@tisyn/agent`, and `@tisyn/runtime`
  consume this package instead of the previous
  `@effectionx/context-api` pkg.pr.new preview URL. No
  behavior change in the public Tisyn API or observable
  middleware/replay semantics.
