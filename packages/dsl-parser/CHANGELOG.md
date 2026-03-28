# @tisyn/dsl-parser Changelog

## 0.1.0

Initial release.

- `parseDSL(source)` — strict throwing parser
- `parseDSLSafe(source)` — non-throwing discriminated result
- `parseDSLWithRecovery(source)` — recovery-aware entry point for LLM input
- `tryAutoClose(source)` — delimiter-balance repair utility
- `DSLParseError` with `line`, `column`, `offset` properties
- Full constructor table for all 34 base Tisyn IR constructors
- Core conformance fixtures from DSL spec §11 (DSL-001 through DSL-112)
