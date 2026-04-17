---
"@tisyn/spec-workflows": patch
---

`verify-corpus` now compares live-rendered markdown against both the frozen
round-trip fixture AND the emitted `specs/*.md` tree. A stale committed
file under `specs/` for the target spec or its companion test plan fails
the deterministic gate. `CompileOutput` gains `emittedSpecCompareSummary`
and `emittedPlanCompareSummary`; the workflow logs `compare:emitted-spec`
and `compare:emitted-plan` and surfaces both in the failure message.
