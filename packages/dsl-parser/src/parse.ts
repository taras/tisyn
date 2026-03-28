import type { TisynExpr } from "@tisyn/ir";
import type { Token } from "./token.js";
import { DSLParseError } from "./errors.js";
import type { FrameInfo, RecoveryInfo } from "./types.js";
import { CONSTRUCTOR_TABLE, CONSTRUCTOR_NAMES } from "./constructors.js";

// Internal mutable frame tracked during parsing
interface Frame extends FrameInfo {
  constructor: string;
  argsReceived: number;
  minArgs: number;
  maxArgs: number;
}

interface ParserState {
  tokens: Token[];
  pos: number;
  frameStack: Frame[];
  parenDepth: number;
  bracketDepth: number;
  braceDepth: number;
}

function peek(state: ParserState): Token {
  return state.tokens[state.pos]!;
}

function consume(state: ParserState): Token {
  const tok = state.tokens[state.pos]!;
  state.pos++;
  return tok;
}

function expect(state: ParserState, kind: Token["kind"]): Token {
  const tok = peek(state);
  if (tok.kind !== kind) {
    if (tok.kind === "EOF") {
      // Build recovery info and throw EOF error
      const recovery = buildRecoveryInfo(state, `'${kind}'`);
      const err = new DSLParseError(
        `Unexpected end of input, expected '${kind}'`,
        tok.line,
        tok.column,
        tok.offset,
      );
      // Attach recovery info to the error for parseDSLSafe to capture
      (err as DSLParseError & { recovery?: RecoveryInfo }).recovery = recovery;
      throw err;
    }
    throw new DSLParseError(
      `Unexpected token '${tok.value}', expected '${kind}'`,
      tok.line,
      tok.column,
      tok.offset,
    );
  }
  return consume(state);
}

function buildRecoveryInfo(state: ParserState, expected: string): RecoveryInfo {
  const autoClosable =
    state.frameStack.every((f) => f.argsReceived >= f.minArgs) &&
    state.bracketDepth === 0 &&
    state.braceDepth === 0;

  return {
    expected,
    frameStack: state.frameStack.map((f) => ({
      constructor: f.constructor,
      argsReceived: f.argsReceived,
      minArgs: f.minArgs,
      maxArgs: f.maxArgs,
    })),
    unclosedParens: state.parenDepth,
    unclosedBrackets: state.bracketDepth,
    unclosedBraces: state.braceDepth,
    autoClosable,
  };
}

function parseExpr(state: ParserState): TisynExpr {
  const tok = peek(state);

  if (tok.kind === "EOF") {
    const recovery = buildRecoveryInfo(state, "expression");
    const err = new DSLParseError(
      "Unexpected end of input, expected expression",
      tok.line,
      tok.column,
      tok.offset,
    );
    (err as DSLParseError & { recovery?: RecoveryInfo }).recovery = recovery;
    throw err;
  }

  if (tok.kind === "STRING") {
    consume(state);
    return tok.value;
  }

  if (tok.kind === "NUMBER") {
    consume(state);
    return Number(tok.value);
  }

  if (tok.kind === "IDENT") {
    const value = tok.value;
    if (value === "true") {
      consume(state);
      return true;
    }
    if (value === "false") {
      consume(state);
      return false;
    }
    if (value === "null") {
      consume(state);
      return null;
    }
    return parseConstructorCall(state);
  }

  if (tok.kind === "LBRACKET") {
    return parseArrayLit(state);
  }

  if (tok.kind === "LBRACE") {
    return parseObjectLit(state);
  }

  throw new DSLParseError(
    `Unexpected token '${tok.value}'`,
    tok.line,
    tok.column,
    tok.offset,
  );
}

