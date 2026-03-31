---
"@tisyn/runtime": patch
---

Evaluate scope binding expressions at scope-entry time.

- Add `ScopeBindingEffectError`: thrown when a binding expression yields an effect (binding expressions must be pure)
- Add `evaluateScopeBinding()`: drives a binding expression synchronously via the kernel evaluator; throws `ScopeBindingEffectError` if any effect is yielded
- Replace `lookup(ref.name, env)` with `evaluateScopeBinding(binding, env)` in `orchestrateScope` so that any IR expression (not just `RefNode`) can be used as a factory binding
- Wrap binding evaluation errors as `EffectError` before re-throwing so that parent IR-level `Try` nodes can catch scope-entry failures
