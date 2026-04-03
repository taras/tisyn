---
"@tisyn/dsl": minor
---

Add `Timebox` constructor and `Converge` macro to the Constructor DSL.

- `Timebox(duration, body)` — 2-arg base constructor for timebox IR
- `Converge(probe, until, interval, timeout)` — 4-arg macro that expands to the same IR shape as the compiler's `converge` lowering (timebox + recursive Fn + Call + sleep)
