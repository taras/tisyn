---
"@tisyn/validate": patch
---

Add semantic validation rules for `resource` and `provide` IR nodes.

- `resource`: data must be Quote node with `body` field; body is in evaluation position
- `provide`: accepts any expression as data (not Quote-wrapped, like `join`)
