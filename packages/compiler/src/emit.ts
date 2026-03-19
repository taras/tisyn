/**
 * Phases 2–4: Discover + Transform + Emit.
 *
 * Compiles TypeScript AST nodes into Tisyn IR.
 * Handles expressions, statements, effects, and control flow transforms.
 *
 * This module implements the full compilation pipeline from the
 * Compiler Specification §4–§10.
 */

import ts from "typescript";
import type { Expr } from "@tisyn/shared";
import {
  Let,
  If,
  While,
  Call,
  Get,
  Add,
  Sub,
  Mul,
  Div,
  Mod,
  Gt,
  Gte,
  Lt,
  Lte,
  Eq,
  Neq,
  And,
  Or,
  Not,
  Neg,
  Construct,
  ArrayNode,
  Concat,
  Throw,
  Ref,
  Fn,
  ExternalEval,
  AllEval,
  RaceEval,
} from "./ir-builders.js";
import { toAgentId } from "./agent-id.js";
import { Counter } from "./counter.js";
import { CompileError } from "./errors.js";
import { getLocation } from "./parse.js";

// ── Context ──

interface EmitContext {
  counter: Counter;
  sourceFile: ts.SourceFile;
}

function error(code: string, message: string, node: ts.Node, ctx: EmitContext): CompileError {
  const loc = getLocation(node, ctx.sourceFile);
  return new CompileError(code, message, loc.line, loc.column);
}

// ── Public API ──

/**
 * Compile a function body (Block) into a Tisyn IR expression.
 */
export function emitBlock(stmts: readonly ts.Statement[], ctx: EmitContext): Expr {
  return emitStatementList(Array.from(stmts), 0, ctx);
}

/**
 * Create an EmitContext for compilation.
 */
export function createContext(sourceFile: ts.SourceFile): EmitContext {
  return { counter: new Counter(), sourceFile };
}

// ── Statement compilation (Spec §5.1) ──

function emitStatementList(stmts: ts.Statement[], index: number, ctx: EmitContext): Expr {
  if (index >= stmts.length) return null as unknown as Expr;

  const stmt = stmts[index]!;
  const rest = () => emitStatementList(stmts, index + 1, ctx);
  const isLast = index === stmts.length - 1;

  // ── Return statement ──
  if (ts.isReturnStatement(stmt)) {
    if (stmt.expression) {
      return emitExpression(stmt.expression, ctx);
    }
    return null as unknown as Expr;
  }

  // ── Variable declaration: const x = expr ──
  if (ts.isVariableStatement(stmt)) {
    return emitVariableStatement(stmt, rest, ctx);
  }

  // ── Expression statement (bare yield*, function call, etc.) ──
  if (ts.isExpressionStatement(stmt)) {
    const expr = stmt.expression;

    // Check for unsupported constructs
    checkUnsupportedExpression(expr, ctx);

    // Bare yield* → discard the result
    if (ts.isYieldExpression(expr) && expr.asteriskToken && expr.expression) {
      const effect = emitYieldStar(expr.expression, ctx);
      if (isLast) {
        return effect;
      }
      const name = ctx.counter.next("discard");
      return Let(name, effect, rest());
    }

    // Bare expression — evaluate for side effects
    if (isLast) {
      return emitExpression(expr, ctx);
    }
    const name = ctx.counter.next("discard");
    return Let(name, emitExpression(expr, ctx), rest());
  }

  // ── If statement ──
  if (ts.isIfStatement(stmt)) {
    return emitIfStatement(stmt, stmts, index, ctx);
  }

  // ── While statement ──
  if (ts.isWhileStatement(stmt)) {
    return emitWhileStatement(stmt, rest, isLast, ctx);
  }

  // ── Throw statement ──
  if (ts.isThrowStatement(stmt) && stmt.expression) {
    return emitThrowStatement(stmt, ctx);
  }

  // ── Block (nested) ──
  if (ts.isBlock(stmt)) {
    const blockResult = emitBlock(stmt.statements, ctx);
    if (isLast) return blockResult;
    const name = ctx.counter.next("discard");
    return Let(name, blockResult, rest());
  }

  throw error("E999", `Unsupported statement: ${ts.SyntaxKind[stmt.kind]}`, stmt, ctx);
}

// ── Variable declarations ──

