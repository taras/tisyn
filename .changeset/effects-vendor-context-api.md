---
"@tisyn/effects": patch
---

Swap the preview `@effectionx/context-api` dependency (pinned
to a pkg.pr.new URL) for the in-repo workspace vendor
`@tisyn/context-api`. Removes the install-time patch
workaround (`scripts/patch-context-api-preview.mjs`) that
stripped the `development` export condition from the
preview package. No behavior change in public
`@tisyn/effects` API or observable middleware-composition /
replay-lane semantics.
