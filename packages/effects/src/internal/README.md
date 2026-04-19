# `@tisyn/effects/internal` — non-stable workspace seam

This subpath is **not part of the stable public surface** of `@tisyn/effects`.

It exists to share the dispatch-boundary seam (`DispatchContext`, `evaluateMiddlewareFn`) between workspace packages in this repository — specifically `@tisyn/agent`, `@tisyn/runtime`, and `@tisyn/transport`. These consumers are coupled to the reference implementation and ship together.

**Do not import from `@tisyn/effects/internal` in user code.** Anything exported here:

- has no compatibility guarantee across versions,
- may be renamed, removed, or re-shaped without a deprecation cycle,
- is not covered by the versioning contract of `@tisyn/effects`.

User-facing APIs live on the primary barrel (`@tisyn/effects`). If you think you need something that only lives on `/internal`, open an issue so we can consider promoting it — but most likely the correct answer is a different public API.

A lint rule (installed in `tools/oxlint/tisyn-plugin.mjs`) and/or a conformance test restricts imports of this subpath to the set `{ @tisyn/effects, @tisyn/agent, @tisyn/runtime, @tisyn/transport }`.
