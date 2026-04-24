---
"@tisyn/effects": patch
---

Update the `invokeInline` public JSDoc to document the new
runtime support: `timebox`, `all`, and `race` now work
inside inline bodies with their own compound-external
semantics per §11.6. `scope` is the only compound still
rejected; a follow-up phase will review its
transport-binding semantics before lifting it.

Paired with the runtime-side implementation. Public
signature unchanged.
