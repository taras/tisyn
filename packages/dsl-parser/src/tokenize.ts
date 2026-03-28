import type { Token } from "./token.js";
import { DSLParseError } from "./errors.js";

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentContinue(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  function advance(): string {
    const ch = source[i++];
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function peek(ahead = 0): string {
    return source[i + ahead] ?? "";
  }

  function makeToken(
    kind: Token["kind"],
    value: string,
    startOffset: number,
    startLine: number,
    startCol: number,
  ): Token {
    return { kind, value, offset: startOffset, line: startLine, column: startCol };
  }

  while (i < source.length) {
    // Skip whitespace
    const ws = source[i];
    if (ws === " " || ws === "\t" || ws === "\r" || ws === "\n") {
      advance();
      continue;
    }

    const startOffset = i;
    const startLine = line;
    const startCol = col;
    const ch = source[i];

    // Single-character tokens
    switch (ch) {
      case "(":
        advance();
        tokens.push(makeToken("LPAREN", "(", startOffset, startLine, startCol));
        continue;
      case ")":
        advance();
        tokens.push(makeToken("RPAREN", ")", startOffset, startLine, startCol));
        continue;
      case "[":
        advance();
        tokens.push(makeToken("LBRACKET", "[", startOffset, startLine, startCol));
        continue;
      case "]":
        advance();
        tokens.push(makeToken("RBRACKET", "]", startOffset, startLine, startCol));
        continue;
      case "{":
        advance();
        tokens.push(makeToken("LBRACE", "{", startOffset, startLine, startCol));
        continue;
      case "}":
        advance();
        tokens.push(makeToken("RBRACE", "}", startOffset, startLine, startCol));
        continue;
      case ",":
        advance();
        tokens.push(makeToken("COMMA", ",", startOffset, startLine, startCol));
        continue;
      case ":":
        advance();
        tokens.push(makeToken("COLON", ":", startOffset, startLine, startCol));
        continue;
    }

    // Number: -?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?
    // '-' only starts a number if followed by a digit
    if (ch === "-" && isDigit(peek(1))) {
      let raw = "";
      raw += advance(); // '-'
      while (i < source.length && isDigit(source[i])) raw += advance();
      if (i < source.length && source[i] === ".") {
        raw += advance(); // '.'
        while (i < source.length && isDigit(source[i])) raw += advance();
      }
      if (i < source.length && (source[i] === "e" || source[i] === "E")) {
        raw += advance();
        if (i < source.length && (source[i] === "+" || source[i] === "-")) raw += advance();
        while (i < source.length && isDigit(source[i])) raw += advance();
      }
      tokens.push(makeToken("NUMBER", raw, startOffset, startLine, startCol));
      continue;
    }

    if (isDigit(ch)) {
      let raw = "";
      while (i < source.length && isDigit(source[i])) raw += advance();
      if (i < source.length && source[i] === ".") {
        raw += advance();
        while (i < source.length && isDigit(source[i])) raw += advance();
      }
      if (i < source.length && (source[i] === "e" || source[i] === "E")) {
        raw += advance();
        if (i < source.length && (source[i] === "+" || source[i] === "-")) raw += advance();
        while (i < source.length && isDigit(source[i])) raw += advance();
      }
      tokens.push(makeToken("NUMBER", raw, startOffset, startLine, startCol));
      continue;
    }

    // String literal
    if (ch === '"') {
      advance(); // opening quote
      let decoded = "";
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\n") {
          throw new DSLParseError(
            "Unterminated string literal",
            startLine,
            startCol,
            startOffset,
          );
        }
        if (source[i] === "\\") {
          advance(); // backslash
          if (i >= source.length) {
            throw new DSLParseError(
              "Unterminated string literal",
              startLine,
              startCol,
              startOffset,
            );
          }
          const esc = source[i];
          advance(); // escape character
          switch (esc) {
            case '"':
              decoded += '"';
              break;
            case "\\":
              decoded += "\\";
              break;
            case "/":
              decoded += "/";
              break;
            case "n":
              decoded += "\n";
              break;
            case "r":
              decoded += "\r";
              break;
            case "t":
              decoded += "\t";
              break;
            case "b":
              decoded += "\b";
              break;
            case "f":
              decoded += "\f";
              break;
            case "u": {
              if (i + 3 >= source.length) {
                throw new DSLParseError(
                  "Invalid \\u escape: insufficient characters",
                  line,
                  col,
                  i,
                );
              }
              const hex = source.slice(i, i + 4);
              const code = parseInt(hex, 16);
              if (isNaN(code)) {
                throw new DSLParseError(
                  `Invalid \\u escape: \\u${hex}`,
                  line,
                  col,
                  i,
                );
              }
              decoded += String.fromCharCode(code);
              // advance 4 chars manually (they may not be newlines)
              for (let k = 0; k < 4; k++) advance();
              break;
            }
            default:
              throw new DSLParseError(
                `Invalid escape sequence: \\${esc}`,
                line,
                col,
                i - 1,
              );
          }
        } else {
          decoded += advance();
        }
      }
      if (i >= source.length) {
        throw new DSLParseError("Unterminated string literal", startLine, startCol, startOffset);
      }
      advance(); // closing quote
      tokens.push(makeToken("STRING", decoded, startOffset, startLine, startCol));
      continue;
    }

    // Identifier
    if (isIdentStart(ch)) {
      let ident = "";
      while (i < source.length && isIdentContinue(source[i])) ident += advance();
      tokens.push(makeToken("IDENT", ident, startOffset, startLine, startCol));
      continue;
    }

    // Unexpected character
    throw new DSLParseError(`Unexpected character: '${ch}'`, startLine, startCol, startOffset);
  }

  tokens.push({ kind: "EOF", value: "", offset: i, line, column: col });
  return tokens;
}
