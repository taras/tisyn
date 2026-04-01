---
"@tisyn/compiler": patch
---

Update scope teardown test to reflect built-in sleep handler — assert `null` (built-in) instead of `"clean"` (caught error) after scoped middleware tears down.
