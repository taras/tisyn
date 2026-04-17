---
"@tisyn/agent": minor
---

Removed the `invoke(invocation)` helper and the `Invocation` public type
export. Call sites that previously wrote `yield* invoke(agent.op(args))`
should now pass the call descriptor straight to `dispatch`, which accepts
either a `(effectId, data)` pair or a `{ effectId, data }` object:

    const result = yield* dispatch(agent.op(args));

The descriptor shape returned by `agent().op(args)` is unchanged; only the
public `Invocation` type name and the `invoke` function are removed. The
`invoke` name is freed for a future nested-invocation helper.
