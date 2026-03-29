/**
 * IR Validation — two-level staged validation.
 *
 * Level 1 — Grammar: structural conformance (mirrors classifyNode).
 * Level 2 — Semantic: single-Quote rule, positions table.
 *
 * Callers get Level 1 OR Level 2 errors, never both.
 * Level 2 only runs when Level 1 passes (a structurally invalid tree
 * cannot have meaningful semantic validation).
 *
 * NOT validated: Ref binding (runtime error per spec).
 * NOT validated: Scope (deferred to v2).
 */

import type { TisynExpr } from "@tisyn/ir";
import { isStructural } from "@tisyn/ir";
import {
  type ValidationError,
  type ValidationResult,
  MalformedIR,
  MALFORMED_EVAL,
  MALFORMED_QUOTE,
  MALFORMED_REF,
  MALFORMED_FN_PARAMS,
  MALFORMED_FN_BODY,
  STRUCTURAL_REQUIRES_QUOTE,
  QUOTE_AT_EVAL_POSITION,
} from "./errors.js";

const IR_DISCRIMINANTS = new Set(["eval", "quote", "ref", "fn"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── Level 1: Grammar ──

export function validateGrammar(json: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  walkGrammar(json, [], errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, node: json as TisynExpr };
}

function walkGrammar(value: unknown, path: string[], errors: ValidationError[]): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkGrammar(value[i], [...path, String(i)], errors);
    }
    return;
  }

  const obj = value as Record<string, unknown>;
  const tisyn = obj["tisyn"];

  if (typeof tisyn !== "string" || !IR_DISCRIMINANTS.has(tisyn)) {
    // Literal object — recurse into values
    for (const [key, val] of Object.entries(obj)) {
      walkGrammar(val, [...path, key], errors);
    }
    return;
  }

  // Tagged node — validate required fields
  switch (tisyn) {
    case "eval": {
      if (typeof obj["id"] !== "string" || obj["id"] === "") {
        errors.push({
          level: 1,
          path,
          message: `Eval node requires a non-empty string "id"`,
          code: MALFORMED_EVAL,
        });
        return;
      }
      if (!("data" in obj)) {
        errors.push({
          level: 1,
          path,
          message: `Eval node requires a "data" field`,
          code: MALFORMED_EVAL,
        });
        return;
      }
      walkGrammar(obj["data"], [...path, "data"], errors);
      break;
    }
    case "quote": {
      if (!("expr" in obj)) {
        errors.push({
          level: 1,
          path,
          message: `Quote node requires an "expr" field`,
          code: MALFORMED_QUOTE,
        });
        return;
      }
      walkGrammar(obj["expr"], [...path, "expr"], errors);
      break;
    }
    case "ref": {
      if (typeof obj["name"] !== "string" || obj["name"] === "") {
        errors.push({
          level: 1,
          path,
          message: `Ref node requires a non-empty string "name"`,
          code: MALFORMED_REF,
        });
      }
      break;
    }
    case "fn": {
      const params = obj["params"];
      if (!Array.isArray(params)) {
        errors.push({
          level: 1,
          path,
          message: `Fn node requires "params" to be an array`,
          code: MALFORMED_FN_PARAMS,
        });
        return;
      }
      for (const p of params) {
        if (typeof p !== "string" || p === "") {
          errors.push({
            level: 1,
            path,
            message: `Fn node "params" must contain only non-empty strings`,
            code: MALFORMED_FN_PARAMS,
          });
          return;
        }
      }
      if (new Set(params).size !== params.length) {
        errors.push({
          level: 1,
          path,
          message: `Fn node "params" must not contain duplicates`,
          code: MALFORMED_FN_PARAMS,
        });
        return;
      }
      if (!("body" in obj)) {
        errors.push({
          level: 1,
          path,
          message: `Fn node requires a "body" field`,
          code: MALFORMED_FN_BODY,
        });
        return;
      }
      walkGrammar(obj["body"], [...path, "body"], errors);
      break;
    }
  }
}

// ── Level 2: Semantic (single-Quote rule) ──

export function validateIr(json: unknown): ValidationResult {
  const grammarResult = validateGrammar(json);
  if (!grammarResult.ok) return grammarResult;

  const errors: ValidationError[] = [];
  walkSemantic(json, [], errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, node: json as TisynExpr };
}

function walkSemantic(value: unknown, path: string[], errors: ValidationError[]): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkSemantic(value[i], [...path, String(i)], errors);
    }
    return;
  }

  const obj = value as Record<string, unknown>;
  const tisyn = obj["tisyn"];

  if (typeof tisyn !== "string" || !IR_DISCRIMINANTS.has(tisyn)) {
    for (const [key, val] of Object.entries(obj)) {
      walkSemantic(val, [...path, key], errors);
    }
    return;
  }

  switch (tisyn) {
    case "eval": {
      const id = obj["id"] as string;
      const data = obj["data"];

      // Recurse into data first
      walkSemantic(data, [...path, "data"], errors);

      if (isStructural(id)) {
        if (!isPlainObject(data) || (data as Record<string, unknown>)["tisyn"] !== "quote") {
          errors.push({
            level: 2,
            path,
            message: `Structural operation "${id}" requires data to be a Quote node`,
            code: STRUCTURAL_REQUIRES_QUOTE,
          });
          return;
        }

        const fields = (data as Record<string, unknown>)["expr"];
        if (isPlainObject(fields)) {
          checkPositions(id, fields as Record<string, unknown>, path, errors);
          if (id === "try") {
            checkTryConstraints(fields as Record<string, unknown>, path, errors);
          }
        }
      }
      break;
    }
    case "quote": {
      walkSemantic(obj["expr"], [...path, "expr"], errors);
      break;
    }
    case "ref":
      break;
    case "fn": {
      walkSemantic(obj["body"], [...path, "body"], errors);
      break;
    }
  }
}

