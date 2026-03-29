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
import type { TisynExpr as Expr } from "@tisyn/ir";
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
  Try,
  Ref,
  Fn,
  ConcatArrays,
  MergeObjects,
  ExternalEval,
  AllEval,
  RaceEval,
} from "./ir-builders.js";
import { toAgentId } from "./agent-id.js";
import { Counter } from "./counter.js";
import { CompileError } from "./errors.js";
import { getLocation } from "./parse.js";
import type { DiscoveredContract } from "./discover.js";

// ── Context ──

interface BindingInfo {
  kind: "let" | "const";
  version: number;
}

type ScopeFrame = Map<string, BindingInfo>;

interface EmitContext {
  counter: Counter;
  sourceFile: ts.SourceFile;
  contracts?: Map<string, DiscoveredContract>;
  /** SSA binding scope stack. Innermost frame is last. */
  scopeStack: ScopeFrame[];
}

// ── Scope helpers ──

/** Push a new empty scope frame. */
function pushFrame(ctx: EmitContext): void {
  ctx.scopeStack.push(new Map());
}

/** Pop the innermost scope frame. */
function popFrame(ctx: EmitContext): void {
  ctx.scopeStack.pop();
}

/** Look up a binding from the top of the stack down. Returns undefined if not found. */
function lookupBinding(
  name: string,
  ctx: EmitContext,
): { frame: ScopeFrame; info: BindingInfo } | undefined {
  for (let i = ctx.scopeStack.length - 1; i >= 0; i--) {
    const frame = ctx.scopeStack[i]!;
    const info = frame.get(name);
    if (info !== undefined) return { frame, info };
  }
  return undefined;
}

/** Declare a new binding in the current (innermost) frame. */
function declareBinding(name: string, kind: "let" | "const", ctx: EmitContext): void {
  const frame = ctx.scopeStack[ctx.scopeStack.length - 1]!;
  frame.set(name, { kind, version: 0 });
}

/** Get the versioned IR name for a binding (e.g. "x_0", "x_1"). */
function versionedName(name: string, info: BindingInfo): string {
  return info.kind === "let" ? `${name}_${info.version}` : name;
}

/** Bump the version of a let binding in its owning frame. Returns the new versioned name. */
function bumpVersion(name: string, ctx: EmitContext): string {
  const found = lookupBinding(name, ctx);
  if (!found || found.info.kind !== "let") {
    throw new Error(`Cannot bump version of non-let binding: ${name}`);
  }
  found.info.version++;
  return `${name}_${found.info.version}`;
}

/** Resolve a reference: return versioned name if it's a tracked let binding. */
function resolveRef(name: string, ctx: EmitContext): string {
  const found = lookupBinding(name, ctx);
  if (found) return versionedName(name, found.info);
  return name; // untracked (e.g. const declared before SSA, external)
}

/** Deep-clone the scope stack. Used before compiling branches. */
function cloneScopeStack(stack: ScopeFrame[]): ScopeFrame[] {
  return stack.map((frame) => {
    const newFrame = new Map<string, BindingInfo>();
    for (const [k, v] of frame) {
      newFrame.set(k, { kind: v.kind, version: v.version });
    }
    return newFrame;
  });
}

/** Snapshot current versions of all let bindings across the scope stack. */
function snapshotVersions(ctx: EmitContext): Map<string, number> {
  const snap = new Map<string, number>();
  for (const frame of ctx.scopeStack) {
    for (const [name, info] of frame) {
      if (info.kind === "let" && !snap.has(name)) {
        snap.set(name, info.version);
      }
    }
  }
  return snap;
}

function error(code: string, message: string, node: ts.Node, ctx: EmitContext): CompileError {
  const loc = getLocation(node, ctx.sourceFile);
  return new CompileError(code, message, loc.line, loc.column);
}

// ── Public API ──

/**
 * Compile a function body (Block) into a Tisyn IR expression.
 * Pushes a scope frame for the block and pops it after.
 */
export function emitBlock(stmts: readonly ts.Statement[], ctx: EmitContext): Expr {
  pushFrame(ctx);
  try {
    return emitStatementList(Array.from(stmts), 0, ctx);
  } finally {
    popFrame(ctx);
  }
}

/**
 * Create an EmitContext for compilation.
 */
