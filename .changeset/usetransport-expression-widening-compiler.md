---
"@tisyn/compiler": patch
---

Widen `useTransport` second argument to accept any expression.

Previously the factory argument was restricted to a bare identifier (enforced by compile-time UT2/UT3 checks). It now accepts any expression that evaluates to an `AgentTransportFactory` without performing effects — property accesses, call expressions, ternaries, etc.

- Remove UT2 (bare-identifier) and UT3 (must be in scope) error checks
- Emit the factory argument via `emitExpression()` instead of constructing a `RefNode` directly
- Update `ScopeEval()` builder signature to accept `Record<string, Expr>` bindings
- Remove UT2 and UT3 from the compiler README error-code table