function emitVariableStatement(
  stmt: ts.VariableStatement,
  rest: () => Expr,
  ctx: EmitContext,
): Expr {
  const declList = stmt.declarationList;

  // Check for let/var → error
  if (declList.flags & ts.NodeFlags.Let) {
    throw error("E001", "Use 'const' instead of 'let'", stmt, ctx);
  }
  if (!(declList.flags & ts.NodeFlags.Const) && !(declList.flags & ts.NodeFlags.Let)) {
    // var declaration
    throw error("E002", "Use 'const' instead of 'var'", stmt, ctx);
  }

  let result = rest();

  // Process declarations in reverse to build correct Let nesting
  for (let i = declList.declarations.length - 1; i >= 0; i--) {
    const decl = declList.declarations[i]!;
    if (!ts.isIdentifier(decl.name)) {
      throw error("E005", "Destructuring is not supported", decl, ctx);
    }

    const name = decl.name.text;

    // Check for __ prefix
    if (name.startsWith("__")) {
      throw error("E028", "Variable names must not start with '__'", decl, ctx);
    }

    if (!decl.initializer) {
      throw error("E999", "Variables must have initializers", decl, ctx);
    }

    // Check if initializer is yield*
    if (
      ts.isYieldExpression(decl.initializer) &&
      decl.initializer.asteriskToken &&
      decl.initializer.expression
    ) {
      const effect = emitYieldStar(decl.initializer.expression, ctx);
      result = Let(name, effect, result);
    } else {
      // Check for unsupported patterns in initializer
      checkUnsupportedExpression(decl.initializer, ctx);
      result = Let(name, emitExpression(decl.initializer, ctx), result);
    }
  }

  return result;
}

// ── If statement (§6.1) ──

function emitIfStatement(
  stmt: ts.IfStatement,
  stmts: ts.Statement[],
  index: number,
  ctx: EmitContext,
): Expr {
  const condition = emitExpression(stmt.expression, ctx);

  // Check for early return: if the then-branch ends with return
  // and there's no else, absorb remaining statements into else
  const thenBranch = emitStatementBody(stmt.thenStatement, ctx);

  if (stmt.elseStatement) {
    const elseBranch = emitStatementBody(stmt.elseStatement, ctx);
    const ifExpr = If(condition, thenBranch, elseBranch);

    // If there are more statements after this if, need to handle them
    if (index < stmts.length - 1) {
      // If both branches return, remaining code is dead
      if (branchReturns(stmt.thenStatement) && branchReturns(stmt.elseStatement)) {
        return ifExpr;
      }
      const name = ctx.counter.next("discard");
      return Let(name, ifExpr, emitStatementList(stmts, index + 1, ctx));
    }
    return ifExpr;
  }

  // No else branch
  if (branchReturns(stmt.thenStatement)) {
    // Early return transform: remaining statements become else branch
    const rest = emitStatementList(stmts, index + 1, ctx);
    return If(condition, thenBranch, rest);
  }

  // No else, no early return — simple if
  if (index < stmts.length - 1) {
    const ifExpr = If(condition, thenBranch);
    const name = ctx.counter.next("discard");
    return Let(name, ifExpr, emitStatementList(stmts, index + 1, ctx));
  }

  return If(condition, thenBranch);
}

/** Check if a statement (or block) contains a return. */
function branchReturns(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt)) return true;
  if (ts.isBlock(stmt)) {
    return stmt.statements.some((s) => branchReturns(s));
  }
  if (ts.isIfStatement(stmt)) {
    const thenReturns = branchReturns(stmt.thenStatement);
    const elseReturns = stmt.elseStatement ? branchReturns(stmt.elseStatement) : false;
    return thenReturns && elseReturns;
  }
  return false;
}

/** Emit a single statement or block as a body expression. */
function emitStatementBody(stmt: ts.Statement, ctx: EmitContext): Expr {
  if (ts.isBlock(stmt)) {
    return emitBlock(stmt.statements, ctx);
  }
  return emitStatementList([stmt], 0, ctx);
}

// ── While statement (§6.2) ──

function emitWhileStatement(
  stmt: ts.WhileStatement,
  rest: () => Expr,
  isLast: boolean,
  ctx: EmitContext,
): Expr {
  // Detect return in body → Case B (recursive Fn + Call)
  const hasReturn = bodyContainsReturn(stmt.statement);

  if (hasReturn) {
    return emitWhileCaseB(stmt, rest, isLast, ctx);
  }

  // Case A: no return → While IR node
  const condition = emitExpression(stmt.expression, ctx);
  const bodyExprs = emitWhileBody(stmt.statement, ctx);
  const whileExpr = While(condition, bodyExprs);

  if (isLast) return whileExpr;
  const name = ctx.counter.next("while");
  return Let(name, whileExpr, rest());
}