export function createContext(
  sourceFile: ts.SourceFile,
  contracts?: Map<string, DiscoveredContract>,
): EmitContext {
  return { counter: new Counter(), sourceFile, contracts, scopeStack: [new Map()] };
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

  // ── Expression statement (bare yield*, assignment, function call, etc.) ──
  if (ts.isExpressionStatement(stmt)) {
    const expr = stmt.expression;

    // ── Let reassignment: x = newExpr (statement position) ──
    if (
      ts.isBinaryExpression(expr) &&
      expr.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(expr.left)
    ) {
      return emitLetReassignment(expr, stmts, index, rest, ctx);
    }

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

  // ── Try statement ──
  if (ts.isTryStatement(stmt)) {
    return emitTryStatement(stmt, stmts, index, ctx);
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

// ── Let reassignment ──

function emitLetReassignment(
  expr: ts.BinaryExpression,
  stmts: ts.Statement[],
  index: number,
  rest: () => Expr,
  ctx: EmitContext,
): Expr {
  const lhsName = (expr.left as ts.Identifier).text;

  // Validate: must be a let binding in scope
  const found = lookupBinding(lhsName, ctx);
  if (!found) {
    throw error(
      "E003",
      `Reassignment of non-let binding or undeclared name is not allowed`,
      expr,
      ctx,
    );
  }
  if (found.info.kind !== "let") {
    throw error(
      "E003",
      `Reassignment of non-let binding or undeclared name is not allowed`,
      expr,
      ctx,
    );
  }

  // Emit the new value expression
  const newValue = emitExpression(expr.right, ctx);

  // Bump version and emit Let binding
  const newIrName = bumpVersion(lhsName, ctx);
  const isLast = index === stmts.length - 1;

  if (isLast) {
    return Let(newIrName, newValue, null as unknown as Expr);
  }
  return Let(newIrName, newValue, rest());
}

// ── Variable declarations ──

function emitVariableStatement(
  stmt: ts.VariableStatement,
  rest: () => Expr,
  ctx: EmitContext,
): Expr {
  const declList = stmt.declarationList;

  const isLet = !!(declList.flags & ts.NodeFlags.Let);
  const isConst = !!(declList.flags & ts.NodeFlags.Const);

  // var declaration → error
  if (!isLet && !isConst) {
    throw error("E002", "Use 'const' instead of 'var'", stmt, ctx);
  }

  const kind: "let" | "const" = isLet ? "let" : "const";

  // Process declarations left-to-right so each binding is in scope before rest() is called.
  // This is critical: rest() must see all bindings from this statement.
  function processDecl(i: number): Expr {
    if (i >= declList.declarations.length) return rest();

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

    // Emit initializer BEFORE declaring (so x = x + 1 sees old x)
    let initExpr: Expr;
    if (
      ts.isYieldExpression(decl.initializer) &&
      decl.initializer.asteriskToken &&
      decl.initializer.expression
    ) {
      initExpr = emitYieldStar(decl.initializer.expression, ctx);
    } else {
      checkUnsupportedExpression(decl.initializer, ctx);
      initExpr = emitExpression(decl.initializer, ctx);
    }

    // Register in scope stack AFTER evaluating initializer, BEFORE rest
    declareBinding(name, kind, ctx);
    const irName = isLet ? `${name}_0` : name;

    return Let(irName, initExpr, processDecl(i + 1));
  }

  return processDecl(0);
}

// ── If statement (§6.1) ──

/**
 * Determine whether every execution path through a statement reaches a return or throw.
 * Used for branch-join and early-return transforms.
 */
function alwaysTerminates(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt)) return true;
  if (ts.isThrowStatement(stmt)) return true;
  if (ts.isBlock(stmt)) {
    // Block always terminates if any top-level statement always terminates
    // (sequential: once a terminating statement is hit, rest is dead code)
    return stmt.statements.some((s) => alwaysTerminates(s));
  }
  if (ts.isIfStatement(stmt)) {
    // If-with-else terminates only when both branches always terminate
    if (!stmt.elseStatement) return false;
    return alwaysTerminates(stmt.thenStatement) && alwaysTerminates(stmt.elseStatement);
  }
  return false;
}

/** Compile a branch block into an expression that produces join values for `joinVars`.
 * Only used when the branch does NOT always terminate (i.e., in the neither-terminates path).
 *
 * @param block - the branch statement (block or single statement)
 * @param joinVars - variable names whose post-branch versions to collect
 * @param branchCtx - an isolated context (cloned scope stack) for this branch
 */
function compileBranchToExpr(
  block: ts.Statement,
  joinVars: string[],
  branchCtx: EmitContext,
): Expr {
  const stmts = getBodyStatements(block);

  // Compile the statements normally, building the continuation chain.
  // The terminal continuation produces the join values.
  return emitStatementListWithTerminal(stmts, 0, branchCtx, () => {
    // Terminal: produce join values
    if (joinVars.length === 0) {
      return null as unknown as Expr;
    }
    if (joinVars.length === 1) {
      const v = joinVars[0]!;
      return Ref(resolveRef(v, branchCtx));
    }
    // Multiple: pack into Construct
    const fields: Record<string, Expr> = {};
    for (const v of joinVars) {
      fields[v] = Ref(resolveRef(v, branchCtx));
    }
    return Construct(fields);
  });
}

/** Like emitStatementList but accepts a terminal function for the end of the list. */
function emitStatementListWithTerminal(
  stmts: ts.Statement[],
  index: number,
  ctx: EmitContext,
  terminal: () => Expr,
): Expr {
  if (index >= stmts.length) return terminal();

  const stmt = stmts[index]!;
  const rest = () => emitStatementListWithTerminal(stmts, index + 1, ctx, terminal);
  const isLast = index === stmts.length - 1;

  // Return statement
  if (ts.isReturnStatement(stmt)) {
    if (stmt.expression) return emitExpression(stmt.expression, ctx);
    return null as unknown as Expr;
  }

  // Variable declaration
  if (ts.isVariableStatement(stmt)) {
    return emitVariableStatementWithRest(stmt, rest, ctx);
  }

  // Let reassignment (x = newExpr)
  if (
    ts.isExpressionStatement(stmt) &&
    ts.isBinaryExpression(stmt.expression) &&
    stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(stmt.expression.left)
  ) {
    const expr = stmt.expression;
    const lhsName = (expr.left as ts.Identifier).text;
    const found = lookupBinding(lhsName, ctx);
    if (!found || found.info.kind !== "let") {
      throw new CompileError(
        "E003",
        "Reassignment of non-let binding or undeclared name is not allowed",
        0,
        0,
      );
    }
    const newValue = emitExpression(expr.right, ctx);
    const newIrName = bumpVersion(lhsName, ctx);
    if (isLast) return Let(newIrName, newValue, terminal());
    return Let(newIrName, newValue, rest());
  }

  // Expression statement
  if (ts.isExpressionStatement(stmt)) {
    const expr = stmt.expression;
    checkUnsupportedExpression(expr, ctx);
    if (ts.isYieldExpression(expr) && expr.asteriskToken && expr.expression) {
      const effect = emitYieldStar(expr.expression, ctx);
      if (isLast) return Let(ctx.counter.next("discard"), effect, terminal());
      return Let(ctx.counter.next("discard"), effect, rest());
    }
    if (isLast) return Let(ctx.counter.next("discard"), emitExpression(expr, ctx), terminal());
    return Let(ctx.counter.next("discard"), emitExpression(expr, ctx), rest());
  }

  // Throw statement
  if (ts.isThrowStatement(stmt) && stmt.expression) {
    return emitThrowStatement(stmt, ctx);
  }

  // Nested block
  if (ts.isBlock(stmt)) {
    pushFrame(ctx);
    try {
      // The terminal passed below inlines the continuation, so blockResult already
      // contains rest() or terminal(). Return it directly — do NOT wrap in
      // Let(discard, blockResult, rest()), which would call rest() a second time.
      const blockResult = emitStatementListWithTerminal(
        Array.from(stmt.statements),
        0,
        ctx,
        index === stmts.length - 1 ? terminal : rest,
      );
      return blockResult;
    } finally {
      popFrame(ctx);
    }
  }

  // If statement in branch
  if (ts.isIfStatement(stmt)) {
    return emitIfStatementInList(stmt, stmts, index, ctx, terminal);
  }

  throw new CompileError(
    "E999",
    `Unsupported statement in branch: ${ts.SyntaxKind[stmt.kind]}`,
    0,
    0,
  );
}

/** Emit a variable statement using a provided rest thunk (for use in branch contexts). */
function emitVariableStatementWithRest(
  stmt: ts.VariableStatement,
  rest: () => Expr,
  ctx: EmitContext,
): Expr {
  return emitVariableStatement(stmt, rest, ctx);
}

/** Emit an if-statement when it appears inside a branch-compilation context. */
function emitIfStatementInList(
  stmt: ts.IfStatement,
  stmts: ts.Statement[],
  index: number,
  ctx: EmitContext,
  terminal: () => Expr,
): Expr {
  const rest = () => emitStatementListWithTerminal(stmts, index + 1, ctx, terminal);
  const condition = emitExpression(stmt.expression, ctx);

  // Check termination classification
  const thenTerminates = alwaysTerminates(stmt.thenStatement);
  const elseTerminates = stmt.elseStatement ? alwaysTerminates(stmt.elseStatement) : false;

  if (thenTerminates && (elseTerminates || !stmt.elseStatement)) {
    // Both (or then-only without else) terminate
    const thenBranch = emitStatementBodyWithCtx(stmt.thenStatement, ctx);
    if (stmt.elseStatement) {
      const elseBranch = emitStatementBodyWithCtx(stmt.elseStatement, ctx);
      return If(condition, thenBranch, elseBranch);
    }
    return If(condition, thenBranch, rest());
  }

  if (thenTerminates && stmt.elseStatement && !elseTerminates) {
    // Then terminates, else falls through.
    // Compile the terminating branch in an isolated clone so that any SSA bumps it
    // performs (e.g. x = 1; return x) do not pollute the version state seen by the
    // fallthrough else branch and its continuation.
    const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const thenBranch = emitStatementBodyWithCtx(stmt.thenStatement, thenCtx);
    const elseAndRest = emitStatementListWithTerminal(
      getBodyStatements(stmt.elseStatement),
      0,
      ctx,
      index < stmts.length - 1 ? rest : terminal,
    );
    return If(condition, thenBranch, elseAndRest);
  }

  if (!thenTerminates && elseTerminates) {
    // Else terminates, then falls through.
    // Clone elseCtx before then mutates ctx so the terminating else branch sees
    // pre-if versions (not the versions left by the then branch compilation).
    const elseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const thenAndRest = emitStatementListWithTerminal(
      getBodyStatements(stmt.thenStatement),
      0,
      ctx,
      index < stmts.length - 1 ? rest : terminal,
    );
    const elseBranch = emitStatementBodyWithCtx(stmt.elseStatement!, elseCtx);
    return If(condition, thenAndRest, elseBranch);
  }

  // Neither terminates — full SSA join (mirrors emitIfStatement)
  const snapshot = snapshotVersions(ctx);
  const allLetVars = getAllLetVars(ctx);
  const dryThenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const dryElseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  compileBranchBodyToJoin(getBodyStatements(stmt.thenStatement), allLetVars, snapshot, dryThenCtx);
  if (stmt.elseStatement)
    compileBranchBodyToJoin(
      getBodyStatements(stmt.elseStatement),
      allLetVars,
      snapshot,
      dryElseCtx,
    );

  const joinVars = allLetVars.filter((v) => {
    const thenVer = getVersion(v, dryThenCtx);
    const elseVer = stmt.elseStatement ? getVersion(v, dryElseCtx) : (snapshot.get(v) ?? 0);
    return thenVer !== (snapshot.get(v) ?? 0) || elseVer !== (snapshot.get(v) ?? 0);
  });

  if (joinVars.length === 0) {
    const thenBranch = emitStatementBodyWithCtx(stmt.thenStatement, ctx);
    if (stmt.elseStatement) {
      const elseBranch = emitStatementBodyWithCtx(stmt.elseStatement, ctx);
      return Let(ctx.counter.next("discard"), If(condition, thenBranch, elseBranch), rest());
    }
    return Let(ctx.counter.next("discard"), If(condition, thenBranch), rest());
  }

  const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const elseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const thenJoinExpr = compileBranchToExpr(stmt.thenStatement, joinVars, thenCtx);
  const elseJoinExpr = stmt.elseStatement
    ? compileBranchToExpr(stmt.elseStatement, joinVars, elseCtx)
    : buildJoinExprFromSnapshot(joinVars, snapshot);

  applyJoinVersions(joinVars, ctx);

  if (joinVars.length === 1) {
    const v = joinVars[0]!;
    return Let(resolveRef(v, ctx), If(condition, thenJoinExpr, elseJoinExpr), rest());
  }

  const joinName = ctx.counter.next("j");
  let result = rest();
  for (let i = joinVars.length - 1; i >= 0; i--) {
    const v = joinVars[i]!;
    result = Let(resolveRef(v, ctx), Get(Ref(joinName), v), result);
  }
  return Let(joinName, If(condition, thenJoinExpr, elseJoinExpr), result);
}

function emitStatementBodyWithCtx(stmt: ts.Statement, ctx: EmitContext): Expr {
  return emitStatementBody(stmt, ctx);
}

function emitIfStatement(
  stmt: ts.IfStatement,
  stmts: ts.Statement[],
  index: number,
  ctx: EmitContext,
): Expr {
  const condition = emitExpression(stmt.expression, ctx);
  const hasMore = index < stmts.length - 1;
  const rest = () => emitStatementList(stmts, index + 1, ctx);

  const thenTerminates = alwaysTerminates(stmt.thenStatement);
  const elseTerminates = stmt.elseStatement ? alwaysTerminates(stmt.elseStatement) : false;

  // ── Both terminate ──
  // Each branch is compiled in its own clone so SSA bumps in one branch (e.g.
  // x = 1; return x) do not bleed into the other branch's version numbering.
  if (thenTerminates && elseTerminates) {
    const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const thenBranch = emitStatementBody(stmt.thenStatement, thenCtx);
    const elseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const elseBranch = emitStatementBody(stmt.elseStatement!, elseCtx);
    return If(condition, thenBranch, elseBranch);
  }

  // ── No-else early return: then terminates, no explicit else ──
  // Compile the terminating branch in a clone so its SSA bumps do not pollute
  // the version state seen by rest() (the implicit fallthrough).
  if (thenTerminates && !stmt.elseStatement) {
    const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const thenBranch = emitStatementBody(stmt.thenStatement, thenCtx);
    if (!hasMore) return If(condition, thenBranch);
    return If(condition, thenBranch, rest());
  }

  // ── Then terminates, explicit non-terminating else ──
  // The terminating then branch is compiled in a clone (its mutations must not
  // affect the else fallthrough). The else is compiled directly against ctx so
  // that rest() — which captures ctx by reference — naturally sees the
  // post-else versions when it is invoked at the end of the else body.
  if (thenTerminates && stmt.elseStatement && !elseTerminates) {
    const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const thenBranch = emitStatementBody(stmt.thenStatement, thenCtx);
    const elseAndRest = hasMore
      ? emitStatementListWithTerminal(getBodyStatements(stmt.elseStatement), 0, ctx, rest)
      : emitStatementBody(stmt.elseStatement, ctx);
    return If(condition, thenBranch, elseAndRest);
  }

  // ── Else terminates, then falls through ──
  // The terminating else branch is compiled in a clone. The then branch is
  // compiled directly against ctx so that rest() sees the post-then versions.
  if (!thenTerminates && elseTerminates && stmt.elseStatement) {
    const elseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const thenAndRest = hasMore
      ? emitStatementListWithTerminal(getBodyStatements(stmt.thenStatement), 0, ctx, rest)
      : emitStatementBody(stmt.thenStatement, ctx);
    const elseBranch = emitStatementBody(stmt.elseStatement, elseCtx);
    return If(condition, thenAndRest, elseBranch);
  }

  // ── Neither terminates: compute SSA join ──
  const snapshot = snapshotVersions(ctx);
  const allLetVars = getAllLetVars(ctx);

  // Phase 1: dry-run in isolated contexts to detect which vars change per branch.
  // These contexts are discarded after version detection.
  const dryThenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const dryElseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const thenBodyStmts = getBodyStatements(stmt.thenStatement);
  const elseBodyStmts = stmt.elseStatement ? getBodyStatements(stmt.elseStatement) : [];
  compileBranchBodyToJoin(thenBodyStmts, allLetVars, snapshot, dryThenCtx);
  if (stmt.elseStatement) compileBranchBodyToJoin(elseBodyStmts, allLetVars, snapshot, dryElseCtx);

  const joinVars = allLetVars.filter((v) => {
    const thenVersion = getVersion(v, dryThenCtx);
    const elseVersion = stmt.elseStatement ? getVersion(v, dryElseCtx) : (snapshot.get(v) ?? 0);
    return thenVersion !== (snapshot.get(v) ?? 0) || elseVersion !== (snapshot.get(v) ?? 0);
  });

  if (joinVars.length === 0) {
    // No variables changed — simple if
    if (stmt.elseStatement) {
      const thenBranch = emitStatementBody(stmt.thenStatement, ctx);
      const elseBranch = emitStatementBody(stmt.elseStatement, ctx);
      const ifExpr = If(condition, thenBranch, elseBranch);
      if (!hasMore) return ifExpr;
      return Let(ctx.counter.next("discard"), ifExpr, rest());
    }
    const thenBranch = emitStatementBody(stmt.thenStatement, ctx);
    const ifExpr = If(condition, thenBranch);
    if (!hasMore) return ifExpr;
    return Let(ctx.counter.next("discard"), ifExpr, rest());
  }

  // Phase 2: compile branches as join-producing expressions using fresh clones.
  const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const elseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const thenJoinExpr = compileBranchToExpr(stmt.thenStatement, joinVars, thenCtx);
  const elseJoinExpr = stmt.elseStatement
    ? compileBranchToExpr(stmt.elseStatement, joinVars, elseCtx)
    : buildJoinExprFromSnapshot(joinVars, snapshot);

  // Update main scope stack versions to post-join
  applyJoinVersions(joinVars, ctx);

  if (joinVars.length === 1) {
    const v = joinVars[0]!;
    const joinIrName = resolveRef(v, ctx);
    const ifExpr = If(condition, thenJoinExpr, elseJoinExpr);
    if (!hasMore) return Let(joinIrName, ifExpr, null as unknown as Expr);
    return Let(joinIrName, ifExpr, rest());
  }

  // Multiple join vars: pack into Construct, destructure with Get
  const joinName = ctx.counter.next("j");
  const ifExpr = If(condition, thenJoinExpr, elseJoinExpr);
  let result = hasMore ? rest() : (null as unknown as Expr);
  for (let i = joinVars.length - 1; i >= 0; i--) {
    const v = joinVars[i]!;
    const joinIrName = resolveRef(v, ctx);
    result = Let(joinIrName, Get(Ref(joinName), v), result);
  }
  return Let(joinName, ifExpr, result);
}

/** Return true if the statement (or any descendant) contains a return statement. */
function blockContainsReturn(stmt: ts.Statement | undefined): boolean {
  if (!stmt) return false;
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isReturnStatement(node)) {
      found = true;
      return;
    }
    // Do not descend into nested function bodies (they have their own returns)
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))
      return;
    ts.forEachChild(node, visit);
  }
  visit(stmt);
  return found;
}

