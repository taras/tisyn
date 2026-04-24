---
"@tisyn/effects": patch
---

Update the `invokeInline` public JSDoc to document the new
runtime support: `spawn` and `join` inside an inline body
now attach to the hosting caller's Effection scope and
shared task registry per §11.5, and sibling/caller code can
resolve task handles acquired inside an inline body using
the existing double-join semantics. The public signature is
unchanged.

Paired with the runtime-side implementation.