/** Case B: while-with-return → recursive Fn + Call (§6.2) */
function emitWhileCaseB(
  stmt: ts.WhileStatement,
  rest: () => Expr,
  isLast: boolean,
  ctx: EmitContext,
): Expr {
  const loopName = ctx.counter.next("loop");
  const condition = stmt.expression;

  // Build the Fn body:
  // if (condition) { body; recurse } else { null }
  // where body has returns as-is (base case) and fall-through → recurse
  const bodyStmts = getBodyStatements(stmt.statement);

  // Transform: append a recursive call at the end of body statements
  // that don't return
  const transformedBody = emitLoopBody(bodyStmts, condition, loopName, ctx);

  const loopFn = Fn([], transformedBody);

  if (isLast) {
    return Let(loopName, loopFn, Call(Ref(loopName), []));
  }
  return Let(loopName, loopFn, Let(ctx.counter.next("discard"), Call(Ref(loopName), []), rest()));
}

/**
 * Emit loop body for Case B.
 * Wraps in condition check, and adds recursive call at fall-through points.
 */
function emitLoopBody(
  stmts: ts.Statement[],
  condition: ts.Expression,
  loopName: string,
  ctx: EmitContext,
): Expr {
  // Check if condition is `true` literal
  const isTrueCondition = condition.kind === ts.SyntaxKind.TrueKeyword;

  const bodyExpr = emitLoopStatements(stmts, 0, loopName, ctx);

  if (isTrueCondition) {
    // while(true) — no condition check needed, just body + recurse
    return bodyExpr;
  }

  // while(cond) — wrap in if(cond, body, null)
  const condExpr = emitExpression(condition, ctx);
  return If(condExpr, bodyExpr);
}

/**
 * Emit statements within a loop body (Case B).
 * Return statements become the value (base case).
 * End of body → recursive call (recursive case).
 */
function emitLoopStatements(
  stmts: ts.Statement[],
  index: number,
  loopName: string,
  ctx: EmitContext,
): Expr {
  if (index >= stmts.length) {
    // Fall-through: recurse
    return Call(Ref(loopName), []);
  }

  const stmt = stmts[index]!;
  const restLoop = () => emitLoopStatements(stmts, index + 1, loopName, ctx);

  // Return → base case (value propagates out)
  if (ts.isReturnStatement(stmt)) {
    if (stmt.expression) {
      return emitExpression(stmt.expression, ctx);
    }
    return null as unknown as Expr;
  }

  // Variable declaration
  if (ts.isVariableStatement(stmt)) {
    return emitVariableStatement(stmt, restLoop, ctx);
  }

  // If with return → early return pattern
  if (ts.isIfStatement(stmt)) {
    return emitLoopIfStatement(stmt, stmts, index, loopName, ctx);
  }

  // Expression statement
  if (ts.isExpressionStatement(stmt)) {
    const expr = stmt.expression;
    checkUnsupportedExpression(expr, ctx);

    if (ts.isYieldExpression(expr) && expr.asteriskToken && expr.expression) {
      const effect = emitYieldStar(expr.expression, ctx);
      const name = ctx.counter.next("discard");
      return Let(name, effect, restLoop());
    }

    const name = ctx.counter.next("discard");
    return Let(name, emitExpression(expr, ctx), restLoop());
  }

  // Throw
  if (ts.isThrowStatement(stmt) && stmt.expression) {
    return emitThrowStatement(stmt, ctx);
  }

  throw error("E999", `Unsupported statement in loop body: ${ts.SyntaxKind[stmt.kind]}`, stmt, ctx);
}