/** Return true if the statement contains an assignment to any outer let binding. */
function finallyContainsOuterAssignment(stmt: ts.Statement, ctx: EmitContext): string | undefined {
  let found: string | undefined;
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const name = node.left.text;
      const binding = lookupBinding(name, ctx);
      if (binding && binding.info.kind === "let") {
        found = name;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(stmt);
  return found;
}

function emitTryStatement(
  stmt: ts.TryStatement,
  stmts: ts.Statement[],
  index: number,
  ctx: EmitContext,
): Expr {
  const hasMore = index < stmts.length - 1;
  const rest = () => emitStatementList(stmts, index + 1, ctx);

  // ── Validation: step 1 — return in any clause → E033 ──
  if (
    blockContainsReturn(stmt.tryBlock) ||
    blockContainsReturn(stmt.catchClause?.block) ||
    blockContainsReturn(stmt.finallyBlock)
  ) {
    throw error("E033", "'return' inside a try/catch/finally clause is not supported", stmt, ctx);
  }

  // ── Validation: step 2 — catch without binding → E034 ──
  if (stmt.catchClause && !stmt.catchClause.variableDeclaration) {
    throw error("E034", "catch clause requires a binding parameter", stmt.catchClause, ctx);
  }

  // ── Validation: step 3 — outer-binding assignment in finally → E035 ──
  if (stmt.finallyBlock) {
    const offendingVar = finallyContainsOuterAssignment(stmt.finallyBlock, ctx);
    if (offendingVar !== undefined) {
      throw error(
        "E035",
        `Variable '${offendingVar}' assigned inside 'finally' is not visible after the try statement`,
        stmt.finallyBlock,
        ctx,
      );
    }
  }

  const catchParam = stmt.catchClause?.variableDeclaration
    ? (stmt.catchClause.variableDeclaration.name as ts.Identifier).text
    : undefined;
  const catchBlock = stmt.catchClause?.block;

  // ── Phase A: dry-run body and catch to compute J_bc ──
  const snapshot = snapshotVersions(ctx);
  const allLetVars = getAllLetVars(ctx);

  const dryBodyCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  compileBranchBodyToJoin(getBodyStatements(stmt.tryBlock), allLetVars, snapshot, dryBodyCtx);

  const dryCatchCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  if (catchBlock && catchParam) {
    // Push catchParam into dryCatchCtx so it doesn't interfere with join var detection
    pushFrame(dryCatchCtx);
    dryCatchCtx.scopeStack[dryCatchCtx.scopeStack.length - 1]!.set(catchParam, {
      kind: "const",
      version: 0,
    });
  }
  if (catchBlock) {
    compileBranchBodyToJoin(getBodyStatements(catchBlock), allLetVars, snapshot, dryCatchCtx);
  }

  const joinVars = allLetVars.filter((v) => {
    const bodyVer = getVersion(v, dryBodyCtx);
    const catchVer = catchBlock ? getVersion(v, dryCatchCtx) : (snapshot.get(v) ?? 0);
    return bodyVer !== (snapshot.get(v) ?? 0) || catchVer !== (snapshot.get(v) ?? 0);
  });

  // ── Emit: J_bc empty ──
  if (joinVars.length === 0) {
    const bodyExpr = emitStatementBody(stmt.tryBlock, ctx);
    const catchExpr = catchBlock
      ? (() => {
          const catchCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
          if (catchParam) {
            pushFrame(catchCtx);
            catchCtx.scopeStack[catchCtx.scopeStack.length - 1]!.set(catchParam, {
              kind: "const",
              version: 0,
            });
          }
          return emitStatementBody(catchBlock, catchCtx);
        })()
      : undefined;
    // J_bc empty: no join vars, compile finally in current ctx (no unpack needed)
    const finallyExpr = stmt.finallyBlock
      ? (() => {
          const finallyCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
          return emitStatementBody(stmt.finallyBlock, finallyCtx);
        })()
      : undefined;
    const tryIr = Try(bodyExpr, catchParam, catchExpr, finallyExpr);
    if (!hasMore) return tryIr;
    return Let(ctx.counter.next("discard"), tryIr, rest());
  }

  // ── Emit: J_bc non-empty ──
  const bodyCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const bodyJoinExpr = compileBranchToExpr(stmt.tryBlock, joinVars, bodyCtx);

  let catchJoinExpr: Expr | undefined;
  if (catchBlock) {
    const catchCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    if (catchParam) {
      pushFrame(catchCtx);
      catchCtx.scopeStack[catchCtx.scopeStack.length - 1]!.set(catchParam, {
        kind: "const",
        version: 0,
      });
    }
    catchJoinExpr = compileBranchToExpr(catchBlock, joinVars, catchCtx);
  }

  // Capture pre-trial SSA names before applyJoinVersions advances versions
  const preTrialRefs = new Map<string, string>();
  for (const v of joinVars) {
    preTrialRefs.set(v, resolveRef(v, ctx));
  }

  applyJoinVersions(joinVars, ctx);

  // J_bc non-empty: compile finally in post-join ctx with Let-unpack from fp
  let finallyExpr: Expr | undefined;
  let finallyPayload: string | undefined;
  let finallyDefault: Expr | undefined;
  if (stmt.finallyBlock) {
    finallyPayload = ctx.counter.next("fp");
    const postJoinCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    let compiledFinally: Expr = emitStatementBody(stmt.finallyBlock, postJoinCtx);
    if (joinVars.length === 1) {
      const v = joinVars[0]!;
      const joinIrName = resolveRef(v, ctx);
      compiledFinally = Let(joinIrName, Ref(finallyPayload), compiledFinally);
      finallyDefault = Ref(preTrialRefs.get(v)!);
    } else {
      for (let i = joinVars.length - 1; i >= 0; i--) {
        const v = joinVars[i]!;
        const joinIrName = resolveRef(v, ctx);
        compiledFinally = Let(joinIrName, Get(Ref(finallyPayload), v), compiledFinally);
      }
      const defaultFields: Record<string, Expr> = {};
      for (const v of joinVars) {
        defaultFields[v] = Ref(preTrialRefs.get(v)!);
      }
      finallyDefault = Construct(defaultFields as Record<string, Expr>);
    }
    finallyExpr = compiledFinally;
  }

  const tryIr = Try(
    bodyJoinExpr,
    catchParam,
    catchJoinExpr,
    finallyExpr,
    finallyPayload,
    finallyDefault,
  );

  if (joinVars.length === 1) {
    const v = joinVars[0]!;
    const joinIrName = resolveRef(v, ctx);
    if (!hasMore) return Let(joinIrName, tryIr, null as unknown as Expr);
    return Let(joinIrName, tryIr, rest());
  }

  // Multiple join vars
  const joinName = ctx.counter.next("j");
  let result = hasMore ? rest() : (null as unknown as Expr);
  for (let i = joinVars.length - 1; i >= 0; i--) {
    const v = joinVars[i]!;
    const joinIrName = resolveRef(v, ctx);
    result = Let(joinIrName, Get(Ref(joinName), v), result);
  }
  return Let(joinName, tryIr, result);
}

/** Get all in-scope let variable names. */
function getAllLetVars(ctx: EmitContext): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  // Scan from innermost to outermost, collect unique names
  for (let i = ctx.scopeStack.length - 1; i >= 0; i--) {
    for (const [name, info] of ctx.scopeStack[i]!) {
      if (info.kind === "let" && !seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }
  }
  return result;
}

/** Get current version number for a let binding. */
function getVersion(name: string, ctx: EmitContext): number {
  const found = lookupBinding(name, ctx);
  if (found && found.info.kind === "let") return found.info.version;
  return -1;
}

/** Compile branch body statements into an expression (for detecting version changes).
 * This is a dry-run to collect which variables changed. */
function compileBranchBodyToJoin(
  stmts: ts.Statement[],
  _joinVars: string[],
  _snapshot: Map<string, number>,
  branchCtx: EmitContext,
): Expr {
  // Just compile normally; the branchCtx tracks which versions changed
  return emitStatementList(stmts, 0, branchCtx);
}

/** Build a join expression from snapshot versions (else-less case: vars stay at snapshot). */
function buildJoinExpr(
  vars: string[],
  snapshot: Map<string, number>,
  _: Map<string, number>,
): Expr {
  if (vars.length === 0) return null as unknown as Expr;
  if (vars.length === 1) {
    const v = vars[0]!;
    const version = snapshot.get(v) ?? 0;
    return Ref(`${v}_${version}`);
  }
  const fields: Record<string, Expr> = {};
  for (const v of vars) {
    const version = snapshot.get(v) ?? 0;
    fields[v] = Ref(`${v}_${version}`);
  }
  return Construct(fields);
}

/** Build a join expression using snapshot versions (for the "no else" case). */
function buildJoinExprFromSnapshot(vars: string[], snapshot: Map<string, number>): Expr {
  if (vars.length === 0) return null as unknown as Expr;
  if (vars.length === 1) {
    const v = vars[0]!;
    const version = snapshot.get(v) ?? 0;
    return Ref(`${v}_${version}`);
  }
  const fields: Record<string, Expr> = {};
  for (const v of vars) {
    const version = snapshot.get(v) ?? 0;
    fields[v] = Ref(`${v}_${version}`);
  }
  return Construct(fields);
}

/** Bump the version of all join vars in the main context (post-join). */
function applyJoinVersions(joinVars: string[], ctx: EmitContext): void {
  for (const v of joinVars) {
    bumpVersion(v, ctx);
  }
}

/** Copy versions from a branch context back into the main context. */
function mergeStackVersions(ctx: EmitContext, branchCtx: EmitContext): void {
  // For each let binding in branchCtx, update the version in ctx
  for (let i = 0; i < branchCtx.scopeStack.length && i < ctx.scopeStack.length; i++) {
    const branchFrame = branchCtx.scopeStack[i]!;
    const mainFrame = ctx.scopeStack[i]!;
    for (const [name, info] of branchFrame) {
      const mainInfo = mainFrame.get(name);
      if (mainInfo && mainInfo.kind === "let") {
        mainInfo.version = info.version;
      }
    }
  }
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
  // Detect loop-carried let vars (outer let bindings reassigned in loop body)
  const loopCarriedVars = detectLoopCarriedLetVars(stmt, ctx);

  if (hasReturn || loopCarriedVars.length > 0) {
    return emitWhileCaseB(stmt, rest, isLast, ctx, loopCarriedVars, hasReturn);
  }

  // Case A: no return, no loop-carried state → While IR node
  const condition = emitExpression(stmt.expression, ctx);
  const bodyStmts = getBodyStatements(stmt.statement);
  const bodyExpr = emitStatementList(bodyStmts, 0, ctx);
  const whileExpr = While(condition, [bodyExpr]);

  if (isLast) return whileExpr;
  const name = ctx.counter.next("while");
  return Let(name, whileExpr, rest());
}

/**
 * Detect loop-carried let variables: outer let bindings that are reassigned
 * inside the while loop body.
 */
function detectLoopCarriedLetVars(stmt: ts.WhileStatement, ctx: EmitContext): string[] {
  const assigned = new Set<string>();
  collectAssignedIdents(stmt.statement, assigned);
  return Array.from(assigned).filter((name) => {
    const found = lookupBinding(name, ctx);
    return found !== undefined && found.info.kind === "let";
  });
}

/** Recursively collect all identifier names that appear on the LHS of assignment. */
function collectAssignedIdents(node: ts.Node, result: Set<string>): void {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.left)
  ) {
    result.add((node.left as ts.Identifier).text);
  }
  ts.forEachChild(node, (child) => collectAssignedIdents(child, result));
}

