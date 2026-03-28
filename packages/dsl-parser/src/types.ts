import type { TisynExpr } from "@tisyn/ir";
import type { DSLParseError } from "./errors.js";

export interface ParseSuccess {
  ok: true;
  ir: TisynExpr;
}

export interface FrameInfo {
  constructor: string;
  argsReceived: number;
  minArgs: number;
  maxArgs: number;
}

export interface RecoveryInfo {
  /** Human-readable description of what the parser expected when EOF was hit. */
  expected: string;
  /** Snapshot of the open constructor frame stack at EOF. */
  frameStack: FrameInfo[];
  unclosedParens: number;
  unclosedBrackets: number;
  unclosedBraces: number;
  /**
   * True iff every open frame has received at least its minimum number of
   * arguments and the parser is at a position where a closing delimiter
   * would be syntactically valid.
   */
  autoClosable: boolean;
}

export interface ParseFailure {
  ok: false;
  error: DSLParseError;
  /** Present when the failure was caused by unexpected EOF. */
  recovery?: RecoveryInfo;
}

export type ParseResult = ParseSuccess | ParseFailure;
