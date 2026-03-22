/**
 * JSON Schema exports for Tisyn IR nodes.
 *
 * TypeBox schemas are natively JSON Schema compatible objects.
 * These are documentation/interop artifacts, not the runtime validation engine.
 */

export {
  TisynExprSchema as tisynExprSchema,
  EvalNodeSchema as evalSchema,
  QuoteNodeSchema as quoteSchema,
  RefNodeSchema as refSchema,
  FnNodeSchema as fnSchema,
} from "./schemas.js";
