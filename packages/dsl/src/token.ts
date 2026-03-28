export type TokenKind =
  | "IDENT"
  | "STRING"
  | "NUMBER"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "LBRACE"
  | "RBRACE"
  | "COMMA"
  | "COLON"
  | "EOF";

export interface Token {
  kind: TokenKind;
  /** Raw text for most tokens; decoded value for STRING tokens. */
  value: string;
  /** UTF-16 code-unit offset from the start of the input string. */
  offset: number;
  /** 1-indexed line number. */
  line: number;
  /** 1-indexed column within the current line. */
  column: number;
}
