---
"@tisyn/cli": minor
---

Migrate CLI to rooted import-graph pipeline with runtime binding support

- `tsn run` now executes source workflows through the rooted import graph, compiling the selected export and its transitive helper bindings together
- Selecting a missing export now fails clearly with exit code 2 (`E-GRAPH-002`)
- `generate` and `build` now use `roots` instead of the legacy single-file source assembly path
- The legacy `input` config field is rejected with a clear migration error pointing to `roots`
- Config validation now checks that `roots` is a non-empty string array and that output paths are writable