/** Handle if statements within a Case B loop body. */
function emitLoopIfStatement(
  stmt: ts.IfStatement,
  stmts: ts.Statement[],
  index: number,
  loopName: string,
  ctx: EmitContext,
): Expr {
  const condition = emitExpression(stmt.expression, ctx);
  const thenBranch = emitLoopBranch(stmt.thenStatement, loopName, ctx);

  if (stmt.elseStatement) {
    const elseBranch = emitLoopBranch(stmt.elseStatement, loopName, ctx);
    const ifExpr = If(condition, thenBranch, elseBranch);

    if (index < stmts.length - 1) {
      if (branchReturns(stmt.thenStatement) && branchReturns(stmt.elseStatement)) {
        return ifExpr;
      }
      const name = ctx.counter.next("discard");
      return Let(name, ifExpr, emitLoopStatements(stmts, index + 1, loopName, ctx));
    }
    return ifExpr;
  }

  // No else, early return in then → remaining statements become else
  if (branchReturns(stmt.thenStatement)) {
    const rest = emitLoopStatements(stmts, index + 1, loopName, ctx);
    return If(condition, thenBranch, rest);
  }

  if (index < stmts.length - 1) {
    const name = ctx.counter.next("discard");
    return Let(
      name,
      If(condition, thenBranch),
      emitLoopStatements(stmts, index + 1, loopName, ctx),
    );
  }

  return If(condition, thenBranch);
}

/** Emit a branch within a Case B loop body. */
function emitLoopBranch(stmt: ts.Statement, loopName: string, ctx: EmitContext): Expr {
  const stmts = getBodyStatements(stmt);
  return emitLoopStatements(stmts, 0, loopName, ctx);
}

// ── Helpers ──

function getBodyStatements(stmt: ts.Statement): ts.Statement[] {
  if (ts.isBlock(stmt)) {
    return Array.from(stmt.statements);
  }
  return [stmt];
}

function emitWhileBody(stmt: ts.Statement, ctx: EmitContext): Expr[] {
  const stmts = getBodyStatements(stmt);
  return stmts.map((s) => {
    if (ts.isExpressionStatement(s)) {
      const expr = s.expression;
      if (ts.isYieldExpression(expr) && expr.asteriskToken && expr.expression) {
        return emitYieldStar(expr.expression, ctx);
      }
      return emitExpression(expr, ctx);
    }
    if (ts.isVariableStatement(s)) {
      // In while body, each statement is independent
      // Return the expression to be evaluated
      const decl = s.declarationList.declarations[0]!;
      if (decl.initializer) {
        if (
          ts.isYieldExpression(decl.initializer) &&
          decl.initializer.asteriskToken &&
          decl.initializer.expression
        ) {
          return emitYieldStar(decl.initializer.expression, ctx);
        }
        return emitExpression(decl.initializer, ctx);
      }
    }
    return emitStatementList([s], 0, ctx);
  });
}

/** Recursively check if a statement body contains a return. */
function bodyContainsReturn(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt)) return true;
  if (ts.isBlock(stmt)) {
    return stmt.statements.some((s) => bodyContainsReturn(s));
  }
  if (ts.isIfStatement(stmt)) {
    if (bodyContainsReturn(stmt.thenStatement)) return true;
    if (stmt.elseStatement && bodyContainsReturn(stmt.elseStatement)) return true;
    return false;
  }
  return false;
}

// ── Throw (§7.9) ──

function emitThrowStatement(stmt: ts.ThrowStatement, ctx: EmitContext): Expr {
  const expr = stmt.expression!;

  // Must be `throw new Error(msg)`
  if (ts.isNewExpression(expr)) {
    const typeExpr = expr.expression;
    if (ts.isIdentifier(typeExpr) && typeExpr.text === "Error") {
      const arg = expr.arguments?.[0];
      if (arg) {
        return Throw(emitExpression(arg, ctx));
      }
      return Throw("" as unknown as Expr);
    }
  }

  throw error("E023", "Only 'throw new Error(...)' is allowed", stmt, ctx);
}

// ── yield* dispatch (§4) ──

function emitYieldStar(target: ts.Expression, ctx: EmitContext): Expr {
  // Case 1: yield* all([...]) or yield* race([...])
  if (ts.isCallExpression(target)) {
    const callee = target.expression;
    if (ts.isIdentifier(callee)) {
      if (callee.text === "all" || callee.text === "race") {
        return emitConcurrency(callee.text, target, ctx);
      }

      if (callee.text === "sleep") {
        // Built-in: yield* sleep(ms)
        const args = target.arguments.map((a) => emitExpression(a, ctx));
        return ExternalEval("sleep", args as unknown as Expr);
      }

      // Sub-workflow: yield* fn(args)
      const args = target.arguments.map((a) => emitExpression(a, ctx));
      return Call(Ref(callee.text), args);
    }

    // Case 2: yield* Agent().method(args) — agent effect
    if (ts.isPropertyAccessExpression(callee)) {
      return emitAgentEffect(callee, target.arguments, ctx);
    }
  }

  throw error(
    "E010",
    "yield* target must be an agent call, all/race, sleep, or sub-workflow",
    target,
    ctx,
  );
}

