---
"@tisyn/effects": patch
---

Update the `invokeInline` public JSDoc to document the new
runtime support: `resource` inside an inline body now provides
in the caller's scope and cleans up at caller teardown (§11.4,
§11.8). The public signature is unchanged.

The doc also notes the remaining rejections — the six
non-resource compound externals (`scope`, `spawn`, `join`,
`timebox`, `all`, `race`), and `resource` inside an inline
body invoked from a resource-init or resource-cleanup dispatch
context (nested resources inside a resource body remain
unsupported).

Paired with the runtime-side implementation.
