---
"@tisyn/spec": patch
---

Narrow the alignment claim: `@tisyn/spec` is aligned with the v2 source spec with one scoped deviation in §7.7. The auxiliary acquisition operations `acquireFixture` and `acquireEmittedMarkdown` are no longer exposed as default-bound module-level exports — their default readers resolved to monorepo-only paths (`<packageRoot>/corpus/<id>/__fixtures__/*.md` and `<repoRoot>/specs/*.md`) that neither ship with the published tarball nor exist in a consumer install, so the defaults were guaranteed to `ENOENT` off-monorepo. The operations' §7.7 shapes are preserved on the `AcquireAPI` returned by `createAcquire({ manifest, readFixture, readEmitted })`; callers supply their own readers. The deviation is documented in the package README.
