/**
 * IR Validation — thin wrapper delegating to @tisyn/validate.
 *
 * See @tisyn/validate for the actual validation implementation.
 */

import { assertValidIr } from "@tisyn/validate";
import type { TisynExpr } from "@tisyn/ir";

/**
 * Validate an IR tree.
 * Throws MalformedIR if invalid.
 */
export function validate(expr: TisynExpr): void {
  assertValidIr(expr);
}