/** Case B: while-with-return or loop-carried-state → recursive Fn + Call (§6.2) */
function emitWhileCaseB(
  stmt: ts.WhileStatement,
  rest: () => Expr,
  isLast: boolean,
  ctx: EmitContext,
  loopCarriedVars: string[],
  hasReturn: boolean,
): Expr {
  const loopName = ctx.counter.next("loop");
  const condition = stmt.expression;
  const isTrueCondition = condition.kind === ts.SyntaxKind.TrueKeyword;

  // For non-while(true) loops, add a __last param so the loop expression returns
  // the last body result when the condition becomes false.
  const lastParamName = isTrueCondition ? null : ctx.counter.next("last");

  // Loop-carried var params: current versioned names become the Fn param names.
  // Inside the Fn, references to these vars naturally resolve to the param values
  // because the outer scope already has them at these versions.
  const loopCarriedParams = loopCarriedVars.map((v) => resolveRef(v, ctx));

  // Initial call args: pass current versioned refs for each loop-carried var.
  // Compute before appending lastParamName so we can push Q(null) separately.
  const initArgs: Expr[] = loopCarriedParams.map((pn) => Ref(pn) as Expr);

  if (lastParamName !== null) {
    loopCarriedParams.push(lastParamName);
    initArgs.push(null as unknown as Expr);
  }

  const needsRebind = loopCarriedVars.length > 0;
  // Pack early returns into a struct when the outer caller must discriminate exit
  // paths or destructure carried vars.  We do NOT pack when:
  //   while(true) + isLast + !needsRebind
  // because the only exit is an early return whose raw value is already the
  // correct function result — no wrapping needed, and it keeps the IR compact.
  const needsPack = hasReturn && (lastParamName !== null || !isLast || needsRebind);

  // Build the Fn body: body statements with fall-through = recursive Call
  const bodyStmts = getBodyStatements(stmt.statement);
  const fnCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };

  const transformedBody = emitLoopBody(
    bodyStmts,
    condition,
    loopName,
    loopCarriedVars,
    loopCarriedParams,
    fnCtx,
    lastParamName,
    needsPack,
  );

  const loopFn = Fn(loopCarriedParams, transformedBody);

  const callExpr = Call(Ref(loopName), initArgs);

  if (needsPack || needsRebind) {
    const resultName = ctx.counter.next("loop_result");
    const resultRef = Ref(resultName);

    // Bump each carried var in outer ctx BEFORE building rest(),
    // so rest() references the new post-loop versions.
    const newIrNames = needsRebind ? loopCarriedVars.map((v) => bumpVersion(v, ctx)) : [];

    const buildRebindChain = (cont: Expr): Expr => {
      let chain = cont;
      for (let i = loopCarriedVars.length - 1; i >= 0; i--) {
        chain = Let(newIrNames[i]!, Get(resultRef, loopCarriedVars[i]!) as Expr, chain);
      }
      return chain;
    };

    if (isLast) {
      // Nothing follows the loop — just extract the value; rebind not needed.
      return Let(loopName, loopFn, Let(resultName, callExpr, Get(resultRef, "__value") as Expr));
    }

    if (needsPack) {
      // Dispatch: early return short-circuits, condition-false exit continues (with optional rebind).
      const continuation: Expr = needsRebind ? buildRebindChain(rest()) : rest();
      return Let(
        loopName,
        loopFn,
        Let(
          resultName,
          callExpr,
          If(
            Eq(Get(resultRef, "__tag") as Expr, "return" as unknown as Expr) as Expr,
            Get(resultRef, "__value") as Expr,
            continuation,
          ),
        ),
      );
    }

    // !needsPack && needsRebind && !isLast: no early return, just rebind and continue.
    return Let(loopName, loopFn, Let(resultName, callExpr, buildRebindChain(rest())));
  }

  if (isLast) {
    return Let(loopName, loopFn, callExpr);
  }
  return Let(loopName, loopFn, Let(ctx.counter.next("discard"), callExpr, rest()));
}