/** Emit agent effect: yield* Agent().method(args) → ExternalEval */
function emitAgentEffect(
  propAccess: ts.PropertyAccessExpression,
  args: ts.NodeArray<ts.Expression>,
  ctx: EmitContext,
): Expr {
  const methodName = propAccess.name.text;
  const receiver = propAccess.expression;

  // receiver should be a call: Agent()
  if (!ts.isCallExpression(receiver)) {
    throw error("E999", "Agent effect must be of the form Agent().method(args)", propAccess, ctx);
  }

  const agentFactory = receiver.expression;
  if (!ts.isIdentifier(agentFactory)) {
    throw error("E999", "Agent factory must be an identifier", agentFactory, ctx);
  }

  const agentId = toAgentId(agentFactory.text);
  const effectId = `${agentId}.${methodName}`;
  const compiledArgs = args.map((a) => emitExpression(a, ctx));

  // Data is an unquoted array (resolve at runtime) — Spec §4.2
  return ExternalEval(effectId, compiledArgs as unknown as Expr);
}

/** Emit all/race concurrency (§8) */
function emitConcurrency(
  kind: "all" | "race",
  callExpr: ts.CallExpression,
  ctx: EmitContext,
): Expr {
  const arg = callExpr.arguments[0];
  if (!arg || !ts.isArrayLiteralExpression(arg)) {
    throw error("E999", `${kind}() requires an array literal argument`, callExpr, ctx);
  }

  const children: Expr[] = [];

  for (const element of arg.elements) {
    if (ts.isArrowFunction(element)) {
      // Arrow thunk: () => Agent().method(args)
      // Unwrap the body
      if (ts.isBlock(element.body)) {
        children.push(emitBlock(element.body.statements, ctx));
      } else {
        children.push(emitExpression(element.body, ctx));
      }
    } else if (ts.isFunctionExpression(element) && element.asteriskToken) {
      // Generator function: function* () { ... }
      if (element.body) {
        children.push(emitBlock(element.body.statements, ctx));
      }
    } else {
      throw error(
        "E999",
        "all/race children must be arrow functions or generator functions",
        element,
        ctx,
      );
    }
  }

  if (kind === "all") {
    return AllEval(children);
  }
  return RaceEval(children);
}

// ── Expression compilation (§7) ──

export function emitExpression(node: ts.Expression, ctx: EmitContext): Expr {
  // Check for unsupported constructs first
  checkUnsupportedExpression(node, ctx);

  // ── Literals ──
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }

  if (ts.isStringLiteral(node)) {
    return node.text;
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return null as unknown as Expr;
  }

  // ── Identifiers → Ref ──
  if (ts.isIdentifier(node)) {
    return Ref(node.text);
  }

  // ── Parenthesized ──
  if (ts.isParenthesizedExpression(node)) {
    return emitExpression(node.expression, ctx);
  }

  // ── Property access: obj.prop → Get (§7.5) ──
  if (ts.isPropertyAccessExpression(node)) {
    const obj = emitExpression(node.expression, ctx);
    return Get(obj, node.name.text);
  }

  // ── Binary operators (§7.1–§7.4) ──
  if (ts.isBinaryExpression(node)) {
    return emitBinaryExpression(node, ctx);
  }

  // ── Prefix unary: !a, -a (§7.1) ──
  if (ts.isPrefixUnaryExpression(node)) {
    return emitPrefixUnary(node, ctx);
  }

  // ── Object literal → Construct (§7.6) ──
  if (ts.isObjectLiteralExpression(node)) {
    return emitObjectLiteral(node, ctx);
  }

  // ── Array literal → Array (§7.7) ──
  if (ts.isArrayLiteralExpression(node)) {
    const items = node.elements.map((e) => emitExpression(e, ctx));
    return ArrayNode(items);
  }

  // ── Template literal → Concat (§7.8) ──
  if (ts.isTemplateExpression(node)) {
    return emitTemplateLiteral(node, ctx);
  }

  // ── No-substitution template → string literal ──
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  // ── Arrow function → Fn (§9.1) ──
  if (ts.isArrowFunction(node)) {
    return emitArrowFunction(node, ctx);
  }

  // ── Call expression (non-yield*) ──
  if (ts.isCallExpression(node)) {
    return emitCallExpression(node, ctx);
  }

  // ── Conditional (ternary) → If ──
  if (ts.isConditionalExpression(node)) {
    const condition = emitExpression(node.condition, ctx);
    const then = emitExpression(node.whenTrue, ctx);
    const else_ = emitExpression(node.whenFalse, ctx);
    return If(condition, then, else_);
  }

  // ── yield* in expression position (e.g., return yield* ...) ──
  if (ts.isYieldExpression(node) && node.asteriskToken && node.expression) {
    return emitYieldStar(node.expression, ctx);
  }

  throw error("E999", `Unsupported expression: ${ts.SyntaxKind[node.kind]}`, node, ctx);
}

