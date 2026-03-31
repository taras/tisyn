---
"@tisyn/validate": patch
---

Update scope validation for widened binding expressions.

- Remove the constraint that each binding value must be a `RefNode`; binding values may now be any `TisynExpr`
- Add binding values to the evaluation-position table for `"scope"` so that a `QuoteNode` appearing directly as a binding value triggers `QUOTE_AT_EVAL_POSITION`
