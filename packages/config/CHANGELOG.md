# @tisyn/config

## 0.9.0

### Minor Changes

- 6b2a66a: Add `@tisyn/config` package — pure descriptor constructors (`workflow`, `agent`, `transport`, `env`, `journal`, `entrypoint`, `server`), validation rules V1–V10 with single-pass recursive walk, and `walkConfig`/`collectEnvNodes` tree traversal helpers.
- 7ad2031: Add typed config access helpers with `ConfigToken<T>`, `configToken<T>()`, and `Config.useConfig(Token)` for workflow-authored config reads.
