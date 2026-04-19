# @tisyn/effects

## 0.2.0

### Minor Changes

- c792d86: Introduce `@tisyn/effects`, the dispatch-boundary package for Tisyn. Authors
  of effectful workflows and transports import `Effects`, `dispatch`, `resolve`,
  `invoke`, `InvalidInvokeCallSiteError`, `InvalidInvokeInputError`,
  `InvalidInvokeOptionError`, `installCrossBoundaryMiddleware`, and
  `getCrossBoundaryMiddleware` from here instead of `@tisyn/agent`. The package
  also exposes a non-stable `@tisyn/effects/internal` subpath that workspace
  packages (`agent`, `runtime`, `transport`) use for the shared
  `DispatchContext` seam and `evaluateMiddlewareFn`; user code must not depend
  on `@tisyn/effects/internal`.

### Patch Changes

- @tisyn/ir@0.14.0
- @tisyn/kernel@0.14.0