/**
 * Emit loop body for Case B.
 * Wraps in condition check, and adds recursive call at fall-through points.
 */
function emitLoopBody(
  stmts: ts.Statement[],
  condition: ts.Expression,
  loopName: string,
  loopCarriedVars: string[],
  loopCarriedParams: string[],
  ctx: EmitContext,
  lastParamName: string | null,
  needsPack: boolean,
): Expr {
  // Check if condition is `true` literal
  const isTrueCondition = condition.kind === ts.SyntaxKind.TrueKeyword;

  if (isTrueCondition) {
    // while(true) — no condition check needed, just body + recurse
    return emitLoopStatements(
      stmts,
      0,
      loopName,
      loopCarriedVars,
      lastParamName,
      ctx,
      null,
      needsPack,
    );
  }

  // Evaluate condition BEFORE body so it uses parameter versions (not body-bumped ones).
  // Body statements mutate ctx (bumping loop-carried var versions), so order matters.
  const condExpr = emitExpression(condition, ctx);
  const bodyExpr = emitLoopStatements(
    stmts,
    0,
    loopName,
    loopCarriedVars,
    lastParamName,
    ctx,
    null,
    needsPack,
  );

  if (lastParamName !== null) {
    const needsRebind = loopCarriedVars.length > 0;

    if (needsPack || needsRebind) {
      // Condition-false exit: pack into a struct so the caller can always destructure.
      // loopCarriedParams are the Fn param-version names — their values ARE the current
      // iteration's loop-carried values at the moment the condition is tested.
      const fields: Record<string, Expr> = {};
      if (needsPack) {
        fields.__tag = "exit" as unknown as Expr;
      }
      fields.__value = Ref(lastParamName) as Expr;
      if (needsRebind) {
        loopCarriedVars.forEach((v, i) => {
          fields[v] = Ref(loopCarriedParams[i]!) as Expr;
        });
      }
      return If(condExpr, bodyExpr, Construct(fields as any) as Expr);
    }

    return If(condExpr, bodyExpr, Ref(lastParamName));
  }
  return If(condExpr, bodyExpr);
}

