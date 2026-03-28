import type { TisynExpr } from "@tisyn/ir";
import { tokenize } from "./tokenize.js";
import { parseInternal } from "./parse.js";
import { tryAutoClose as tryAutoCloseImpl } from "./recovery.js";
import { DSLParseError } from "./errors.js";
import type { ParseResult, RecoveryInfo } from "./types.js";

export { DSLParseError } from "./errors.js";
export type {
  ParseResult,
  ParseSuccess,
  ParseFailure,
  RecoveryInfo,
  FrameInfo,
} from "./types.js";

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
 * On failure, `result.recovery` is present when the error was caused by
 * unexpected EOF (a likely truncation), and `result.recovery.autoClosable`
 * indicates whether auto-close repair is worth attempting.
 */
export function parseDSLSafe(source: string): ParseResult {
  try {
    const tokens = tokenize(source);
    const ir = parseInternal(tokens);
    return { ok: true, ir };
  } catch (e) {
    if (e instanceof DSLParseError) {
      const recovery = (e as DSLParseError & { recovery?: RecoveryInfo }).recovery;
      return { ok: false, error: e, ...(recovery ? { recovery } : {}) };
    }
    // Unexpected non-DSL error — re-throw
    throw e;
  }
}

/**
 * Parse a DSL string with auto-close recovery for truncated input.
 *
 * Attempts `parseDSLSafe` first. If that fails with an EOF error where
 * `recovery.autoClosable === true`, attempts `tryAutoClose`. If repair
 * succeeds, returns `{ ok: true, ir, repaired }`. Otherwise returns the
 * original parse failure.
 *
 * This is the recommended entry point for LLM-generated input.
 */
export function parseDSLWithRecovery(
  source: string,
): ParseResult & { repaired?: string } {
  const first = parseDSLSafe(source);
  if (first.ok) return first;

  // Only attempt recovery when the parser's frame simulation confirmed every
  // open frame can be satisfied by closing pending delimiters.
  if (!first.recovery?.autoClosable) return first;

  const repaired = tryAutoCloseImpl(source, parseDSLSafe);
  if (repaired === null) return first;

  const second = parseDSLSafe(repaired);
  if (!second.ok) return first;

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
