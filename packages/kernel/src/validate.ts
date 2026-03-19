/**
 * IR Validation — two-phase validation per Conformance Suite §4.2.
 *
 * Phase 1 — Structural: Grammar conformance.
 * Phase 2 — Semantic: Single-Quote rule, positions table.
 *
 * NOT validated: Ref binding (runtime error per spec).
 * Validation is recursive over the entire tree.
 * Both phases MUST complete before evaluation begins.
 */

import {
  type Expr,
  classifyNode,
  isEvalNode,
  isQuoteNode,
  isRefNode,
  isFnNode,
  MalformedIR,
} from "@tisyn/shared";
import { isStructural } from "./classify.js";

/**
 * Validate an IR tree.
 * Throws MalformedIR if invalid.
 */
export function validate(expr: Expr): void {
  validateNode(expr);
}

function validateNode(node: unknown): void {
  // Primitives are always valid literals
  if (node === null || typeof node !== "object") return;

  // Arrays: validate each element
  if (Array.isArray(node)) {
    for (const item of node) {
      validateNode(item);
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  const classification = classifyNode(obj);

  if (classification === "malformed") {
    throw new MalformedIR(
      `Malformed IR node: tisyn="${obj["tisyn"]}", missing or invalid required fields`,
    );
  }

  if (classification === "literal") {
    // Plain object that's not an IR node — validate children recursively
    for (const value of Object.values(obj)) {
      validateNode(value);
    }
    return;
  }

  // It's a valid IR node — validate based on type
  switch (classification) {
    case "eval":
      validateEvalNode(obj as { tisyn: "eval"; id: string; data: unknown });
      break;
    case "quote":
      validateNode((obj as { expr: unknown }).expr);
      break;
    case "ref":
      // Ref binding is NOT validated — that's a runtime error
      break;
    case "fn":
      validateNode((obj as { body: unknown }).body);
      break;
  }
}

/**
 * Validate an Eval node.
 *
 * If the ID is structural, enforce the single-Quote rule:
 * - data MUST be a Quote node
 * - No Quote at any evaluation position
 */
function validateEvalNode(node: {
  tisyn: "eval";
  id: string;
  data: unknown;
}): void {
  // Validate data recursively first
  validateNode(node.data);

  // Phase 2: Single-Quote rule for structural operations
  if (isStructural(node.id)) {
    if (!isQuoteNode(node.data as Expr)) {
      throw new MalformedIR(
        `Structural operation "${node.id}" requires data to be a Quote node`,
      );
    }

    // Check positions — no Quote at evaluation positions
    const fields = (node.data as { expr: unknown }).expr;
    if (typeof fields === "object" && fields !== null) {
      checkPositions(node.id, fields as Record<string, unknown>);
    }
  }
}

/**
 * Positions table — evaluation positions per operation.
 * See Kernel Spec §5 and Conformance Suite §10.5.
 *
 * Only nodes at evaluation positions are checked for nested Quotes.
 */
function checkPositions(id: string, fields: Record<string, unknown>): void {
  const positions = getEvaluationPositions(id, fields);
  for (const pos of positions) {
    if (
      typeof pos === "object" &&
      pos !== null &&
      !Array.isArray(pos) &&
      (pos as Record<string, unknown>)["tisyn"] === "quote"
    ) {
      throw new MalformedIR(
        `Quote found at evaluation position in structural operation "${id}"`,
      );
    }
  }
}

/**
 * Returns the nodes at evaluation positions for a structural operation.
 * This is the exhaustive positions table from the spec.
 */
function getEvaluationPositions(
  id: string,
  fields: Record<string, unknown>,
): unknown[] {
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
      const wPositions: unknown[] = [];
      if (fields["condition"] !== undefined)
        wPositions.push(fields["condition"]);
      if (Array.isArray(fields["exprs"])) wPositions.push(...fields["exprs"]);
      return wPositions;
    }
    case "call": {
      const cPositions: unknown[] = [];
      if (fields["fn"] !== undefined) cPositions.push(fields["fn"]);
      if (Array.isArray(fields["args"])) cPositions.push(...fields["args"]);
      return cPositions;
    }
    case "get":
      // Only obj is an evaluation position, key is not
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
      // Each value is an evaluation position (not keys)
      return Object.values(fields);
    case "array":
      return Array.isArray(fields["items"]) ? fields["items"] : [];
    case "concat":
      return Array.isArray(fields["parts"]) ? fields["parts"] : [];
    case "throw":
      return fields["message"] !== undefined ? [fields["message"]] : [];
    default:
      return [];
  }
}