function checkPositions(
  id: string,
  fields: Record<string, unknown>,
  path: string[],
  errors: ValidationError[],
): void {
  const positions = getEvaluationPositions(id, fields);
  for (const pos of positions) {
    if (isPlainObject(pos) && (pos as Record<string, unknown>)["tisyn"] === "quote") {
      errors.push({
        level: 2,
        path,
        message: `Quote found at evaluation position in structural operation "${id}"`,
        code: QUOTE_AT_EVAL_POSITION,
      });
    }
  }
}

function checkTryConstraints(
  fields: Record<string, unknown>,
  path: string[],
  errors: ValidationError[],
): void {
  // At least one of catchBody or finally must be present
  if (fields["catchBody"] === undefined && fields["finally"] === undefined) {
    errors.push({
      level: 2,
      path,
      message: `"try" node requires at least one of "catchBody" or "finally"`,
      code: MALFORMED_EVAL,
    });
  }
  // catchParam must be a non-empty string when present
  if ("catchParam" in fields) {
    if (typeof fields["catchParam"] !== "string" || fields["catchParam"] === "") {
      errors.push({
        level: 2,
        path,
        message: `"try" node "catchParam" must be a non-empty string`,
        code: MALFORMED_EVAL,
      });
    }
    // catchParam requires catchBody
    if (fields["catchBody"] === undefined) {
      errors.push({
        level: 2,
        path,
        message: `"try" node "catchParam" requires "catchBody" to also be present`,
        code: MALFORMED_EVAL,
      });
    }
  }
  // finallyPayload must be a non-empty string when present
  if ("finallyPayload" in fields) {
    if (typeof fields["finallyPayload"] !== "string" || fields["finallyPayload"] === "") {
      errors.push({
        level: 2,
        path,
        message: `"try" node "finallyPayload" must be a non-empty string`,
        code: MALFORMED_EVAL,
      });
    }
    // finallyPayload requires finally
    if (fields["finally"] === undefined) {
      errors.push({
        level: 2,
        path,
        message: `"try" node "finallyPayload" requires "finally" to also be present`,
        code: MALFORMED_EVAL,
      });
    }
  }
  // finallyDefault requires finallyPayload
  if ("finallyDefault" in fields && fields["finallyDefault"] !== undefined) {
    if (!("finallyPayload" in fields)) {
      errors.push({
        level: 2,
        path,
        message: `"try" node "finallyDefault" requires "finallyPayload" to also be present`,
        code: MALFORMED_EVAL,
      });
    }
  }
}

/**
 * Evaluation positions table — ported from kernel validate.ts.
 * See Kernel Spec §5 and Conformance Suite §10.5.
 */
function getEvaluationPositions(id: string, fields: Record<string, unknown>): unknown[] {
  switch (id) {
    case "let":
      return [fields["value"], fields["body"]].filter((x) => x !== undefined);
    case "seq":
      return Array.isArray(fields["exprs"]) ? fields["exprs"] : [];
    case "if": {
      const positions: unknown[] = [fields["condition"], fields["then"]].filter(
        (x) => x !== undefined,
      );
      if ("else" in fields) positions.push(fields["else"]);
      return positions;
    }
    case "while": {
      const p: unknown[] = [];
      if (fields["condition"] !== undefined) p.push(fields["condition"]);
      if (Array.isArray(fields["exprs"])) p.push(...fields["exprs"]);
      return p;
    }
    case "call": {
      const p: unknown[] = [];
      if (fields["fn"] !== undefined) p.push(fields["fn"]);
      if (Array.isArray(fields["args"])) p.push(...fields["args"]);
      return p;
    }
    case "get":
      return fields["obj"] !== undefined ? [fields["obj"]] : [];
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "mod":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "eq":
    case "neq":
    case "and":
    case "or":
      return [fields["a"], fields["b"]].filter((x) => x !== undefined);
    case "not":
    case "neg":
      return fields["a"] !== undefined ? [fields["a"]] : [];
    case "construct":
      return Object.values(fields);
    case "array":
      return Array.isArray(fields["items"]) ? fields["items"] : [];
    case "concat":
      return Array.isArray(fields["parts"]) ? fields["parts"] : [];
    case "throw":
      return fields["message"] !== undefined ? [fields["message"]] : [];
    case "concat-arrays":
      return Array.isArray(fields["arrays"]) ? (fields["arrays"] as unknown[]) : [];
    case "merge-objects":
      return Array.isArray(fields["objects"]) ? (fields["objects"] as unknown[]) : [];
    case "try": {
      const p: unknown[] = [];
      if (fields["body"] !== undefined) p.push(fields["body"]);
      if (fields["catchBody"] !== undefined) p.push(fields["catchBody"]);
      if (fields["finally"] !== undefined) p.push(fields["finally"]);
      return p;
    }
    default:
      return [];
  }
}

// ── Convenience ──

export function assertValidIr(json: unknown): TisynExpr {
  const result = validateIr(json);
  if (!result.ok) {
    throw new MalformedIR(result.errors[0].message);
  }
  return result.node;
}
