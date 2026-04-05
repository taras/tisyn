import { tokenize } from "./tokenize.js";

type Opener = "(" | "[" | "{";

const CLOSER: Record<Opener, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

/**
 * Attempt to auto-close a truncated DSL string by appending missing closing
 * delimiters (§7.5).
 *
 * Returns the repaired string if:
 * 1. Tokenization succeeds (no lexical errors).
 * 2. All closing delimiters match their openers (no mismatches).
 * 3. The repaired string successfully parses (arity and semantics are valid).
 *
 * Returns `null` if repair is not possible.
 */
export function tryAutoClose(
  source: string,
  parseFn: (s: string) => { ok: boolean },
): string | null {
  let tokens;
  try {
    tokens = tokenize(source);
  } catch {
    return null;
  }

  const stack: Opener[] = [];

  for (const tok of tokens) {
    if (tok.kind === "EOF") {
      break;
    }
    if (tok.kind === "LPAREN") {
      stack.push("(");
    } else if (tok.kind === "LBRACKET") {
      stack.push("[");
    } else if (tok.kind === "LBRACE") {
      stack.push("{");
    } else if (tok.kind === "RPAREN") {
      if (stack.length === 0 || stack[stack.length - 1] !== "(") {
        return null;
      }
      stack.pop();
    } else if (tok.kind === "RBRACKET") {
      if (stack.length === 0 || stack[stack.length - 1] !== "[") {
        return null;
      }
      stack.pop();
    } else if (tok.kind === "RBRACE") {
      if (stack.length === 0 || stack[stack.length - 1] !== "{") {
        return null;
      }
      stack.pop();
    }
  }

  if (stack.length === 0) {
    return source; // already balanced
  }

  const suffix = [...stack]
    .reverse()
    .map((opener) => CLOSER[opener])
    .join("");
  const repaired = source + suffix;

  const result = parseFn(repaired);
  return result.ok ? repaired : null;
}
