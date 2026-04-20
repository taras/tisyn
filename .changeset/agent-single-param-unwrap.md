---
"@tisyn/agent": minor
---

Documentation: README updated to teach the new single-parameter
payload rule. Single-parameter operations pass their argument
through directly as the payload (no `{ input: ... }` wrapper);
multi-parameter operations still receive a named object keyed by
parameter names. Examples for `agent()`, `Agents.use()`,
`useAgent()`, and `dispatch()` use the unwrapped shape.

No runtime API changes in this package — the bump tracks the
fixed-group `@tisyn/compiler` change that drives the new payload
shape.
