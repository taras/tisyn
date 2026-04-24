# @tisyn/context-api

Vendored Context API used by Tisyn's agent and runtime middleware surfaces.

This package is based on `@effectionx/context-api` and is kept in-tree because
Tisyn currently depends on behavior that is not available from a stable upstream
release. Keeping the package local avoids depending on a `pkg.pr.new` preview
tarball for production installs.

The public surface intentionally mirrors the upstream package:

- `createApi(name, handler)`
- `Api`
- `Around`
- `Operations`
- `Middleware`

Do not broaden this package beyond the vendored context API surface without a
separate design decision.
