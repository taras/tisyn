---
"@tisyn/agent": minor
"@tisyn/compiler": patch
"@tisyn/runtime": patch
---

Add `sleep` as a first-class Effects operation alongside `dispatch`.

- `Effects.sleep(ms)` calls Effection's `sleep` directly
- Compiled `yield* sleep(ms)` routes through `dispatch("sleep", [ms])` to the built-in handler
- `Effects.around({ *dispatch })` middleware can still intercept sleep before the built-in runs