/**
 * Emit statements within a loop body (Case B).
 * Return statements become the value (base case).
 * End of body → recursive call with current loop-carried var versions.
 *
 * lastParamName: the Fn param name for the __last accumulator (null for while(true)).
 * lastBound: the most recently Let-bound IR name in this body path (null if none yet).
 */
function emitLoopStatements(
  stmts: ts.Statement[],
  index: number,
  loopName: string,
  loopCarriedVars: string[],
  lastParamName: string | null,
  ctx: EmitContext,
  lastBound: string | null = null,
  needsPack: boolean = false,
): Expr {
  if (index >= stmts.length) {
    // Fall-through: recurse, passing current versions of loop-carried vars
    const args = loopCarriedVars.map((v) => Ref(resolveRef(v, ctx)) as Expr);
    if (lastParamName !== null) {
      args.push(lastBound !== null ? (Ref(lastBound) as Expr) : (null as unknown as Expr));
    }
    return Call(Ref(loopName), args);
  }

  const stmt = stmts[index]!;
  const rest = (newBound: string | null) =>
    emitLoopStatements(
      stmts,
      index + 1,
      loopName,
      loopCarriedVars,
      lastParamName,
      ctx,
      newBound,
      needsPack,
    );

  // Return → base case (value propagates out)
  if (ts.isReturnStatement(stmt)) {
    const retVal: Expr = stmt.expression
      ? emitExpression(stmt.expression, ctx)
      : (null as unknown as Expr);

    // When needsPack is true, ALL exit paths must return a struct so the outer
    // caller can always destructure via __tag / __value.
    if (needsPack) {
      const needsRebind = loopCarriedVars.length > 0;
      const fields: Record<string, Expr> = {
        __tag: "return" as unknown as Expr,
        __value: retVal,
      };
      if (needsRebind) {
        for (const v of loopCarriedVars) {
          fields[v] = Ref(resolveRef(v, ctx)) as Expr;
        }
      }
      return Construct(fields as any) as Expr;
    }
    return retVal;
  }

  // Variable declaration
  if (ts.isVariableStatement(stmt)) {
    // Compute the last-bound IR name from the AST before delegating.
    // emitVariableStatement takes a rest callback and cannot return the name itself.
    const declList = stmt.declarationList;
    const lastDecl = declList.declarations[declList.declarations.length - 1]!;
    const isLet = !!(declList.flags & ts.NodeFlags.Let);
    const lastName = (lastDecl.name as ts.Identifier).text;
    // Matches what emitVariableStatement produces: "${name}_0" for let, name for const.
    const newLastBound = isLet ? `${lastName}_0` : lastName;
    return emitVariableStatement(stmt, () => rest(newLastBound), ctx);
  }

  // Let reassignment: x = newExpr — must handle here too for loop body
  if (
    ts.isExpressionStatement(stmt) &&
    ts.isBinaryExpression(stmt.expression) &&
    stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(stmt.expression.left)
  ) {
    const expr = stmt.expression;
    const lhsName = (expr.left as ts.Identifier).text;
    const found = lookupBinding(lhsName, ctx);
    if (!found || found.info.kind !== "let") {
      throw error(
        "E003",
        "Reassignment of non-let binding or undeclared name is not allowed",
        stmt,
        ctx,
      );
    }
    const newValue = emitExpression(expr.right, ctx);
    const newIrName = bumpVersion(lhsName, ctx);
    return Let(newIrName, newValue, rest(newIrName));
  }

  // If with return → early return pattern
  if (ts.isIfStatement(stmt)) {
    return emitLoopIfStatement(
      stmt,
      stmts,
      index,
      loopName,
      loopCarriedVars,
      lastParamName,
      ctx,
      needsPack,
    );
  }

  // Expression statement
  if (ts.isExpressionStatement(stmt)) {
    const expr = stmt.expression;
    checkUnsupportedExpression(expr, ctx);

    if (ts.isYieldExpression(expr) && expr.asteriskToken && expr.expression) {
      const effect = emitYieldStar(expr.expression, ctx);
      const name = ctx.counter.next("discard");
      return Let(name, effect, rest(name));
    }

    const name = ctx.counter.next("discard");
    return Let(name, emitExpression(expr, ctx), rest(name));
  }

  // Throw
  if (ts.isThrowStatement(stmt) && stmt.expression) {
    return emitThrowStatement(stmt, ctx);
  }

  throw error("E999", `Unsupported statement in loop body: ${ts.SyntaxKind[stmt.kind]}`, stmt, ctx);
}

