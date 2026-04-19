---
"@tisyn/transport": minor
---

Transport implementations and their tests now import
`Effects`/`installCrossBoundaryMiddleware`/`getCrossBoundaryMiddleware` from
`@tisyn/effects` and `evaluateMiddlewareFn` from `@tisyn/effects/internal`.
Public transport surface (`installRemoteAgent`, `useTransport`,
`createProtocolServer`, transport factories) is unchanged. Users composing
transports with custom cross-boundary middleware should update their imports
to `@tisyn/effects` before the `@tisyn/agent` re-exports are removed in the
next release.
