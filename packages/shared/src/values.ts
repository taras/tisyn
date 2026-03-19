/**
 * JSON value types and Val (the result of evaluating an Expr).
 *
 * See Tisyn System Specification §2.2.
 */

/** Any JSON-serializable value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Val is the result of evaluating an expression.
 *
 * All JSON values are Val. FnVal is also a Val (and an Expr).
 * Whether a JSON object is an Expr or a Val depends on context,
 * not structure (System Spec §2.3).
 */
export type Val = Json;