// ── Binary expressions ──

function emitBinaryExpression(node: ts.BinaryExpression, ctx: EmitContext): Expr {
  const left = emitExpression(node.left, ctx);
  const right = emitExpression(node.right, ctx);

  switch (node.operatorToken.kind) {
    // Arithmetic — strict: always number
    case ts.SyntaxKind.PlusToken:
      return Add(left, right);
    case ts.SyntaxKind.MinusToken:
      return Sub(left, right);
    case ts.SyntaxKind.AsteriskToken:
      return Mul(left, right);
    case ts.SyntaxKind.SlashToken:
      return Div(left, right);
    case ts.SyntaxKind.PercentToken:
      return Mod(left, right);

    // Comparison
    case ts.SyntaxKind.GreaterThanToken:
      return Gt(left, right);
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return Gte(left, right);
    case ts.SyntaxKind.LessThanToken:
      return Lt(left, right);
    case ts.SyntaxKind.LessThanEqualsToken:
      return Lte(left, right);

    // Equality — must use === and !==
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return Eq(left, right);
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return Neq(left, right);

    // Loose equality → error
    case ts.SyntaxKind.EqualsEqualsToken:
      throw error("E999", "Use === instead of ==", node, ctx);
    case ts.SyntaxKind.ExclamationEqualsToken:
      throw error("E999", "Use !== instead of !=", node, ctx);

    // Logical
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return And(left, right);
    case ts.SyntaxKind.BarBarToken:
      return Or(left, right);

    // Assignment → error
    case ts.SyntaxKind.EqualsToken:
      throw error("E003", "Reassignment is not allowed", node, ctx);

    default:
      throw error(
        "E999",
        `Unsupported binary operator: ${ts.SyntaxKind[node.operatorToken.kind]}`,
        node,
        ctx,
      );
  }
}

// ── Prefix unary ──

function emitPrefixUnary(node: ts.PrefixUnaryExpression, ctx: EmitContext): Expr {
  const operand = emitExpression(node.operand, ctx);

  switch (node.operator) {
    case ts.SyntaxKind.ExclamationToken:
      return Not(operand);
    case ts.SyntaxKind.MinusToken:
      return Neg(operand);
    default:
      throw error(
        "E999",
        `Unsupported prefix operator: ${ts.SyntaxKind[node.operator]}`,
        node,
        ctx,
      );
  }
}

// ── Object literal → Construct (§7.6) ──

function emitObjectLiteral(node: ts.ObjectLiteralExpression, ctx: EmitContext): Expr {
  const fields: Record<string, Expr> = {};

  for (const prop of node.properties) {
    if (ts.isPropertyAssignment(prop)) {
      let key: string;
      if (ts.isIdentifier(prop.name)) {
        key = prop.name.text;
      } else if (ts.isStringLiteral(prop.name)) {
        key = prop.name.text;
      } else {
        throw error("E005", "Computed property keys are not allowed", prop, ctx);
      }
      fields[key] = emitExpression(prop.initializer, ctx);
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      // { x } → { x: Ref("x") }
      const key = prop.name.text;
      fields[key] = Ref(key);
    } else {
      throw error("E999", "Only property assignments are supported in object literals", prop, ctx);
    }
  }

  return Construct(fields);
}

// ── Template literal → Concat (§7.8) ──