/**
 * Handle if statements within a Case B loop body.
 *
 * Key invariant: every path through the loop body must end with either a
 * recursive Call(loopName, ...) or a return/throw. We achieve this by
 * INLINING the remaining loop-body statements (restStmts) into each
 * non-terminating branch rather than appending them after the If expression.
 *
 * This also means each branch is compiled in its own cloned context so that
 * SSA version bumps in one branch do not pollute the other.
 */
function emitLoopIfStatement(
  stmt: ts.IfStatement,
  stmts: ts.Statement[],
  index: number,
  loopName: string,
  loopCarriedVars: string[],
  lastParamName: string | null,
  ctx: EmitContext,
  needsPack: boolean,
): Expr {
  const condition = emitExpression(stmt.expression, ctx);
  const thenTerminates = alwaysTerminates(stmt.thenStatement);
  const elseTerminates = stmt.elseStatement ? alwaysTerminates(stmt.elseStatement) : false;

  // Statements that follow this if in the loop body.
  const restStmts = stmts.slice(index + 1);

  // Build the full statement list for each branch.
  // Terminating branches (return/throw) don't need the rest inlined.
  // Non-terminating branches get the rest concatenated so the recursive
  // Call is emitted inside the branch, not after the If.
  const thenFullStmts = thenTerminates
    ? getBodyStatements(stmt.thenStatement)
    : [...getBodyStatements(stmt.thenStatement), ...restStmts];

  const elseBodyStmts = stmt.elseStatement
    ? elseTerminates
      ? getBodyStatements(stmt.elseStatement)
      : [...getBodyStatements(stmt.elseStatement), ...restStmts]
    : restStmts; // no else: implicit fallthrough = rest

  // Compile each branch in an independent cloned context so SSA bumps in one
  // branch (e.g. bumpVersion("x", ctx)) cannot contaminate the other.
  const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const thenBranch = emitLoopStatements(
    thenFullStmts,
    0,
    loopName,
    loopCarriedVars,
    lastParamName,
    thenCtx,
    null,
    needsPack,
  );

  const elseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const elseBranch = emitLoopStatements(
    elseBodyStmts,
    0,
    loopName,
    loopCarriedVars,
    lastParamName,
    elseCtx,
    null,
    needsPack,
  );

  return If(condition, thenBranch, elseBranch);
}

