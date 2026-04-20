---
"@tisyn/transport": minor
---

Documentation: README example updated to use the unwrapped
single-parameter payload shape. `math.double({ value: 21 })`
replaces the previous `math.double({ input: { value: 21 } })`
form, matching the new compiler lowering rule.

No runtime API changes in this package — the bump tracks the
fixed-group `@tisyn/compiler` change that drives the new payload
shape.