function emitTemplateLiteral(node: ts.TemplateExpression, ctx: EmitContext): Expr {
  const parts: Expr[] = [];

  if (node.head.text) {
    parts.push(node.head.text);
  }

  for (const span of node.templateSpans) {
    parts.push(emitExpression(span.expression, ctx));
    if (span.literal.text) {
      parts.push(span.literal.text);
    }
  }

  return Concat(parts);
}

// ── Arrow function → Fn (§9.1) ──

function emitArrowFunction(node: ts.ArrowFunction, ctx: EmitContext): Expr {
  // Must have expression body, not block body
  if (ts.isBlock(node.body)) {
    throw error("E024", "Arrow functions must have expression bodies", node, ctx);
  }

  const params: string[] = [];
  for (const param of node.parameters) {
    if (ts.isIdentifier(param.name)) {
      params.push(param.name.text);
    } else {
      throw error("E999", "Destructuring in arrow params not supported", param, ctx);
    }
  }

  const body = emitExpression(node.body, ctx);
  return Fn(params, body);
}

// ── Call expression (non-yield*) ──

function emitCallExpression(node: ts.CallExpression, ctx: EmitContext): Expr {
  const callee = node.expression;

  // f(args) → Call(Ref("f"), [args])
  if (ts.isIdentifier(callee)) {
    const args = node.arguments.map((a) => emitExpression(a, ctx));
    return Call(Ref(callee.text), args);
  }

  // Agent().method(args) → ExternalEval("agent-id.method", [args])
  // This handles the pattern when it appears outside yield* context
  // (e.g., inside all/race arrow bodies)
  if (ts.isPropertyAccessExpression(callee)) {
    return emitAgentEffect(callee, node.arguments, ctx);
  }

  throw error("E999", "Only direct function calls are supported", node, ctx);
}

// ── Unsupported construct detection (§11) ──

function checkUnsupportedExpression(node: ts.Expression, ctx: EmitContext): void {
  // yield without * → E017
  if (ts.isYieldExpression(node) && !node.asteriskToken) {
    throw error("E017", "yield without * is not allowed", node, ctx);
  }

  // await → E009
  if (ts.isAwaitExpression(node)) {
    throw error("E009", "async/await is not allowed", node, ctx);
  }

  // typeof → E019
  if (ts.isTypeOfExpression(node)) {
    throw error("E019", "typeof is not allowed", node, ctx);
  }

  // delete → E029
  if (ts.isDeleteExpression(node)) {
    throw error("E029", "delete operator is not allowed", node, ctx);
  }

  // this → E016
  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    throw error("E016", "this is not allowed", node, ctx);
  }

  // Property mutation (assignment to property) — checked in binary
  if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left)) {
    if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      throw error("E004", "Property mutation is not allowed", node, ctx);
    }
  }

  // Element access → E005
  if (ts.isElementAccessExpression(node)) {
    throw error("E005", "Computed property access is not allowed", node, ctx);
  }

  // new Map/Set → E008
  if (ts.isNewExpression(node)) {
    const typeExpr = node.expression;
    if (ts.isIdentifier(typeExpr)) {
      if (typeExpr.text === "Map" || typeExpr.text === "Set") {
        throw error("E008", "Map/Set constructors are not allowed", node, ctx);
      }
    }
  }

  // Property access checks for nondeterministic APIs
  if (ts.isPropertyAccessExpression(node)) {
    const obj = node.expression;
    if (ts.isIdentifier(obj)) {
      if (obj.text === "Math" && node.name.text === "random") {
        throw error("E006", "Math.random() is not allowed", node, ctx);
      }
      if (obj.text === "Date" && node.name.text === "now") {
        throw error("E007", "Date.now() is not allowed", node, ctx);
      }
    }
  }

  // Call checks for forbidden patterns
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) {
      if (callee.text === "eval") {
        throw error("E014", "eval() is not allowed", node, ctx);
      }
      if (callee.text === "Promise") {
        throw error("E021", "Promise is not allowed", node, ctx);
      }
    }
    // new Function() → E014
    if (ts.isPropertyAccessExpression(callee)) {
      if (ts.isIdentifier(callee.expression) && callee.expression.text === "Math") {
        if (callee.name.text === "random") {
          throw error("E006", "Math.random() is not allowed (nondeterministic)", node, ctx);
        }
      }
      if (ts.isIdentifier(callee.expression) && callee.expression.text === "Date") {
        if (callee.name.text === "now") {
          throw error("E007", "Date.now() is not allowed (nondeterministic)", node, ctx);
        }
      }
    }
  }
}
