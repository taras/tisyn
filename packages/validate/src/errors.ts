import type { TisynExpr } from "@tisyn/ir";

export type ValidationError = {
  level: 1 | 2;
  path: string[];
  message: string;
  code: string;
};

export type ValidationResult =
  | { ok: true; node: TisynExpr }
  | { ok: false; errors: ValidationError[] };

export class MalformedIR extends Error {
  override name = "MalformedIR" as const;
  constructor(message: string) {
    super(message);
  }
}

// Level 1 — Grammar error codes
export const MALFORMED_EVAL = "MALFORMED_EVAL";
export const MALFORMED_QUOTE = "MALFORMED_QUOTE";
export const MALFORMED_REF = "MALFORMED_REF";
export const MALFORMED_FN_PARAMS = "MALFORMED_FN_PARAMS";
export const MALFORMED_FN_BODY = "MALFORMED_FN_BODY";

// Level 2 — Semantic error codes
export const STRUCTURAL_REQUIRES_QUOTE = "STRUCTURAL_REQUIRES_QUOTE";
export const QUOTE_AT_EVAL_POSITION = "QUOTE_AT_EVAL_POSITION";
export const TIMEBOX_DURATION_EXTERNAL = "TIMEBOX_DURATION_EXTERNAL";
