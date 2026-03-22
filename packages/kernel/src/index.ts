export { evaluate } from "./eval.js";
export { classify, isStructural, isCompoundExternal } from "./classify.js";
export { resolve } from "./resolve.js";
export { unquote } from "./unquote.js";
export { type Env, EMPTY_ENV, lookup, extend, extendMulti, envFromRecord } from "./environment.js";
export { MalformedIR } from "@tisyn/validate";
export {
  UnboundVariable,
  NotCallable,
  ArityMismatch,
  TypeError,
  DivisionByZero,
  ExplicitThrow,
} from "./errors.js";
export type {
  EffectDescription,
  EventResult,
  YieldEvent,
  CloseEvent,
  DurableEvent,
  EffectDescriptor,
} from "./events.js";
export { canonical } from "./canonical.js";
export { parseEffectId } from "./effect-id.js";