function parseConstructorCall(state: ParserState): TisynExpr {
  const nameTok = consume(state); // IDENT

  // Check for LPAREN — bare identifier check
  const next = peek(state);
  if (next.kind !== "LPAREN") {
    if (next.kind === "COLON") {
      // Inside an object — this path shouldn't reach here (handled in parseObjectLit)
      throw new DSLParseError(
        `Unexpected identifier '${nameTok.value}' as expression`,
        nameTok.line,
        nameTok.column,
        nameTok.offset,
      );
    }
    throw new DSLParseError(
      `Bare identifier '${nameTok.value}' is not valid; did you mean Ref("${nameTok.value}")?`,
      nameTok.line,
      nameTok.column,
      nameTok.offset,
    );
  }

  // Look up in constructor table
  const entry = CONSTRUCTOR_TABLE[nameTok.value];
  if (!entry) {
    throw new DSLParseError(
      `Unknown constructor '${nameTok.value}'. Available constructors: ${CONSTRUCTOR_NAMES}`,
      nameTok.line,
      nameTok.column,
      nameTok.offset,
    );
  }

  // Consume LPAREN and push frame
  consume(state); // LPAREN
  state.parenDepth++;
  const frame: Frame = {
    constructor: nameTok.value,
    argsReceived: 0,
    minArgs: entry.minArgs,
    maxArgs: entry.maxArgs,
  };
  state.frameStack.push(frame);

  const args = parseArgList(state, frame);

  // If at EOF with too few args, emit a clearer arity error
  if (peek(state).kind === "EOF" && args.length < entry.minArgs) {
    throw new DSLParseError(
      `'${nameTok.value}' requires at least ${entry.minArgs} argument(s), got ${args.length}`,
      nameTok.line,
      nameTok.column,
      nameTok.offset,
    );
  }

  // Consume RPAREN and pop frame
  expect(state, "RPAREN");
  state.parenDepth--;
  state.frameStack.pop();

  // Arity check
  const count = args.length;
  if (count < entry.minArgs) {
    throw new DSLParseError(
      `'${nameTok.value}' requires at least ${entry.minArgs} argument(s), got ${count}`,
      nameTok.line,
      nameTok.column,
      nameTok.offset,
    );
  }
  if (count > entry.maxArgs) {
    throw new DSLParseError(
      `'${nameTok.value}' accepts at most ${entry.maxArgs} argument(s), got ${count}`,
      nameTok.line,
      nameTok.column,
      nameTok.offset,
    );
  }

  return entry.dispatch(args, nameTok);
}

function parseArgList(state: ParserState, frame: Frame): TisynExpr[] {
  const args: TisynExpr[] = [];

  if (peek(state).kind === "RPAREN") {
    return args;
  }

  args.push(parseExpr(state));
  frame.argsReceived = args.length;

  while (peek(state).kind === "COMMA") {
    consume(state); // COMMA
    // No trailing comma in arg list — always require another expression
    args.push(parseExpr(state));
    frame.argsReceived = args.length;
  }

  return args;
}

function parseArrayLit(state: ParserState): TisynExpr[] {
  expect(state, "LBRACKET");
  state.bracketDepth++;
  const items: TisynExpr[] = [];

  if (peek(state).kind !== "RBRACKET") {
    items.push(parseExpr(state));
    while (peek(state).kind === "COMMA") {
      consume(state); // COMMA
      if (peek(state).kind === "RBRACKET") break; // trailing comma OK
      items.push(parseExpr(state));
    }
  }

  expect(state, "RBRACKET");
  state.bracketDepth--;
  return items;
}

function parseObjectLit(state: ParserState): Record<string, TisynExpr> {
  expect(state, "LBRACE");
  state.braceDepth++;
  const entries: Record<string, TisynExpr> = {};

  if (peek(state).kind !== "RBRACE") {
    parseEntry(state, entries);
    while (peek(state).kind === "COMMA") {
      consume(state); // COMMA
      if (peek(state).kind === "RBRACE") break; // trailing comma OK
      parseEntry(state, entries);
    }
  }

  expect(state, "RBRACE");
  state.braceDepth--;
  return entries;
}

function parseEntry(state: ParserState, entries: Record<string, TisynExpr>): void {
  const keyTok = peek(state);
  if (keyTok.kind === "IDENT") {
    consume(state);
    expect(state, "COLON");
    entries[keyTok.value] = parseExpr(state);
  } else if (keyTok.kind === "STRING") {
    consume(state);
    expect(state, "COLON");
    entries[keyTok.value] = parseExpr(state);
  } else {
    throw new DSLParseError(
      `Expected object key (identifier or string), got '${keyTok.value}'`,
      keyTok.line,
      keyTok.column,
      keyTok.offset,
    );
  }
}

export interface ParsedDocument {
  ir: TisynExpr;
}

export type InternalParseError = DSLParseError & { recovery?: RecoveryInfo };

/**
 * Internal parse function — throws DSLParseError (possibly with .recovery attached).
 */
export function parseInternal(tokens: Token[]): TisynExpr {
  const state: ParserState = {
    tokens,
    pos: 0,
    frameStack: [],
    parenDepth: 0,
    bracketDepth: 0,
    braceDepth: 0,
  };

  const ir = parseExpr(state);

  const eofTok = peek(state);
  if (eofTok.kind !== "EOF") {
    throw new DSLParseError(
      `Unexpected token '${eofTok.value}' after expression`,
      eofTok.line,
      eofTok.column,
      eofTok.offset,
    );
  }

  return ir;
}
