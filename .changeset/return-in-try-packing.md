---
"@tisyn/compiler": minor
---

Support `return` inside `try` and `catch` clause bodies via outcome packing. When a `return` is present in a `try` or `catch` body, the compiler activates packing mode: every normal exit is lowered to `Construct({ __tag, __value, ...joinVars })`, and a post-Try dispatch inspects `__tag` to suppress the continuation (`"return"`) or continue it (`"fallthrough"`). `return` inside `finally` remains a compile error (E033 narrowed from try/catch/finally to finally-only).
