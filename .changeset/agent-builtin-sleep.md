---
"@tisyn/agent": minor
---

Add `sleep` as a first-class Effects operation alongside `dispatch`.

- `Effects.sleep(ms)` calls Effection's `sleep` directly
- Core `dispatch` handler routes `effectId === "sleep"` to the built-in sleep operation
- `Effects.around({ *dispatch })` middleware can still intercept sleep before the built-in runs
