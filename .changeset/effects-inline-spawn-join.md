---
"@tisyn/effects": patch
---

Update the `invokeInline` public JSDoc to document the new
runtime support: `spawn` and `join` inside an inline body
now attach to the hosting caller's Effection scope and
share the hosting site's existing durable task table per
§11.5, so sibling/caller code can resolve task handles
acquired inside an inline body using the existing
double-join semantics. The public signature is unchanged.

Paired with the runtime-side implementation.
