---
"@tisyn/compiler": minor
---

Add `emitTryStatement` to lower TypeScript `try/catch/finally` AST nodes to Tisyn IR. Handles SSA join variables across branches via `finallyPayload` and an inner-Try fallback (`Let(x_1, Try(Ref(fp), err, Ref(x_0_pretrial)), body)`) that safely resolves the finally context on both success and error paths without introducing new IR fields. New compiler errors: E033 (return in try/catch/finally), E034 (catch without binding), E035 (outer-binding assignment in finally).
