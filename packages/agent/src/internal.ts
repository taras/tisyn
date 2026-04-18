// Package-internal seam for @tisyn/agent.
//
// Exports here are NOT part of the public `@tisyn/agent` surface. They
// are accessible to other workspace packages (e.g. `@tisyn/runtime`)
// that compose with the dispatch boundary internals, and to tests that
// assert package-internal invariants. Application code MUST NOT import
// from `@tisyn/agent/internal`.
//
// `DispatchContext` lives here — not on the public barrel — because it
// is a runtime/agent seam, not a user-facing API. The public nested-
// invocation surface is the free `invoke(fn, args, opts?)` helper
// exported from `@tisyn/agent`; the context it reads is intentionally
// not installable from user code.

export { DispatchContext } from "./dispatch.js";
