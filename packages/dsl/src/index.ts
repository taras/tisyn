import type { TisynExpr } from "@tisyn/ir";
import type { Result } from "effection";
import { tokenize } from "./tokenize.js";
import { parseInternal } from "./parse.js";
import { tryAutoClose as tryAutoCloseImpl } from "./recovery.js";
import { DSLParseError } from "./errors.js";

export { DSLParseError } from "./errors.js";
export type { RecoveryInfo, FrameInfo } from "./types.js";

export { print } from "@tisyn/ir";
export type { PrintOptions } from "@tisyn/ir";

/**
 * Parse a DSL string and return the IR. Throws `DSLParseError` on failure.
 *
 * This is the default strict API. For non-throwing use, see `parseDSLSafe`.
 * For LLM-generated input with auto-close recovery, see `parseDSLWithRecovery`.
 */
export function parseDSL(source: string): TisynExpr {
  const tokens = tokenize(source);
  return parseInternal(tokens);
}

/**
 * Parse a DSL string and return a discriminated result. Never throws.
 *
 * On failure, `result.error.recovery` is present when the error was caused by
 * unexpected EOF (a likely truncation), and `result.error.recovery.autoClosable`
 * indicates whether auto-close repair is worth attempting.
 */
export function parseDSLSafe(source: string): Result<TisynExpr> {
  try {
    const tokens = tokenize(source);
    const value = parseInternal(tokens);
    return { ok: true, value };
  } catch (e) {
    if (e instanceof DSLParseError) {
      return { ok: false, error: e };
    }
    // Unexpected non-DSL error — re-throw
    throw e;
  }
}

/**
 * Parse a DSL string with auto-close recovery for truncated input.
 *
 * Attempts `parseDSLSafe` first. If that fails with an EOF error where
 * `error.recovery.autoClosable === true`, attempts `tryAutoClose`. If repair
 * succeeds, returns `{ ok: true, value, repaired }`. Otherwise returns the
 * original parse failure.
 *
 * This is the recommended entry point for LLM-generated input.
 */
export function parseDSLWithRecovery(source: string): Result<TisynExpr> & { repaired?: string } {
  const first = parseDSLSafe(source);
  if (first.ok) {
    return first;
  }

  // Only attempt recovery when the parser's frame simulation confirmed every
  // open frame can be satisfied by closing pending delimiters.
  const parseError = first.error instanceof DSLParseError ? first.error : null;
  if (!parseError?.recovery?.autoClosable) {
    return first;
  }

  const repaired = tryAutoCloseImpl(source, parseDSLSafe);
  if (repaired === null) {
    return first;
  }

  const second = parseDSLSafe(repaired);
  if (!second.ok) {
    return first;
  }

  return { ...second, repaired };
}

/**
 * Attempt to close unbalanced delimiters in a truncated DSL string.
 *
 * Returns the repaired string if:
 * - Tokenization succeeds.
 * - All delimiters are properly matched (no mismatches).
 * - The repaired string parses successfully.
 *
 * Returns `null` if repair is not possible.
 *
 * Does NOT parse the result — callers should pass the returned string to
 * `parseDSLSafe` for validation.
 */
export function tryAutoClose(source: string): string | null {
  return tryAutoCloseImpl(source, parseDSLSafe);
}