// ── Helpers ──

function getBodyStatements(stmt: ts.Statement): ts.Statement[] {
  if (ts.isBlock(stmt)) {
    return Array.from(stmt.statements);
  }
  return [stmt];
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

  const baseAgentId = toAgentId(agentFactory.text);

  // Contract-aware mode: validate against discovered contracts and normalize to payload object
  if (ctx.contracts) {
    const contract = ctx.contracts.get(agentFactory.text);
    if (!contract) {
      throw error("E999", `Unknown contract: '${agentFactory.text}'`, agentFactory, ctx);
    }

    // Instance handling
    const factoryArgs = receiver.arguments;
    let agentId = baseAgentId;

    if (factoryArgs.length > 1) {
      throw error(
        "E999",
        `Contract factory '${agentFactory.text}' accepts at most one argument (instance)`,
        receiver,
        ctx,
      );
    }

    if (factoryArgs.length === 1) {
      const instanceArg = factoryArgs[0]!;
      if (!ts.isStringLiteral(instanceArg)) {
        throw error(
          "E999",
          `Contract factory instance argument must be a string literal (dynamic instance routing is not supported in v1)`,
          instanceArg,
          ctx,
        );
      }
      agentId = `${baseAgentId}:${instanceArg.text}`;
    }

    // Validate method exists
    const method = contract.methods.find((m) => m.name === methodName);
    if (!method) {
      throw error(
        "E999",
        `Unknown method '${methodName}' on contract '${agentFactory.text}'`,
        propAccess.name,
        ctx,
      );
    }

    // Validate arity
    if (args.length !== method.params.length) {
      throw error(
        "E999",
        `Method '${agentFactory.text}.${methodName}' expects ${method.params.length} argument(s) but got ${args.length}`,
        propAccess,
        ctx,
      );
    }

    // Build Construct node with named parameters
    const effectId = `${agentId}.${methodName}`;
    const fields: Record<string, Expr> = {};
    for (let i = 0; i < method.params.length; i++) {
      fields[method.params[i]!.name] = emitExpression(args[i]!, ctx);
    }
    return ExternalEval(effectId, Construct(fields));
  }

  // Legacy mode: positional array (preserves backward compat for compile/compileOne)
  const effectId = `${baseAgentId}.${methodName}`;
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

  // ── Identifiers → Ref (versioned if SSA-tracked) ──
  if (ts.isIdentifier(node)) {
    return Ref(resolveRef(node.text, ctx));
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

  // ── Array literal → Array or ConcatArrays (§7.7) ──
  if (ts.isArrayLiteralExpression(node)) {
    return emitArrayLiteral(node, ctx);
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

    // Assignment in expression position → always an error
    // (let reassignment is handled at statement level in emitLetReassignment)
    case ts.SyntaxKind.EqualsToken:
      throw error(
        "E003",
        "Reassignment of non-let binding or undeclared name is not allowed",
        node,
        ctx,
      );

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

// ── Object literal → Construct or MergeObjects (§7.6) ──

function emitObjectLiteral(node: ts.ObjectLiteralExpression, ctx: EmitContext): Expr {
  // Check if any spread elements are present
  const hasSpread = node.properties.some((p) => ts.isSpreadAssignment(p));

  if (!hasSpread) {
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
        fields[key] = Ref(resolveRef(key, ctx));
      } else {
        throw error(
          "E999",
          "Only property assignments are supported in object literals",
          prop,
          ctx,
        );
      }
    }
    return Construct(fields);
  }

  // Has spread: build MergeObjects segments
  const segments: Expr[] = [];
  let currentFields: Record<string, Expr> = {};

  const flushFields = () => {
    if (Object.keys(currentFields).length > 0) {
      segments.push(Construct(currentFields));
      currentFields = {};
    }
  };

  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop)) {
      flushFields();
      segments.push(emitExpression(prop.expression, ctx));
    } else if (ts.isPropertyAssignment(prop)) {
      let key: string;
      if (ts.isIdentifier(prop.name)) {
        key = prop.name.text;
      } else if (ts.isStringLiteral(prop.name)) {
        key = prop.name.text;
      } else {
        throw error("E005", "Computed property keys are not allowed", prop, ctx);
      }
      currentFields[key] = emitExpression(prop.initializer, ctx);
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      const key = prop.name.text;
      currentFields[key] = Ref(resolveRef(key, ctx));
    } else {
      throw error("E999", "Only property assignments are supported in object literals", prop, ctx);
    }
  }
  flushFields();

  return MergeObjects(segments);
}

// ── Array literal → ArrayNode or ConcatArrays ──

function emitArrayLiteral(node: ts.ArrayLiteralExpression, ctx: EmitContext): Expr {
  const hasSpread = node.elements.some((e) => ts.isSpreadElement(e));

  if (!hasSpread) {
    const items = node.elements.map((e) => emitExpression(e, ctx));
    return ArrayNode(items);
  }

  // Has spread: build ConcatArrays segments
  const segments: Expr[] = [];
  let currentItems: Expr[] = [];

  const flushItems = () => {
    if (currentItems.length > 0) {
      segments.push(ArrayNode(currentItems));
      currentItems = [];
    }
  };

  for (const element of node.elements) {
    if (ts.isSpreadElement(element)) {
      flushItems();
      segments.push(emitExpression(element.expression, ctx));
    } else {
      currentItems.push(emitExpression(element, ctx));
    }
  }
  flushItems();

  return ConcatArrays(segments);
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
  // Spread in call args → E032
  if (ts.isCallExpression(node)) {
    for (const arg of node.arguments) {
      if (ts.isSpreadElement(arg)) {
        throw error(
          "E032",
          "Spread element outside array or object literal is not allowed",
          arg,
          ctx,
        );
      }
    }
  }

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
      // Mutation methods → E031
      const MUTATION_METHODS = new Set([
        "push",
        "pop",
        "splice",
        "shift",
        "unshift",
        "sort",
        "reverse",
        "fill",
        "copyWithin",
      ]);
      if (MUTATION_METHODS.has(callee.name.text)) {
        throw error("E031", "Mutation method call is not allowed", node, ctx);
      }
    }
  }
}
