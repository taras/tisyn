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
  Q,
  ExternalEval,
  AllEval,
  RaceEval,
  ScopeEval,
  SpawnEval,
  JoinEval,
  ResourceEval,
  ProvideEval,
  TimeboxEval,
} from "./ir-builders.js";
import { toAgentId } from "./agent-id.js";
import { Counter } from "./counter.js";
import { CompileError } from "./errors.js";
import { getLocation } from "./parse.js";
import type { DiscoveredContract } from "./discover.js";

// ── Context ──

interface CapabilityInfo {
  family: "spawn-task" | "stream-subscription";
  state: "active" | "completed" | "indeterminate";
  captureRule: "prohibited" | "permitted";
  authorVisible: boolean;
}

interface BindingInfo {
  kind: "let" | "const";
  version: number;
  capability?: CapabilityInfo;
  /** Set in cloneScopeStackForSpawnBody for bindings whose captureRule is "prohibited". */
  capturedInChildScope?: boolean;
}

type ScopeFrame = Map<string, BindingInfo>;

interface EmitContext {
  counter: Counter;
  sourceFile: ts.SourceFile;
  contracts?: Map<string, DiscoveredContract>;
  /**
   * When true, agent factory calls whose name is not in `contracts` throw an error.
   * When false/absent, unknown factories fall through to the legacy positional-array path.
   * Set by generateWorkflowModule (strict); left unset by compile/compileOne (lenient).
   */
  strictContracts?: boolean;
  /** SSA binding scope stack. Innermost frame is last. */
  scopeStack: ScopeFrame[];
  /** Set only during scoped body compilation. varName → agentPrefix. */
  handleBindings?: Map<string, string>;
  /** Set only during scoped body compilation. agentPrefix → DiscoveredContract. */
  scopedContracts?: Map<string, DiscoveredContract>;
  /** Set only during resource body compilation. */
  inResourceBody?: boolean;
  /** Set only during for...of yield* each(...) body compilation. */
  inStreamLoop?: boolean;
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
    if (info !== undefined) {
      return { frame, info };
    }
  }
  return undefined;
}

/** Declare a new binding in the current (innermost) frame. */
function declareBinding(
  name: string,
  kind: "let" | "const",
  ctx: EmitContext,
  capability?: CapabilityInfo,
): void {
  const frame = ctx.scopeStack[ctx.scopeStack.length - 1]!;
  frame.set(name, { kind, version: 0, capability });
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

/** Reject a capability binding in a prohibited expression/structural position (CV-E1). */
function assertNotCapabilityInProhibitedPosition(
  name: string,
  position: string,
  node: ts.Node,
  ctx: EmitContext,
): void {
  const found = lookupBinding(name, ctx);
  if (!found) {
    return;
  }
  const { info } = found;

  if (info.capturedInChildScope && info.capability?.captureRule === "prohibited") {
    throw error(
      "CV-E1",
      `Capability value '${name}' (${info.capability.family}) cannot be captured in child scope`,
      node,
      ctx,
    );
  }
  if (!info.capability || !info.capability.authorVisible) {
    return;
  }
  throw error(
    "CV-E1",
    `Capability value '${name}' (${info.capability.family}) cannot appear in ${position} position`,
    node,
    ctx,
  );
}

/** Reject a capture-prohibited capability binding referenced from a child scope (CV-E1). */
function assertCapabilityCaptureAllowed(name: string, node: ts.Node, ctx: EmitContext): void {
  const found = lookupBinding(name, ctx);
  if (!found) {
    return;
  }
  if (found.info.capturedInChildScope && found.info.capability?.captureRule === "prohibited") {
    throw error(
      "CV-E1",
      `Capability value '${name}' (${found.info.capability.family}) cannot be captured in child scope`,
      node,
      ctx,
    );
  }
}

/** Check if a binding is a joinable spawn handle (not in a child scope). */
function isJoinableSpawnHandle(name: string, ctx: EmitContext): boolean {
  const found = lookupBinding(name, ctx);
  return found?.info.capability?.family === "spawn-task" && !found?.info.capturedInChildScope;
}

function resolveRef(name: string, ctx: EmitContext): string {
  const found = lookupBinding(name, ctx);
  if (found) {
    return versionedName(name, found.info);
  }
  return name; // untracked (e.g. const declared before SSA, external)
}

/** Deep-clone the scope stack. Used before compiling branches. */
function cloneScopeStack(stack: ScopeFrame[]): ScopeFrame[] {
  return stack.map((frame) => {
    const newFrame = new Map<string, BindingInfo>();
    for (const [k, v] of frame) {
      newFrame.set(k, { ...v, capability: v.capability ? { ...v.capability } : undefined });
    }
    return newFrame;
  });
}

/** Clone scope stack with capture-prohibited capability bindings marked as captured in child scope. */
function cloneScopeStackForSpawnBody(stack: ScopeFrame[]): ScopeFrame[] {
  return stack.map((frame) => {
    const newFrame = new Map<string, BindingInfo>();
    for (const [k, v] of frame) {
      if (v.capability && v.capability.captureRule === "prohibited") {
        newFrame.set(k, { ...v, capability: { ...v.capability }, capturedInChildScope: true });
      } else {
        newFrame.set(k, { ...v, capability: v.capability ? { ...v.capability } : undefined });
      }
    }
    return newFrame;
  });
}

/** Check if an AST subtree contains any `yield*` expression. */
function containsYieldStar(node: ts.Node): boolean {
  if (ts.isYieldExpression(node) && node.asteriskToken) {
    return true;
  }
  return ts.forEachChild(node, containsYieldStar) ?? false;
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

/**
 * Like createContext, but marks the context as strict: agent factory calls whose
 * name is not in `contracts` throw an error instead of falling through to legacy mode.
 * Used by generateWorkflowModule where every contract must be declared.
 */
export function createStrictContext(
  sourceFile: ts.SourceFile,
  contracts: Map<string, DiscoveredContract>,
): EmitContext {
  return {
    counter: new Counter(),
    sourceFile,
    contracts,
    strictContracts: true,
    scopeStack: [new Map()],
  };
}

// ── Statement compilation (Spec §5.1) ──

function emitStatementList(stmts: ts.Statement[], index: number, ctx: EmitContext): Expr {
  if (index >= stmts.length) {
    return null as unknown as Expr;
  }

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
    if (isLast) {
      return blockResult;
    }
    const name = ctx.counter.next("discard");
    return Let(name, blockResult, rest());
  }

  // ── ForOfStatement: stream iteration ──
  if (ts.isForOfStatement(stmt)) {
    return emitForOfEach(stmt, rest, isLast, ctx);
  }

  // ── ForInStatement: always rejected ──
  if (ts.isForInStatement(stmt)) {
    throw error("E013", "for...in is not allowed", stmt, ctx);
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
    if (i >= declList.declarations.length) {
      return rest();
    }

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

    // ── useAgent erasure ──
    // Inside a scoped() body: const handle = yield* useAgent(Contract) is erased.
    // The variable name is recorded in handleBindings and no Let is emitted.
    if (
      ts.isYieldExpression(decl.initializer) &&
      decl.initializer.asteriskToken &&
      decl.initializer.expression &&
      ts.isCallExpression(decl.initializer.expression) &&
      ts.isIdentifier(decl.initializer.expression.expression) &&
      decl.initializer.expression.expression.text === "useAgent"
    ) {
      if (!ctx.handleBindings) {
        throw error("UA1", "useAgent can only be used inside scoped()", decl, ctx);
      }
      if (!isConst) {
        throw error("UA2", "useAgent binding must be declared with 'const'", decl, ctx);
      }
      const contractArg = decl.initializer.expression.arguments[0];
      if (!contractArg || !ts.isIdentifier(contractArg)) {
        throw error("UA2", "useAgent argument must be a contract identifier", decl, ctx);
      }
      const prefix = toAgentId(contractArg.text);
      if (!ctx.scopedContracts?.has(prefix)) {
        throw error("UA3", `No useTransport for '${contractArg.text}' in this scope`, decl, ctx);
      }
      ctx.handleBindings.set(name, prefix);
      return processDecl(i + 1); // erase: no Let emitted
    }

    // ── Spawn handle binding ──
    // const task = yield* spawn(function* () { ... }) → Let(task, SpawnEval(body), rest)
    if (
      ts.isYieldExpression(decl.initializer) &&
      decl.initializer.asteriskToken &&
      decl.initializer.expression &&
      ts.isCallExpression(decl.initializer.expression) &&
      ts.isIdentifier(decl.initializer.expression.expression) &&
      decl.initializer.expression.expression.text === "spawn"
    ) {
      if (!isConst) {
        throw error(
          "CV-E5",
          "Capability value must be declared with 'const', not 'let'",
          decl,
          ctx,
        );
      }
      const spawnExpr = emitSpawn(decl.initializer.expression, ctx);
      declareBinding(name, kind, ctx, {
        family: "spawn-task",
        state: "active",
        captureRule: "prohibited",
        authorVisible: true,
      });
      return Let(name, spawnExpr, processDecl(i + 1));
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
  if (ts.isReturnStatement(stmt)) {
    return true;
  }
  if (ts.isThrowStatement(stmt)) {
    return true;
  }
  if (ts.isBlock(stmt)) {
    // Block always terminates if any top-level statement always terminates
    // (sequential: once a terminating statement is hit, rest is dead code)
    return stmt.statements.some((s) => alwaysTerminates(s));
  }
  if (ts.isIfStatement(stmt)) {
    // If-with-else terminates only when both branches always terminate
    if (!stmt.elseStatement) {
      return false;
    }
    return alwaysTerminates(stmt.thenStatement) && alwaysTerminates(stmt.elseStatement);
  }
  if (ts.isTryStatement(stmt)) {
    const bodyTerminates = alwaysTerminates(stmt.tryBlock);
    if (!stmt.catchClause) {
      return bodyTerminates;
    }
    return bodyTerminates && alwaysTerminates(stmt.catchClause.block);
  }
  return false;
}

/**
 * Walk a statement list sequentially:
 * - If a statement alwaysReturns, return true immediately (tail is dead code).
 * - If a statement alwaysTerminates but does NOT alwaysReturn (i.e. always throws),
 *   return false immediately (return is unreachable).
 * - Otherwise continue to the next statement.
 */
function alwaysReturnsStatementList(stmts: readonly ts.Statement[]): boolean {
  for (const s of stmts) {
    if (alwaysReturns(s)) {
      return true;
    }
    if (alwaysTerminates(s)) {
      return false;
    } // always throws — return is unreachable
  }
  return false;
}

/**
 * True iff every reachable normal exit from the statement is a return (not a throw).
 * Used to gate the always-return fast path in packing mode.
 */
function alwaysReturns(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt)) {
    return true;
  }
  if (ts.isThrowStatement(stmt)) {
    return false;
  } // terminal, but not a return
  if (ts.isBlock(stmt)) {
    return alwaysReturnsStatementList(stmt.statements);
  }
  if (ts.isIfStatement(stmt)) {
    if (!stmt.elseStatement) {
      return false;
    }
    return alwaysReturns(stmt.thenStatement) && alwaysReturns(stmt.elseStatement);
  }
  if (ts.isTryStatement(stmt)) {
    // If finally always terminates it must always throw (return in finally is rejected by E033).
    // An always-throwing finally overrides any packed "return" outcome.
    if (stmt.finallyBlock && alwaysTerminates(stmt.finallyBlock)) {
      return false;
    }
    const bodyReturns = alwaysReturns(stmt.tryBlock);
    if (!stmt.catchClause) {
      return bodyReturns;
    }
    return bodyReturns && alwaysReturns(stmt.catchClause.block);
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
  if (index >= stmts.length) {
    return terminal();
  }

  const stmt = stmts[index]!;
  const rest = () => emitStatementListWithTerminal(stmts, index + 1, ctx, terminal);
  const isLast = index === stmts.length - 1;

  // Return statement
  if (ts.isReturnStatement(stmt)) {
    if (stmt.expression) {
      return emitExpression(stmt.expression, ctx);
    }
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
    if (isLast) {
      return Let(newIrName, newValue, terminal());
    }
    return Let(newIrName, newValue, rest());
  }

  // Expression statement
  if (ts.isExpressionStatement(stmt)) {
    const expr = stmt.expression;
    checkUnsupportedExpression(expr, ctx);
    if (ts.isYieldExpression(expr) && expr.asteriskToken && expr.expression) {
      const effect = emitYieldStar(expr.expression, ctx);
      if (isLast) {
        return Let(ctx.counter.next("discard"), effect, terminal());
      }
      return Let(ctx.counter.next("discard"), effect, rest());
    }
    if (isLast) {
      return Let(ctx.counter.next("discard"), emitExpression(expr, ctx), terminal());
    }
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

  // ForOfStatement in branch
  if (ts.isForOfStatement(stmt)) {
    return emitForOfEach(stmt, rest, isLast, ctx);
  }

  // ForInStatement: always rejected
  if (ts.isForInStatement(stmt)) {
    throw new CompileError("E013", "for...in is not allowed", 0, 0);
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
  if (stmt.elseStatement) {
    compileBranchBodyToJoin(
      getBodyStatements(stmt.elseStatement),
      allLetVars,
      snapshot,
      dryElseCtx,
    );
  }

  const joinVars = allLetVars.filter((v) => {
    const thenVer = getVersion(v, dryThenCtx);
    const elseVer = stmt.elseStatement ? getVersion(v, dryElseCtx) : (snapshot.get(v) ?? 0);
    return thenVer !== (snapshot.get(v) ?? 0) || elseVer !== (snapshot.get(v) ?? 0);
  });

  if (joinVars.length === 0) {
    const preIfStack = cloneScopeStack(ctx.scopeStack);
    const thenCapCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    if (stmt.elseStatement) {
      const elseCapCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
      const thenBranch = emitStatementBodyWithCtx(stmt.thenStatement, thenCapCtx);
      const elseBranch = emitStatementBodyWithCtx(stmt.elseStatement, elseCapCtx);
      joinCapabilityStates(thenCapCtx.scopeStack, elseCapCtx.scopeStack, ctx);
      return Let(ctx.counter.next("discard"), If(condition, thenBranch, elseBranch), rest());
    }
    const thenBranch = emitStatementBodyWithCtx(stmt.thenStatement, thenCapCtx);
    joinCapabilityStates(thenCapCtx.scopeStack, preIfStack, ctx);
    return Let(ctx.counter.next("discard"), If(condition, thenBranch), rest());
  }

  const preIfStack = cloneScopeStack(ctx.scopeStack);
  const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const elseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const thenJoinExpr = compileBranchToExpr(stmt.thenStatement, joinVars, thenCtx);
  const elseJoinExpr = stmt.elseStatement
    ? compileBranchToExpr(stmt.elseStatement, joinVars, elseCtx)
    : buildJoinExprFromSnapshot(joinVars, snapshot);

  applyJoinVersions(joinVars, ctx);
  if (stmt.elseStatement) {
    joinCapabilityStates(thenCtx.scopeStack, elseCtx.scopeStack, ctx);
  } else {
    joinCapabilityStates(thenCtx.scopeStack, preIfStack, ctx);
  }

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
    if (!hasMore) {
      return If(condition, thenBranch);
    }
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
  if (stmt.elseStatement) {
    compileBranchBodyToJoin(elseBodyStmts, allLetVars, snapshot, dryElseCtx);
  }

  const joinVars = allLetVars.filter((v) => {
    const thenVersion = getVersion(v, dryThenCtx);
    const elseVersion = stmt.elseStatement ? getVersion(v, dryElseCtx) : (snapshot.get(v) ?? 0);
    return thenVersion !== (snapshot.get(v) ?? 0) || elseVersion !== (snapshot.get(v) ?? 0);
  });

  if (joinVars.length === 0) {
    // No SSA variables changed — compile in clones for capability state tracking
    const preIfStack = cloneScopeStack(ctx.scopeStack);
    const thenCapCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    if (stmt.elseStatement) {
      const elseCapCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
      const thenBranch = emitStatementBody(stmt.thenStatement, thenCapCtx);
      const elseBranch = emitStatementBody(stmt.elseStatement, elseCapCtx);
      joinCapabilityStates(thenCapCtx.scopeStack, elseCapCtx.scopeStack, ctx);
      const ifExpr = If(condition, thenBranch, elseBranch);
      if (!hasMore) {
        return ifExpr;
      }
      return Let(ctx.counter.next("discard"), ifExpr, rest());
    }
    const thenBranch = emitStatementBody(stmt.thenStatement, thenCapCtx);
    joinCapabilityStates(thenCapCtx.scopeStack, preIfStack, ctx);
    const ifExpr = If(condition, thenBranch);
    if (!hasMore) {
      return ifExpr;
    }
    return Let(ctx.counter.next("discard"), ifExpr, rest());
  }

  // Phase 2: compile branches as join-producing expressions using fresh clones.
  const preIfStack = cloneScopeStack(ctx.scopeStack);
  const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const elseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const thenJoinExpr = compileBranchToExpr(stmt.thenStatement, joinVars, thenCtx);
  const elseJoinExpr = stmt.elseStatement
    ? compileBranchToExpr(stmt.elseStatement, joinVars, elseCtx)
    : buildJoinExprFromSnapshot(joinVars, snapshot);

  // Update main scope stack versions to post-join
  applyJoinVersions(joinVars, ctx);
  // Join capability states from both branches
  if (stmt.elseStatement) {
    joinCapabilityStates(thenCtx.scopeStack, elseCtx.scopeStack, ctx);
  } else {
    joinCapabilityStates(thenCtx.scopeStack, preIfStack, ctx);
  }

  if (joinVars.length === 1) {
    const v = joinVars[0]!;
    const joinIrName = resolveRef(v, ctx);
    const ifExpr = If(condition, thenJoinExpr, elseJoinExpr);
    if (!hasMore) {
      return Let(joinIrName, ifExpr, null as unknown as Expr);
    }
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
  if (!stmt) {
    return false;
  }
  let found = false;
  function visit(node: ts.Node): void {
    if (found) {
      return;
    }
    if (ts.isReturnStatement(node)) {
      found = true;
      return;
    }
    // Do not descend into nested function bodies (they have their own returns)
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(stmt);
  return found;
}

/** Return true if the statement contains an assignment to any outer let binding. */
function finallyContainsOuterAssignment(stmt: ts.Statement, ctx: EmitContext): string | undefined {
  let found: string | undefined;
  function visit(node: ts.Node): void {
    if (found) {
      return;
    }
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

  // ── Validation: step 1 — return in finally → E033 ──
  if (blockContainsReturn(stmt.finallyBlock)) {
    throw error("E033", "'return' inside a finally clause is not supported", stmt, ctx);
  }

  // ── Packing mode determination ──
  const needsPack =
    blockContainsReturn(stmt.tryBlock) || blockContainsReturn(stmt.catchClause?.block);

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

  // ── Packing mode emit ──
  if (needsPack) {
    return emitTryStatementPacked(stmt, stmts, index, ctx, catchParam, catchBlock, joinVars);
  }

  // ── Emit: J_bc empty (non-packing) ──
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
    if (!hasMore) {
      return tryIr;
    }
    return Let(ctx.counter.next("discard"), tryIr, rest());
  }

  // ── Emit: J_bc non-empty (non-packing) ──
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

  // Capture pre-trial SSA names BEFORE applyJoinVersions advances versions.
  // These are used in the inner-Try fallback for error paths (see below).
  const preTrialRefs = new Map<string, string>();
  for (const v of joinVars) {
    preTrialRefs.set(v, resolveRef(v, ctx));
  }

  applyJoinVersions(joinVars, ctx);

  // J_bc non-empty: compile finally with inner-Try-based unpack.
  // On the success path, fp = outcome.value and the inner Try body (Ref(fp)) succeeds.
  // On the error path (catchable or non-catchable), fp is unbound, so Ref(fp) throws
  // UnboundVariable (which is catchable), and the inner Try catch returns the pre-trial ref.
  // This keeps finallyPayload semantics unchanged (raw outcome.value on success).
  let finallyExpr: Expr | undefined;
  let finallyPayload: string | undefined;
  if (stmt.finallyBlock) {
    finallyPayload = ctx.counter.next("fp");
    const postJoinCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    let compiledFinally: Expr = emitStatementBody(stmt.finallyBlock, postJoinCtx);
    if (joinVars.length === 1) {
      const v = joinVars[0]!;
      const joinIrName = resolveRef(v, ctx);
      const errFp = ctx.counter.next("err_fp");
      compiledFinally = Let(
        joinIrName,
        Try(Ref(finallyPayload), errFp, Ref(preTrialRefs.get(v)!)),
        compiledFinally,
      );
    } else {
      const errFp = ctx.counter.next("err_fp");
      const fpEff = ctx.counter.next("fp_eff");
      const preTrialConstruct: Record<string, Expr> = {};
      for (const v of joinVars) {
        preTrialConstruct[v] = Ref(preTrialRefs.get(v)!);
      }
      let innerChain = compiledFinally;
      for (let i = joinVars.length - 1; i >= 0; i--) {
        const v = joinVars[i]!;
        const joinIrName = resolveRef(v, ctx);
        innerChain = Let(joinIrName, Get(Ref(fpEff), v), innerChain);
      }
      compiledFinally = Let(
        fpEff,
        Try(Ref(finallyPayload), errFp, Construct(preTrialConstruct as Record<string, Expr>)),
        innerChain,
      );
    }
    finallyExpr = compiledFinally;
  }

  const tryIr = Try(bodyJoinExpr, catchParam, catchJoinExpr, finallyExpr, finallyPayload);

  if (joinVars.length === 1) {
    const v = joinVars[0]!;
    const joinIrName = resolveRef(v, ctx);
    if (!hasMore) {
      return Let(joinIrName, tryIr, null as unknown as Expr);
    }
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

// ── Try statement — packing mode (§6.7.1) ──

/** Emit a try statement in packing mode (return present in try or catch body). */
function emitTryStatementPacked(
  stmt: ts.TryStatement,
  stmts: ts.Statement[],
  index: number,
  ctx: EmitContext,
  catchParam: string | undefined,
  catchBlock: ts.Block | undefined,
  joinVars: string[],
): Expr {
  if (joinVars.length === 0) {
    // ── Packing, J_bc empty ──
    const bodyCtxP: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const bodyExpr = compileBranchToExprPacked(stmt.tryBlock, [], bodyCtxP);

    let catchExpr: Expr | undefined;
    if (catchBlock && catchParam) {
      const catchCtxP: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
      pushFrame(catchCtxP);
      catchCtxP.scopeStack[catchCtxP.scopeStack.length - 1]!.set(catchParam, {
        kind: "const",
        version: 0,
      });
      catchExpr = compileBranchToExprPacked(catchBlock, [], catchCtxP);
    }

    const finallyExpr = stmt.finallyBlock
      ? (() => {
          const finallyCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
          return emitStatementBody(stmt.finallyBlock!, finallyCtx);
        })()
      : undefined;

    const r = ctx.counter.next("r");
    const tryIr = Try(bodyExpr, catchParam, catchExpr, finallyExpr);
    const useDirectExtract = alwaysReturns(stmt);
    if (useDirectExtract) {
      return Let(r, tryIr, Get(Ref(r), "__value") as Expr);
    }
    return Let(r, tryIr, buildPackedDispatch(r, [], ctx, stmts, index));
  }

  // ── Packing, J_bc non-empty ──
  const bodyCtxP: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const bodyExpr = compileBranchToExprPacked(stmt.tryBlock, joinVars, bodyCtxP);

  let catchExpr: Expr | undefined;
  if (catchBlock && catchParam) {
    const catchCtxP: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    pushFrame(catchCtxP);
    catchCtxP.scopeStack[catchCtxP.scopeStack.length - 1]!.set(catchParam, {
      kind: "const",
      version: 0,
    });
    catchExpr = compileBranchToExprPacked(catchBlock, joinVars, catchCtxP);
  }

  // Capture pre-trial SSA names BEFORE applyJoinVersions
  const preTrialRefs = new Map<string, string>();
  for (const v of joinVars) {
    preTrialRefs.set(v, resolveRef(v, ctx));
  }

  applyJoinVersions(joinVars, ctx);

  // Finally: MUST use struct-shaped unpack for ALL J_bc sizes >= 1 under packing (§6.7.1.5 F5)
  let finallyExpr: Expr | undefined;
  let finallyPayload: string | undefined;
  if (stmt.finallyBlock) {
    finallyPayload = ctx.counter.next("fp");
    const postJoinCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    let compiledFinally: Expr = emitStatementBody(stmt.finallyBlock, postJoinCtx);

    const errFp = ctx.counter.next("err_fp");
    const fpEff = ctx.counter.next("fp_eff");
    const preTrialConstruct: Record<string, Expr> = {};
    for (const v of joinVars) {
      preTrialConstruct[v] = Ref(preTrialRefs.get(v)!);
    }
    let innerChain = compiledFinally;
    for (let i = joinVars.length - 1; i >= 0; i--) {
      const v = joinVars[i]!;
      const joinIrName = resolveRef(v, ctx);
      innerChain = Let(joinIrName, Get(Ref(fpEff), v), innerChain);
    }
    compiledFinally = Let(
      fpEff,
      Try(Ref(finallyPayload), errFp, Construct(preTrialConstruct as Record<string, Expr>)),
      innerChain,
    );
    finallyExpr = compiledFinally;
  }

  const r = ctx.counter.next("r");
  const tryIr = Try(bodyExpr, catchParam, catchExpr, finallyExpr, finallyPayload);

  const useDirectExtract = alwaysReturns(stmt);
  if (useDirectExtract) {
    return Let(r, tryIr, Get(Ref(r), "__value") as Expr);
  }
  return Let(r, tryIr, buildPackedDispatch(r, joinVars, ctx, stmts, index));
}

/** Build the post-Try dispatch expression for packing mode. */
function buildPackedDispatch(
  r: string,
  joinVars: string[],
  ctx: EmitContext,
  stmts: ts.Statement[],
  index: number,
): Expr {
  const hasMore = index < stmts.length - 1;
  const rest = () => emitStatementList(stmts, index + 1, ctx);

  let fallthroughCont: Expr;
  if (joinVars.length === 0) {
    fallthroughCont = hasMore ? rest() : (null as unknown as Expr);
  } else if (joinVars.length === 1) {
    const v = joinVars[0]!;
    const joinIrName = resolveRef(v, ctx);
    fallthroughCont = Let(joinIrName, Get(Ref(r), v), hasMore ? rest() : (null as unknown as Expr));
  } else {
    let chain: Expr = hasMore ? rest() : (null as unknown as Expr);
    for (let i = joinVars.length - 1; i >= 0; i--) {
      const v = joinVars[i]!;
      const joinIrName = resolveRef(v, ctx);
      chain = Let(joinIrName, Get(Ref(r), v), chain);
    }
    fallthroughCont = chain;
  }

  return If(
    Eq(Get(Ref(r), "__tag") as Expr, "return" as unknown as Expr) as Expr,
    Get(Ref(r), "__value") as Expr,
    fallthroughCont,
  );
}

/** Compile a clause body in packing mode. Returns a packed outcome expression. */
function compileBranchToExprPacked(
  block: ts.Statement,
  joinVars: string[],
  branchCtx: EmitContext,
): Expr {
  const stmts = getBodyStatements(block);
  return emitStatementListWithTerminalPacked(stmts, 0, branchCtx, joinVars, () => {
    // Fallthrough terminal: Construct({ __tag: "fallthrough", __value: null, ...joinVarRefs })
    const fields: Record<string, Expr> = {
      __tag: "fallthrough" as unknown as Expr,
      __value: null as unknown as Expr,
    };
    for (const v of joinVars) {
      fields[v] = Ref(resolveRef(v, branchCtx));
    }
    return Construct(fields);
  });
}

/** Like emitStatementListWithTerminal but intercepts returns for packed outcomes. */
function emitStatementListWithTerminalPacked(
  stmts: ts.Statement[],
  index: number,
  ctx: EmitContext,
  joinVars: string[],
  terminal: () => Expr,
): Expr {
  if (index >= stmts.length) {
    return terminal();
  }

  const stmt = stmts[index]!;
  const rest = () => emitStatementListWithTerminalPacked(stmts, index + 1, ctx, joinVars, terminal);
  const isLast = index === stmts.length - 1;

  // Return statement → packed outcome
  if (ts.isReturnStatement(stmt)) {
    const retVal = stmt.expression
      ? emitExpression(stmt.expression, ctx)
      : (null as unknown as Expr);
    const fields: Record<string, Expr> = {
      __tag: "return" as unknown as Expr,
      __value: retVal,
    };
    for (const v of joinVars) {
      fields[v] = Ref(resolveRef(v, ctx));
    }
    return Construct(fields);
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
    if (isLast) {
      return Let(newIrName, newValue, terminal());
    }
    return Let(newIrName, newValue, rest());
  }

  // Expression statement
  if (ts.isExpressionStatement(stmt)) {
    const expr = stmt.expression;
    checkUnsupportedExpression(expr, ctx);
    if (ts.isYieldExpression(expr) && expr.asteriskToken && expr.expression) {
      const effect = emitYieldStar(expr.expression, ctx);
      if (isLast) {
        return Let(ctx.counter.next("discard"), effect, terminal());
      }
      return Let(ctx.counter.next("discard"), effect, rest());
    }
    if (isLast) {
      return Let(ctx.counter.next("discard"), emitExpression(expr, ctx), terminal());
    }
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
      const blockResult = emitStatementListWithTerminalPacked(
        Array.from(stmt.statements),
        0,
        ctx,
        joinVars,
        index === stmts.length - 1 ? terminal : rest,
      );
      return blockResult;
    } finally {
      popFrame(ctx);
    }
  }

  // If statement in packed branch
  if (ts.isIfStatement(stmt)) {
    return emitIfStatementInListPacked(stmt, stmts, index, ctx, joinVars, terminal);
  }

  // While statement in packed branch
  if (ts.isWhileStatement(stmt)) {
    return emitWhileStatementInPackedBranch(stmt, stmts, index, ctx, joinVars, terminal);
  }

  // Nested try statement in packed branch
  if (ts.isTryStatement(stmt)) {
    return emitTryStatementInPackedBranch(stmt, stmts, index, ctx, joinVars, terminal);
  }

  // ForOfStatement in packed branch
  if (ts.isForOfStatement(stmt)) {
    return emitForOfEachPacked(stmt, stmts, index, ctx, joinVars, terminal);
  }

  // ForInStatement: always rejected
  if (ts.isForInStatement(stmt)) {
    throw new CompileError("E013", "for...in is not allowed", 0, 0);
  }

  throw new CompileError(
    "E999",
    `Unsupported statement in packed branch: ${ts.SyntaxKind[stmt.kind]}`,
    0,
    0,
  );
}

/** Emit an if-statement inside a packed branch compilation context. */
function emitIfStatementInListPacked(
  stmt: ts.IfStatement,
  stmts: ts.Statement[],
  index: number,
  ctx: EmitContext,
  joinVars: string[],
  terminal: () => Expr,
): Expr {
  const rest = () => emitStatementListWithTerminalPacked(stmts, index + 1, ctx, joinVars, terminal);
  const condition = emitExpression(stmt.expression, ctx);

  const thenTerminates = alwaysTerminates(stmt.thenStatement);
  const elseTerminates = stmt.elseStatement ? alwaysTerminates(stmt.elseStatement) : false;

  if (thenTerminates && elseTerminates) {
    // Both branches always terminate → compile each in packed mode
    const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const thenBranch = emitStatementListWithTerminalPacked(
      getBodyStatements(stmt.thenStatement),
      0,
      thenCtx,
      joinVars,
      terminal,
    );
    const elseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const elseBranch = emitStatementListWithTerminalPacked(
      getBodyStatements(stmt.elseStatement!),
      0,
      elseCtx,
      joinVars,
      terminal,
    );
    return If(condition, thenBranch, elseBranch);
  }

  if (thenTerminates && !stmt.elseStatement) {
    // Then always terminates, no else → else path produces fallthrough terminal
    const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const thenBranch = emitStatementListWithTerminalPacked(
      getBodyStatements(stmt.thenStatement),
      0,
      thenCtx,
      joinVars,
      terminal,
    );
    // Implicit else: produce fallthrough with current join var versions
    const fallthroughFields: Record<string, Expr> = {
      __tag: "fallthrough" as unknown as Expr,
      __value: null as unknown as Expr,
    };
    for (const v of joinVars) {
      fallthroughFields[v] = Ref(resolveRef(v, ctx));
    }
    return If(condition, thenBranch, Construct(fallthroughFields));
  }

  if (thenTerminates && stmt.elseStatement && !elseTerminates) {
    // Then terminates, else falls through — clone ctx for then
    const thenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const thenBranch = emitStatementListWithTerminalPacked(
      getBodyStatements(stmt.thenStatement),
      0,
      thenCtx,
      joinVars,
      terminal,
    );
    const elseAndRest = emitStatementListWithTerminalPacked(
      getBodyStatements(stmt.elseStatement),
      0,
      ctx,
      joinVars,
      index < stmts.length - 1 ? rest : terminal,
    );
    return If(condition, thenBranch, elseAndRest);
  }

  if (!thenTerminates && elseTerminates) {
    // Else terminates, then falls through — clone ctx for else
    const elseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const thenAndRest = emitStatementListWithTerminalPacked(
      getBodyStatements(stmt.thenStatement),
      0,
      ctx,
      joinVars,
      index < stmts.length - 1 ? rest : terminal,
    );
    const elseBranch = emitStatementListWithTerminalPacked(
      getBodyStatements(stmt.elseStatement!),
      0,
      elseCtx,
      joinVars,
      terminal,
    );
    return If(condition, thenAndRest, elseBranch);
  }

  // Neither terminates — full SSA join for if-level vars, then packed continuation
  const snapshot = snapshotVersions(ctx);
  const allLetVars = getAllLetVars(ctx);
  const dryThenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const dryElseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  compileBranchBodyToJoin(getBodyStatements(stmt.thenStatement), allLetVars, snapshot, dryThenCtx);
  if (stmt.elseStatement) {
    compileBranchBodyToJoin(
      getBodyStatements(stmt.elseStatement),
      allLetVars,
      snapshot,
      dryElseCtx,
    );
  }

  const ifJoinVars = allLetVars.filter((v) => {
    const thenVer = getVersion(v, dryThenCtx);
    const elseVer = stmt.elseStatement ? getVersion(v, dryElseCtx) : (snapshot.get(v) ?? 0);
    return thenVer !== (snapshot.get(v) ?? 0) || elseVer !== (snapshot.get(v) ?? 0);
  });

  if (ifJoinVars.length === 0) {
    // No if-level SSA joins — compile both branches in clones for capability state tracking
    const preIfStack = cloneScopeStack(ctx.scopeStack);
    const thenCapCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const thenBranch = emitStatementListWithTerminalPacked(
      getBodyStatements(stmt.thenStatement),
      0,
      thenCapCtx,
      joinVars,
      rest,
    );
    if (stmt.elseStatement) {
      const elseCapCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
      const elseBranch = emitStatementListWithTerminalPacked(
        getBodyStatements(stmt.elseStatement),
        0,
        elseCapCtx,
        joinVars,
        rest,
      );
      joinCapabilityStates(thenCapCtx.scopeStack, elseCapCtx.scopeStack, ctx);
      return If(condition, thenBranch, elseBranch);
    }
    joinCapabilityStates(thenCapCtx.scopeStack, preIfStack, ctx);
    return If(condition, thenBranch, rest());
  }

  // If-level SSA joins: use standard compileBranchToExpr (fine since neither branch always terminates),
  // then continue with packed rest
  const preIfStack = cloneScopeStack(ctx.scopeStack);
  const ifThenCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const ifElseCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const thenJoinExpr = compileBranchToExpr(stmt.thenStatement, ifJoinVars, ifThenCtx);
  const elseJoinExpr = stmt.elseStatement
    ? compileBranchToExpr(stmt.elseStatement, ifJoinVars, ifElseCtx)
    : buildJoinExprFromSnapshot(ifJoinVars, snapshot);

  applyJoinVersions(ifJoinVars, ctx);
  if (stmt.elseStatement) {
    joinCapabilityStates(ifThenCtx.scopeStack, ifElseCtx.scopeStack, ctx);
  } else {
    joinCapabilityStates(ifThenCtx.scopeStack, preIfStack, ctx);
  }

  if (ifJoinVars.length === 1) {
    const v = ifJoinVars[0]!;
    return Let(resolveRef(v, ctx), If(condition, thenJoinExpr, elseJoinExpr), rest());
  }

  const joinName = ctx.counter.next("j");
  let result = rest();
  for (let i = ifJoinVars.length - 1; i >= 0; i--) {
    const v = ifJoinVars[i]!;
    result = Let(resolveRef(v, ctx), Get(Ref(joinName), v), result);
  }
  return Let(joinName, If(condition, thenJoinExpr, elseJoinExpr), result);
}

/** Emit a while statement inside a packed branch compilation context. */
function emitWhileStatementInPackedBranch(
  stmt: ts.WhileStatement,
  stmts: ts.Statement[],
  index: number,
  ctx: EmitContext,
  outerJoinVars: string[],
  terminal: () => Expr,
): Expr {
  const rest = () =>
    emitStatementListWithTerminalPacked(stmts, index + 1, ctx, outerJoinVars, terminal);
  const isLast = index === stmts.length - 1;
  const hasReturn = bodyContainsReturn(stmt.statement);
  const loopCarriedVars = detectLoopCarriedLetVars(stmt, ctx);

  if (!hasReturn && loopCarriedVars.length === 0) {
    // Case A: no return, no loop-carried state — While IR node, then packed continuation
    const preLoopStack = cloneScopeStack(ctx.scopeStack);
    const condition = emitExpression(stmt.expression, ctx);
    const bodyStmts = getBodyStatements(stmt.statement);
    const bodyCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const bodyExpr = emitStatementList(bodyStmts, 0, bodyCtx);
    joinCapabilityStates(bodyCtx.scopeStack, preLoopStack, ctx);
    const whileExpr = While(condition, [bodyExpr]);
    const whileName = ctx.counter.next("while");
    return Let(whileName, whileExpr, isLast ? terminal() : rest());
  }

  // Case B: has return or loop-carried state — use recursive Fn + Call with outer packing
  const outerPackCont = isLast ? terminal : rest;
  return emitWhileCaseB(stmt, rest, false, ctx, loopCarriedVars, hasReturn, {
    joinVars: outerJoinVars,
    fallthroughCont: outerPackCont,
  });
}

/** Emit a try statement nested inside a packed branch compilation context. */
function emitTryStatementInPackedBranch(
  stmt: ts.TryStatement,
  stmts: ts.Statement[],
  index: number,
  ctx: EmitContext,
  outerJoinVars: string[],
  terminal: () => Expr,
): Expr {
  const isLast = index === stmts.length - 1;
  const outerCont = isLast
    ? terminal
    : () => emitStatementListWithTerminalPacked(stmts, index + 1, ctx, outerJoinVars, terminal);

  // Validate: E033 only for finally
  if (blockContainsReturn(stmt.finallyBlock)) {
    throw error("E033", "'return' inside a finally clause is not supported", stmt, ctx);
  }
  if (stmt.catchClause && !stmt.catchClause.variableDeclaration) {
    throw error("E034", "catch clause requires a binding parameter", stmt.catchClause, ctx);
  }
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

  const innerNeedsPack = blockContainsReturn(stmt.tryBlock) || blockContainsReturn(catchBlock);

  // ── J_bc computation for inner try ──
  const snapshot = snapshotVersions(ctx);
  const allLetVars = getAllLetVars(ctx);
  const dryBodyCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  compileBranchBodyToJoin(getBodyStatements(stmt.tryBlock), allLetVars, snapshot, dryBodyCtx);
  const dryCatchCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  if (catchBlock && catchParam) {
    pushFrame(dryCatchCtx);
    dryCatchCtx.scopeStack[dryCatchCtx.scopeStack.length - 1]!.set(catchParam, {
      kind: "const",
      version: 0,
    });
  }
  if (catchBlock) {
    compileBranchBodyToJoin(getBodyStatements(catchBlock), allLetVars, snapshot, dryCatchCtx);
  }
  const innerJoinVars = allLetVars.filter((v) => {
    const bodyVer = getVersion(v, dryBodyCtx);
    const catchVer = catchBlock ? getVersion(v, dryCatchCtx) : (snapshot.get(v) ?? 0);
    return bodyVer !== (snapshot.get(v) ?? 0) || catchVer !== (snapshot.get(v) ?? 0);
  });

  if (!innerNeedsPack) {
    // Inner try doesn't need packing — emit it as a statement, then outer packed continuation
    if (innerJoinVars.length === 0) {
      const bodyExpr = emitStatementBody(stmt.tryBlock, ctx);
      const catchExpr = catchBlock
        ? (() => {
            const catchCtxNP: EmitContext = {
              ...ctx,
              scopeStack: cloneScopeStack(ctx.scopeStack),
            };
            if (catchParam) {
              pushFrame(catchCtxNP);
              catchCtxNP.scopeStack[catchCtxNP.scopeStack.length - 1]!.set(catchParam, {
                kind: "const",
                version: 0,
              });
            }
            return emitStatementBody(catchBlock, catchCtxNP);
          })()
        : undefined;
      const finallyExpr = stmt.finallyBlock
        ? (() => {
            const finallyCtxNP: EmitContext = {
              ...ctx,
              scopeStack: cloneScopeStack(ctx.scopeStack),
            };
            return emitStatementBody(stmt.finallyBlock!, finallyCtxNP);
          })()
        : undefined;
      const tryIrNP = Try(bodyExpr, catchParam, catchExpr, finallyExpr);
      return Let(ctx.counter.next("discard"), tryIrNP, outerCont());
    }
    // innerJoinVars non-empty, no packing: emit standard join, then outer packed continuation
    const bodyCtxNP: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    const bodyJoinExprNP = compileBranchToExpr(stmt.tryBlock, innerJoinVars, bodyCtxNP);
    let catchJoinExprNP: Expr | undefined;
    if (catchBlock) {
      const catchCtxNP: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
      if (catchParam) {
        pushFrame(catchCtxNP);
        catchCtxNP.scopeStack[catchCtxNP.scopeStack.length - 1]!.set(catchParam, {
          kind: "const",
          version: 0,
        });
      }
      catchJoinExprNP = compileBranchToExpr(catchBlock, innerJoinVars, catchCtxNP);
    }
    const preTrialRefsNP = new Map<string, string>();
    for (const v of innerJoinVars) {
      preTrialRefsNP.set(v, resolveRef(v, ctx));
    }
    applyJoinVersions(innerJoinVars, ctx);
    let finallyExprNP: Expr | undefined;
    let finallyPayloadNP: string | undefined;
    if (stmt.finallyBlock) {
      finallyPayloadNP = ctx.counter.next("fp");
      const postJoinCtxNP: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
      let compiledFinallyNP: Expr = emitStatementBody(stmt.finallyBlock, postJoinCtxNP);
      if (innerJoinVars.length === 1) {
        const v = innerJoinVars[0]!;
        const joinIrName = resolveRef(v, ctx);
        const errFpNP = ctx.counter.next("err_fp");
        compiledFinallyNP = Let(
          joinIrName,
          Try(Ref(finallyPayloadNP), errFpNP, Ref(preTrialRefsNP.get(v)!)),
          compiledFinallyNP,
        );
      } else {
        const errFpNP = ctx.counter.next("err_fp");
        const fpEffNP = ctx.counter.next("fp_eff");
        const preTrialConstructNP: Record<string, Expr> = {};
        for (const v of innerJoinVars) {
          preTrialConstructNP[v] = Ref(preTrialRefsNP.get(v)!);
        }
        let innerChainNP = compiledFinallyNP;
        for (let i = innerJoinVars.length - 1; i >= 0; i--) {
          const v = innerJoinVars[i]!;
          innerChainNP = Let(resolveRef(v, ctx), Get(Ref(fpEffNP), v), innerChainNP);
        }
        compiledFinallyNP = Let(
          fpEffNP,
          Try(
            Ref(finallyPayloadNP),
            errFpNP,
            Construct(preTrialConstructNP as Record<string, Expr>),
          ),
          innerChainNP,
        );
      }
      finallyExprNP = compiledFinallyNP;
    }
    const tryIrNP2 = Try(
      bodyJoinExprNP,
      catchParam,
      catchJoinExprNP,
      finallyExprNP,
      finallyPayloadNP,
    );
    if (innerJoinVars.length === 1) {
      const v = innerJoinVars[0]!;
      return Let(resolveRef(v, ctx), tryIrNP2, outerCont());
    }
    const joinNameNP = ctx.counter.next("j");
    let resultNP = outerCont();
    for (let i = innerJoinVars.length - 1; i >= 0; i--) {
      const v = innerJoinVars[i]!;
      resultNP = Let(resolveRef(v, ctx), Get(Ref(joinNameNP), v), resultNP);
    }
    return Let(joinNameNP, tryIrNP2, resultNP);
  }

  // ── Inner try needs packing ──
  const innerBodyCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const innerBodyExpr = compileBranchToExprPacked(stmt.tryBlock, innerJoinVars, innerBodyCtx);

  let innerCatchExpr: Expr | undefined;
  if (catchBlock && catchParam) {
    const innerCatchCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    pushFrame(innerCatchCtx);
    innerCatchCtx.scopeStack[innerCatchCtx.scopeStack.length - 1]!.set(catchParam, {
      kind: "const",
      version: 0,
    });
    innerCatchExpr = compileBranchToExprPacked(catchBlock, innerJoinVars, innerCatchCtx);
  }

  const innerPreTrialRefs = new Map<string, string>();
  for (const v of innerJoinVars) {
    innerPreTrialRefs.set(v, resolveRef(v, ctx));
  }

  applyJoinVersions(innerJoinVars, ctx);

  let innerFinallyExpr: Expr | undefined;
  let innerFinallyPayload: string | undefined;
  if (stmt.finallyBlock) {
    innerFinallyPayload = ctx.counter.next("fp");
    const innerPostJoinCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
    let innerCompiledFinally: Expr = emitStatementBody(stmt.finallyBlock, innerPostJoinCtx);
    const errFpInner = ctx.counter.next("err_fp");
    const fpEffInner = ctx.counter.next("fp_eff");
    const innerPreTrialConstruct: Record<string, Expr> = {};
    for (const v of innerJoinVars) {
      innerPreTrialConstruct[v] = Ref(innerPreTrialRefs.get(v)!);
    }
    let innerFinallyChain = innerCompiledFinally;
    for (let i = innerJoinVars.length - 1; i >= 0; i--) {
      const v = innerJoinVars[i]!;
      innerFinallyChain = Let(resolveRef(v, ctx), Get(Ref(fpEffInner), v), innerFinallyChain);
    }
    innerCompiledFinally = Let(
      fpEffInner,
      Try(
        Ref(innerFinallyPayload),
        errFpInner,
        Construct(innerPreTrialConstruct as Record<string, Expr>),
      ),
      innerFinallyChain,
    );
    innerFinallyExpr = innerCompiledFinally;
  }

  const r = ctx.counter.next("r");
  const innerTryIr = Try(
    innerBodyExpr,
    catchParam,
    innerCatchExpr,
    innerFinallyExpr,
    innerFinallyPayload,
  );

  const innerAlwaysReturns = alwaysReturns(stmt);

  if (innerAlwaysReturns) {
    // Direct extraction: wrap in outer packed return
    const outerReturnFields: Record<string, Expr> = {
      __tag: "return" as unknown as Expr,
      __value: Get(Ref(r), "__value") as Expr,
    };
    for (const v of outerJoinVars) {
      outerReturnFields[v] = Ref(resolveRef(v, ctx));
    }
    return Let(r, innerTryIr, Construct(outerReturnFields));
  }

  // Dispatch: translate inner packed outcome to outer packed outcome
  const outerReturnFields: Record<string, Expr> = {
    __tag: "return" as unknown as Expr,
    __value: Get(Ref(r), "__value") as Expr,
  };
  for (const v of outerJoinVars) {
    outerReturnFields[v] = Ref(resolveRef(v, ctx));
  }
  const outerReturnExpr = Construct(outerReturnFields);

  // Fallthrough: extract inner join vars, then outer continuation
  let fallthroughCont: Expr;
  if (innerJoinVars.length === 0) {
    fallthroughCont = outerCont();
  } else if (innerJoinVars.length === 1) {
    const v = innerJoinVars[0]!;
    fallthroughCont = Let(resolveRef(v, ctx), Get(Ref(r), v), outerCont());
  } else {
    let chain: Expr = outerCont();
    for (let i = innerJoinVars.length - 1; i >= 0; i--) {
      const v = innerJoinVars[i]!;
      chain = Let(resolveRef(v, ctx), Get(Ref(r), v), chain);
    }
    fallthroughCont = chain;
  }

  return Let(
    r,
    innerTryIr,
    If(
      Eq(Get(Ref(r), "__tag") as Expr, "return" as unknown as Expr) as Expr,
      outerReturnExpr,
      fallthroughCont,
    ),
  );
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
  if (found && found.info.kind === "let") {
    return found.info.version;
  }
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

/** Build a join expression using snapshot versions (for the "no else" case). */
function buildJoinExprFromSnapshot(vars: string[], snapshot: Map<string, number>): Expr {
  if (vars.length === 0) {
    return null as unknown as Expr;
  }
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

/** Join capability states from two branches into ctx. If states differ, result is indeterminate. */
function joinCapabilityStates(
  thenStack: ScopeFrame[],
  elseStack: ScopeFrame[],
  ctx: EmitContext,
): void {
  for (let i = 0; i < ctx.scopeStack.length; i++) {
    const frame = ctx.scopeStack[i]!;
    const thenFrame = thenStack[i];
    const elseFrame = elseStack[i];
    if (!thenFrame || !elseFrame) {
      continue;
    }
    for (const [name, info] of frame) {
      if (!info.capability) {
        continue;
      }
      const thenCap = thenFrame.get(name)?.capability;
      const elseCap = elseFrame.get(name)?.capability;
      if (!thenCap || !elseCap) {
        continue;
      }
      if (thenCap.state !== elseCap.state) {
        info.capability.state = "indeterminate";
      } else {
        info.capability.state = thenCap.state;
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
  const preLoopStack = cloneScopeStack(ctx.scopeStack);
  const condition = emitExpression(stmt.expression, ctx);
  const bodyStmts = getBodyStatements(stmt.statement);
  const bodyCtx: EmitContext = { ...ctx, scopeStack: cloneScopeStack(ctx.scopeStack) };
  const bodyExpr = emitStatementList(bodyStmts, 0, bodyCtx);
  joinCapabilityStates(bodyCtx.scopeStack, preLoopStack, ctx);
  const whileExpr = While(condition, [bodyExpr]);

  if (isLast) {
    return whileExpr;
  }
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
  outerPack?: { joinVars: string[]; fallthroughCont: () => Expr },
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
  const preLoopStack = cloneScopeStack(ctx.scopeStack);
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
  joinCapabilityStates(fnCtx.scopeStack, preLoopStack, ctx);

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

    if (outerPack) {
      // Outer packed context: emit dispatch with outer-packed return outcome
      const outerReturnFields: Record<string, Expr> = {
        __tag: "return" as unknown as Expr,
        __value: Get(resultRef, "__value") as Expr,
      };
      for (const v of outerPack.joinVars) {
        outerReturnFields[v] = Ref(resolveRef(v, ctx));
      }
      const outerReturnExpr = Construct(outerReturnFields) as Expr;
      const fallthroughCont: Expr = needsRebind
        ? buildRebindChain(outerPack.fallthroughCont())
        : outerPack.fallthroughCont();
      return Let(
        loopName,
        loopFn,
        Let(
          resultName,
          callExpr,
          If(
            Eq(Get(resultRef, "__tag") as Expr, "return" as unknown as Expr) as Expr,
            outerReturnExpr,
            fallthroughCont,
          ),
        ),
      );
    }

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
  if (ts.isReturnStatement(stmt)) {
    return true;
  }
  if (ts.isBlock(stmt)) {
    return stmt.statements.some((s) => bodyContainsReturn(s));
  }
  if (ts.isIfStatement(stmt)) {
    if (bodyContainsReturn(stmt.thenStatement)) {
      return true;
    }
    if (stmt.elseStatement && bodyContainsReturn(stmt.elseStatement)) {
      return true;
    }
    return false;
  }
  return false;
}

// ── Stream iteration: for (const x of yield* each(expr)) { ... } ──

/**
 * Detect loop-carried let variables for a ForOfStatement body.
 * Same logic as detectLoopCarriedLetVars but for ForOfStatement.
 */
function detectForOfCarriedLetVars(stmt: ts.ForOfStatement, ctx: EmitContext): string[] {
  const assigned = new Set<string>();
  collectAssignedIdents(stmt.statement, assigned);
  return Array.from(assigned).filter((name) => {
    const found = lookupBinding(name, ctx);
    return found !== undefined && found.info.kind === "let";
  });
}

/**
 * Validate the constrained for...of form and extract components.
 * Returns { bindingName, sourceExpr } or throws a CompileError.
 */
function validateForOfEach(
  stmt: ts.ForOfStatement,
  ctx: EmitContext,
): { bindingName: string; sourceExpr: ts.Expression } {
  // 1. Nesting check
  if (ctx.inStreamLoop) {
    throw error(
      "E-STREAM-006",
      "Nested for...of stream iteration is not supported in this version",
      stmt,
      ctx,
    );
  }

  // 2. Must be a variable declaration list with `const`
  const init = stmt.initializer;
  if (!ts.isVariableDeclarationList(init)) {
    throw error(
      "E-STREAM-001",
      "for...of stream iteration requires 'const', not 'let' or 'var'",
      stmt,
      ctx,
    );
  }
  if (!(init.flags & ts.NodeFlags.Const)) {
    throw error(
      "E-STREAM-001",
      "for...of stream iteration requires 'const', not 'let' or 'var'",
      stmt,
      ctx,
    );
  }

  // 3. Single non-destructured identifier binding
  if (init.declarations.length !== 1) {
    throw error(
      "E-STREAM-002",
      "Destructuring in for...of stream iteration is not supported",
      stmt,
      ctx,
    );
  }
  const decl = init.declarations[0]!;
  if (!ts.isIdentifier(decl.name)) {
    throw error(
      "E-STREAM-002",
      "Destructuring in for...of stream iteration is not supported",
      decl.name,
      ctx,
    );
  }
  const bindingName = decl.name.text;

  // 4. __ prefix check
  if (bindingName.startsWith("__")) {
    throw error("E028", "Variable names must not start with '__'", decl.name, ctx);
  }

  // 5. Expression must be `yield* each(expr)`
  const expr = stmt.expression;

  // Check for `each(expr)` without yield* → E-STREAM-003
  if (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "each"
  ) {
    throw error(
      "E-STREAM-003",
      "for...of with each() requires 'yield*': use 'yield* each(expr)'",
      expr,
      ctx,
    );
  }

  // Must be yield* <something>
  if (!ts.isYieldExpression(expr) || !expr.asteriskToken || !expr.expression) {
    throw error("E013", "for...in/for...of is not allowed", stmt, ctx);
  }

  const yieldTarget = expr.expression;

  // The yield* target must be each(...)
  if (
    !ts.isCallExpression(yieldTarget) ||
    !ts.isIdentifier(yieldTarget.expression) ||
    yieldTarget.expression.text !== "each"
  ) {
    throw error("E013", "for...in/for...of is not allowed", stmt, ctx);
  }

  // each() must have exactly 1 argument
  if (yieldTarget.arguments.length !== 1) {
    throw error("E-STREAM-004", "each() requires exactly one argument", yieldTarget, ctx);
  }

  const sourceExpr = yieldTarget.arguments[0]!;

  // 6. Body must not contain break/continue
  if (bodyContainsBreakOrContinue(stmt.statement)) {
    throw error("E020", "break/continue is not allowed", stmt.statement, ctx);
  }

  return { bindingName, sourceExpr };
}

/** Check if a statement body contains break or continue (not descending into nested functions). */
function bodyContainsBreakOrContinue(node: ts.Node): boolean {
  if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
    return true;
  }
  // Do not descend into function expressions / arrow functions / generators
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isFunctionDeclaration(node)) {
    return false;
  }
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && bodyContainsBreakOrContinue(child)) {
      found = true;
    }
  });
  return found;
}

/**
 * Emit for (const x of yield* each(expr)) { ... }
 *
 * Lowers to recursive Fn + Call with stream.subscribe / stream.next.
 * Handles loop-carried let state and early return packing.
 */
function emitForOfEach(
  stmt: ts.ForOfStatement,
  rest: () => Expr,
  isLast: boolean,
  ctx: EmitContext,
): Expr {
  const { bindingName, sourceExpr } = validateForOfEach(stmt, ctx);
  const compiledSource = emitExpression(sourceExpr, ctx);

  const hasReturn = bodyContainsReturn(stmt.statement);
  const loopCarriedVars = detectForOfCarriedLetVars(stmt, ctx);

  if (hasReturn || loopCarriedVars.length > 0) {
    return emitForOfEachCaseB(
      stmt,
      compiledSource,
      bindingName,
      rest,
      isLast,
      ctx,
      loopCarriedVars,
      hasReturn,
    );
  }

  // Case A: No return, no loop-carried state — simple recursive loop
  return emitForOfEachCaseA(stmt, compiledSource, bindingName, rest, isLast, ctx);
}

/** Case A: Simple stream iteration — no return, no loop-carried state. */
function emitForOfEachCaseA(
  stmt: ts.ForOfStatement,
  compiledSource: Expr,
  bindingName: string,
  rest: () => Expr,
  isLast: boolean,
  ctx: EmitContext,
): Expr {
  const subName = ctx.counter.next("sub");
  const loopName = ctx.counter.next("loop");
  const itemName = ctx.counter.next("item");

  // Compile body with inStreamLoop flag set
  const bodyStmts = getBodyStatements(stmt.statement);
  const preLoopStack = cloneScopeStack(ctx.scopeStack);
  const bodyCtx: EmitContext = {
    ...ctx,
    scopeStack: cloneScopeStack(ctx.scopeStack),
    inStreamLoop: true,
  };
  pushFrame(bodyCtx);
  declareBinding(bindingName, "const", bodyCtx);
  const compiledBody = emitStatementList(bodyStmts, 0, bodyCtx);
  popFrame(bodyCtx);
  joinCapabilityStates(bodyCtx.scopeStack, preLoopStack, ctx);

  const discardName = ctx.counter.next("discard");

  // Build the Fn body:
  //   Let(__item, stream.next([Ref(__sub)]),
  //     If(Get(__item, "done"), null,
  //       Let(binding, Get(__item, "value"),
  //         Let(__discard, body, Call(__loop, [])))))
  const loopFnBody = Let(
    itemName,
    ExternalEval("stream.next", [Ref(subName)] as unknown as Expr),
    If(
      Get(Ref(itemName), "done") as Expr,
      null as unknown as Expr,
      Let(
        bindingName,
        Get(Ref(itemName), "value") as Expr,
        Let(discardName, compiledBody, Call(Ref(loopName), [])),
      ),
    ),
  );

  const loopFn = Fn([], loopFnBody);

  // Call site
  const callExpr = Call(Ref(loopName), []);
  let callSiteExpr: Expr;
  if (isLast) {
    callSiteExpr = callExpr;
  } else {
    callSiteExpr = Let(ctx.counter.next("discard"), callExpr, rest());
  }

  return Let(
    subName,
    ExternalEval("stream.subscribe", [compiledSource] as unknown as Expr),
    Let(loopName, loopFn, callSiteExpr),
  );
}

/**
 * Case B: Stream iteration with return and/or loop-carried state.
 * Mirrors emitWhileCaseB — the Fn takes params for carried vars,
 * the done branch returns carried values, and the call site dispatches.
 */
function emitForOfEachCaseB(
  stmt: ts.ForOfStatement,
  compiledSource: Expr,
  bindingName: string,
  rest: () => Expr,
  isLast: boolean,
  ctx: EmitContext,
  loopCarriedVars: string[],
  hasReturn: boolean,
  outerPack?: { joinVars: string[]; fallthroughCont: () => Expr },
): Expr {
  const subName = ctx.counter.next("sub");
  const loopName = ctx.counter.next("loop");
  const itemName = ctx.counter.next("item");

  // Loop-carried var params: current versioned names become Fn param names
  const loopCarriedParams = loopCarriedVars.map((v) => resolveRef(v, ctx));
  const initArgs: Expr[] = loopCarriedParams.map((pn) => Ref(pn) as Expr);

  const needsRebind = loopCarriedVars.length > 0;
  const needsPack = hasReturn && (!isLast || needsRebind);

  // Build the Fn body
  const bodyStmts = getBodyStatements(stmt.statement);
  const preLoopStack = cloneScopeStack(ctx.scopeStack);
  const fnCtx: EmitContext = {
    ...ctx,
    scopeStack: cloneScopeStack(ctx.scopeStack),
    inStreamLoop: true,
  };
  pushFrame(fnCtx);
  declareBinding(bindingName, "const", fnCtx);

  // Build recursive call args (will use bumped versions after body compilation)
  let compiledBody: Expr;
  if (needsPack) {
    // Compile body statements with terminal-packed for early return packing
    const joinVars = loopCarriedVars;
    compiledBody = emitForOfLoopBodyPacked(bodyStmts, loopName, loopCarriedVars, fnCtx, joinVars);
  } else {
    compiledBody = emitForOfLoopBody(bodyStmts, loopName, loopCarriedVars, fnCtx);
  }

  popFrame(fnCtx);
  joinCapabilityStates(fnCtx.scopeStack, preLoopStack, ctx);

  // Done branch: return carried values (or null if no carried state)
  let doneBranch: Expr;
  if (needsPack || needsRebind) {
    const fields: Record<string, Expr> = {};
    if (needsPack) {
      fields.__tag = "exit" as unknown as Expr;
    }
    fields.__value = null as unknown as Expr;
    if (needsRebind) {
      loopCarriedVars.forEach((v, i) => {
        fields[v] = Ref(loopCarriedParams[i]!) as Expr;
      });
    }
    doneBranch = Construct(fields as any) as Expr;
  } else {
    doneBranch = null as unknown as Expr;
  }

  const loopFnBody = Let(
    itemName,
    ExternalEval("stream.next", [Ref(subName)] as unknown as Expr),
    If(
      Get(Ref(itemName), "done") as Expr,
      doneBranch,
      Let(bindingName, Get(Ref(itemName), "value") as Expr, compiledBody),
    ),
  );

  const loopFn = Fn(loopCarriedParams, loopFnBody);
  const callExpr = Call(Ref(loopName), initArgs);

  if (needsPack || needsRebind) {
    const resultName = ctx.counter.next("loop_result");
    const resultRef = Ref(resultName);

    // Bump each carried var in outer ctx BEFORE building rest()
    const newIrNames = needsRebind ? loopCarriedVars.map((v) => bumpVersion(v, ctx)) : [];

    const buildRebindChain = (cont: Expr): Expr => {
      let chain = cont;
      for (let i = loopCarriedVars.length - 1; i >= 0; i--) {
        chain = Let(newIrNames[i]!, Get(resultRef, loopCarriedVars[i]!) as Expr, chain);
      }
      return chain;
    };

    if (outerPack) {
      const outerReturnFields: Record<string, Expr> = {
        __tag: "return" as unknown as Expr,
        __value: Get(resultRef, "__value") as Expr,
      };
      for (const v of outerPack.joinVars) {
        outerReturnFields[v] = Ref(resolveRef(v, ctx));
      }
      const outerReturnExpr = Construct(outerReturnFields) as Expr;
      const fallthroughCont: Expr = needsRebind
        ? buildRebindChain(outerPack.fallthroughCont())
        : outerPack.fallthroughCont();
      return Let(
        subName,
        ExternalEval("stream.subscribe", [compiledSource] as unknown as Expr),
        Let(
          loopName,
          loopFn,
          Let(
            resultName,
            callExpr,
            If(
              Eq(Get(resultRef, "__tag") as Expr, "return" as unknown as Expr) as Expr,
              outerReturnExpr,
              fallthroughCont,
            ),
          ),
        ),
      );
    }

    if (isLast) {
      return Let(
        subName,
        ExternalEval("stream.subscribe", [compiledSource] as unknown as Expr),
        Let(loopName, loopFn, Let(resultName, callExpr, Get(resultRef, "__value") as Expr)),
      );
    }

    if (needsPack) {
      const continuation: Expr = needsRebind ? buildRebindChain(rest()) : rest();
      return Let(
        subName,
        ExternalEval("stream.subscribe", [compiledSource] as unknown as Expr),
        Let(
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
        ),
      );
    }

    // !needsPack && needsRebind && !isLast
    return Let(
      subName,
      ExternalEval("stream.subscribe", [compiledSource] as unknown as Expr),
      Let(loopName, loopFn, Let(resultName, callExpr, buildRebindChain(rest()))),
    );
  }

  // Simple case: no pack, no rebind
  if (isLast) {
    return Let(
      subName,
      ExternalEval("stream.subscribe", [compiledSource] as unknown as Expr),
      Let(loopName, loopFn, callExpr),
    );
  }
  return Let(
    subName,
    ExternalEval("stream.subscribe", [compiledSource] as unknown as Expr),
    Let(loopName, loopFn, Let(ctx.counter.next("discard"), callExpr, rest())),
  );
}

/** Emit body statements for Case B stream loop (no packing). Terminal is recursive Call. */
function emitForOfLoopBody(
  stmts: ts.Statement[],
  loopName: string,
  loopCarriedVars: string[],
  ctx: EmitContext,
): Expr {
  // Build the body using emitStatementListWithTerminal where terminal = recursive call
  const recursiveCall = () => {
    const args = loopCarriedVars.map((v) => Ref(resolveRef(v, ctx)) as Expr);
    return Call(Ref(loopName), args);
  };
  return emitStatementListWithTerminal(stmts, 0, ctx, recursiveCall);
}

/** Emit body statements for Case B stream loop with return packing. */
function emitForOfLoopBodyPacked(
  stmts: ts.Statement[],
  loopName: string,
  loopCarriedVars: string[],
  ctx: EmitContext,
  joinVars: string[],
): Expr {
  const recursiveCall = () => {
    const args = loopCarriedVars.map((v) => Ref(resolveRef(v, ctx)) as Expr);
    return Call(Ref(loopName), args);
  };
  return emitStatementListWithTerminalPacked(stmts, 0, ctx, joinVars, recursiveCall);
}

/**
 * Emit for...of each in a packed branch context (inside while-with-return or similar).
 * Delegates to emitForOfEachCaseB with outer packing info.
 */
function emitForOfEachPacked(
  stmt: ts.ForOfStatement,
  stmts: ts.Statement[],
  index: number,
  ctx: EmitContext,
  outerJoinVars: string[],
  terminal: () => Expr,
): Expr {
  const { bindingName, sourceExpr } = validateForOfEach(stmt, ctx);
  const compiledSource = emitExpression(sourceExpr, ctx);

  const rest = () =>
    emitStatementListWithTerminalPacked(stmts, index + 1, ctx, outerJoinVars, terminal);
  const isLast = index === stmts.length - 1;
  const hasReturn = bodyContainsReturn(stmt.statement);
  const loopCarriedVars = detectForOfCarriedLetVars(stmt, ctx);

  if (!hasReturn && loopCarriedVars.length === 0) {
    // Case A in packed context: simple loop then packed continuation
    const loopExpr = emitForOfEachCaseA(
      stmt,
      compiledSource,
      bindingName,
      () => null as unknown as Expr,
      true,
      ctx,
    );
    const loopDiscard = ctx.counter.next("discard");
    return Let(loopDiscard, loopExpr, isLast ? terminal() : rest());
  }

  const outerPackCont = isLast ? terminal : rest;
  return emitForOfEachCaseB(
    stmt,
    compiledSource,
    bindingName,
    rest,
    false,
    ctx,
    loopCarriedVars,
    hasReturn,
    { joinVars: outerJoinVars, fallthroughCont: outerPackCont },
  );
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
  // yield* <identifier> — check for spawn handle join
  if (ts.isIdentifier(target)) {
    assertCapabilityCaptureAllowed(target.text, target, ctx);
    if (isJoinableSpawnHandle(target.text, ctx)) {
      const found = lookupBinding(target.text, ctx)!;
      const cap = found.info.capability!;
      if (cap.state === "completed") {
        throw error(
          "CV-E3",
          `Capability value '${target.text}' has already been completed`,
          target,
          ctx,
        );
      }
      if (cap.state === "indeterminate") {
        throw error(
          "CV-E4",
          `Capability value '${target.text}' is in indeterminate state`,
          target,
          ctx,
        );
      }
      cap.state = "completed";
      return JoinEval(Ref(resolveRef(target.text, ctx)));
    }
  }

  // Case 1: yield* all([...]) or yield* race([...])
  if (ts.isCallExpression(target)) {
    const callee = target.expression;
    if (ts.isIdentifier(callee)) {
      // yield* scoped(function* () { ... })
      if (callee.text === "scoped") {
        return emitScoped(target, ctx);
      }

      // yield* spawn(function* () { ... })
      if (callee.text === "spawn") {
        return emitSpawn(target, ctx);
      }

      // yield* resource(function* () { ... })
      if (callee.text === "resource") {
        if (ctx.inResourceBody) {
          throw error(
            "RS7",
            "resource() cannot be nested inside another resource body (deferred to future specification)",
            target,
            ctx,
          );
        }
        return emitResource(target, ctx);
      }

      // yield* provide(expr)
      if (callee.text === "provide") {
        return emitProvide(target, ctx);
      }

      if (callee.text === "all" || callee.text === "race") {
        return emitConcurrency(callee.text, target, ctx);
      }

      if (callee.text === "sleep") {
        // Built-in: yield* sleep(ms)
        const args = target.arguments.map((a) => emitExpression(a, ctx));
        return ExternalEval("sleep", args as unknown as Expr);
      }

      if (callee.text === "useConfig") {
        throw error("UC3", "useConfig() must be called as Config.useConfig(Token)", target, ctx);
      }

      // yield* timebox(duration, function* () { ... })
      if (callee.text === "timebox") {
        return emitTimebox(target, ctx);
      }

      // yield* converge({ probe, until, timeout, interval? })
      if (callee.text === "converge") {
        return emitConverge(target, ctx);
      }

      // yield* each(...) outside for...of → E-STREAM-004
      if (callee.text === "each") {
        throw error(
          "E-STREAM-004",
          "each() can only be used as the iterable in 'for (const x of yield* each(expr))'",
          target,
          ctx,
        );
      }

      // Sub-workflow: yield* fn(args)
      const args = target.arguments.map((a) => emitExpression(a, ctx));
      return Call(Ref(callee.text), args);
    }

    // yield* Config.useConfig(Token) → ExternalEval("__config", Q(null))
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "Config" &&
      callee.name.text === "useConfig"
    ) {
      if (target.arguments.length !== 1) {
        throw error(
          "UC1",
          "Config.useConfig() requires exactly one ConfigToken argument",
          target,
          ctx,
        );
      }
      const tokenArg = target.arguments[0]!;
      if (!ts.isIdentifier(tokenArg)) {
        throw error(
          "UC2",
          "Config.useConfig() argument must be a ConfigToken identifier",
          target,
          ctx,
        );
      }
      // Token is erased — same runtime effect regardless of token identity
      return ExternalEval("__config", Q(null));
    }

    // yield* each.next(...) → E-STREAM-005
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "each" &&
      callee.name.text === "next"
    ) {
      throw error(
        "E-STREAM-005",
        "each.next() is not part of the Tisyn authored language",
        target,
        ctx,
      );
    }

    // Case 2: yield* handle.method(args) — handle method call inside scoped body
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      ctx.handleBindings?.has(callee.expression.text)
    ) {
      return emitHandleCall(callee, target.arguments, ctx);
    }

    // Case 3: yield* Agent().method(args) — agent effect
    if (ts.isPropertyAccessExpression(callee)) {
      return emitAgentEffect(callee, target.arguments, ctx);
    }
  }

  throw error(
    "E010",
    "yield* target must be an agent call, all/race, resource/provide, sleep, timebox, converge, Config.useConfig, or sub-workflow",
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
      if (ctx.strictContracts) {
        throw error("E999", `Unknown contract: '${agentFactory.text}'`, agentFactory, ctx);
      }
      // Lenient mode (compile/compileOne): fall through to legacy positional-array path
    } else {
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

      const effectId = `${agentId}.${methodName}`;
      if (method.params.length === 1) {
        return ExternalEval(effectId, emitExpression(args[0]!, ctx));
      }
      const fields: Record<string, Expr> = {};
      for (let i = 0; i < method.params.length; i++) {
        fields[method.params[i]!.name] = emitExpression(args[i]!, ctx);
      }
      return ExternalEval(effectId, Construct(fields));
    } // end else (contract found)
  } // end if (ctx.contracts)

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

// ── Spawn ──

/**
 * Compile `yield* spawn(function* () { ... })` → SpawnEval(bodyExpr).
 *
 * The spawned body compiles with:
 * - preserved scopeStack with parent spawn handles downgraded (SP11)
 * - preserved scopedContracts (SP11(C): inherited contract availability)
 * - cleared handleBindings (SP11(B): parent useAgent handles NOT inherited)
 */
function emitSpawn(callExpr: ts.CallExpression, ctx: EmitContext): Expr {
  const arg = callExpr.arguments[0];
  if (!arg || !ts.isFunctionExpression(arg) || !arg.asteriskToken) {
    throw error("SP1", "spawn() requires a single generator function argument", callExpr, ctx);
  }
  if (callExpr.arguments.length > 1) {
    throw error("SP1", "spawn() takes exactly one argument", callExpr, ctx);
  }

  const bodyCtx: EmitContext = {
    ...ctx,
    scopeStack: cloneScopeStackForSpawnBody(ctx.scopeStack),
    handleBindings: undefined,
  };
  const bodyExpr = emitBlock(Array.from(arg.body.statements), bodyCtx);

  return SpawnEval(bodyExpr);
}

// ── Resource ──

/**
 * Compile `yield* resource(function* () { ... })` → ResourceEval(bodyExpr).
 *
 * Resource bodies compile with:
 * - preserved scopeStack with parent spawn handles downgraded (like spawn)
 * - cleared handleBindings (like spawn)
 * - inResourceBody = true (enables provide recognition, blocks nested resource)
 *
 * Validates provide placement per spec §3.2 (P1–P7).
 */
function emitResource(callExpr: ts.CallExpression, ctx: EmitContext): Expr {
  const arg = callExpr.arguments[0];
  if (!arg || !ts.isFunctionExpression(arg) || !arg.asteriskToken) {
    throw error("RS1", "resource() requires a single generator function argument", callExpr, ctx);
  }
  if (callExpr.arguments.length > 1) {
    throw error("RS1", "resource() takes exactly one argument", callExpr, ctx);
  }

  // Validate provide placement in the source AST before compilation
  validateProvideInResourceBody(arg.body, ctx);

  const bodyCtx: EmitContext = {
    ...ctx,
    scopeStack: cloneScopeStackForSpawnBody(ctx.scopeStack),
    handleBindings: undefined,
    inResourceBody: true,
  };
  const bodyExpr = emitBlock(Array.from(arg.body.statements), bodyCtx);

  return ResourceEval(bodyExpr);
}

// ── Timebox ──

function emitTimebox(callExpr: ts.CallExpression, ctx: EmitContext): Expr {
  if (callExpr.arguments.length !== 2) {
    throw error(
      "E-TB-01",
      "timebox() requires exactly 2 arguments: duration and generator function",
      callExpr,
      ctx,
    );
  }

  const [durationArg, bodyArg] = callExpr.arguments;

  if (!bodyArg || !ts.isFunctionExpression(bodyArg) || !bodyArg.asteriskToken) {
    throw error(
      "E-TB-02",
      "timebox() second argument must be a generator function expression",
      callExpr,
      ctx,
    );
  }

  const durationExpr = emitExpression(durationArg!, ctx);

  const bodyCtx: EmitContext = {
    ...ctx,
    scopeStack: cloneScopeStackForSpawnBody(ctx.scopeStack),
    handleBindings: undefined,
  };
  const bodyExpr = emitBlock(Array.from(bodyArg.body.statements), bodyCtx);

  return TimeboxEval(durationExpr, bodyExpr);
}

// ── Converge ──

function emitConverge(callExpr: ts.CallExpression, ctx: EmitContext): Expr {
  if (callExpr.arguments.length !== 1) {
    throw error("E-CONV-07", "converge() argument must be an object literal", callExpr, ctx);
  }

  const arg = callExpr.arguments[0]!;
  if (!ts.isObjectLiteralExpression(arg)) {
    throw error("E-CONV-07", "converge() argument must be an object literal", arg, ctx);
  }

  // Extract properties
  let probeProp: ts.ObjectLiteralElementLike | undefined;
  let untilProp: ts.ObjectLiteralElementLike | undefined;
  let timeoutProp: ts.ObjectLiteralElementLike | undefined;
  let intervalProp: ts.ObjectLiteralElementLike | undefined;

  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      continue;
    }
    switch (prop.name.text) {
      case "probe":
        probeProp = prop;
        break;
      case "until":
        untilProp = prop;
        break;
      case "timeout":
        timeoutProp = prop;
        break;
      case "interval":
        intervalProp = prop;
        break;
    }
  }

  // Validate required properties
  if (!timeoutProp || !ts.isPropertyAssignment(timeoutProp)) {
    throw error("E-CONV-06", "converge() requires a timeout property", arg, ctx);
  }
  if (!intervalProp || !ts.isPropertyAssignment(intervalProp)) {
    throw error("E-CONV-05", "converge() requires an interval property", arg, ctx);
  }
  if (!probeProp || !ts.isPropertyAssignment(probeProp)) {
    throw error("E-CONV-01", "converge() probe must be a generator function expression", arg, ctx);
  }
  if (!untilProp || !ts.isPropertyAssignment(untilProp)) {
    throw error("E-CONV-02", "converge() until must be an arrow function", arg, ctx);
  }

  // Validate probe: must be generator function*
  const probeExpr = (probeProp as ts.PropertyAssignment).initializer;
  if (!ts.isFunctionExpression(probeExpr) || !probeExpr.asteriskToken) {
    throw error(
      "E-CONV-01",
      "converge() probe must be a generator function expression",
      probeExpr,
      ctx,
    );
  }

  // Validate until: must be arrow with expression body and exactly one identifier parameter
  const untilExpr = (untilProp as ts.PropertyAssignment).initializer;
  if (!ts.isArrowFunction(untilExpr)) {
    throw error("E-CONV-02", "converge() until must be an arrow function", untilExpr, ctx);
  }
  if (untilExpr.parameters.length !== 1) {
    throw error("E-CONV-02", "converge() until must accept exactly one parameter", untilExpr, ctx);
  }
  if (!ts.isIdentifier(untilExpr.parameters[0]!.name)) {
    throw error(
      "E-CONV-02",
      "converge() until parameter must be a simple identifier",
      untilExpr.parameters[0]!,
      ctx,
    );
  }
  if (ts.isBlock(untilExpr.body)) {
    throw error(
      "E-CONV-03",
      "converge() until must have an expression body (not a block body)",
      untilExpr,
      ctx,
    );
  }

  // Scan for yield* in restricted positions
  if (containsYieldStar(untilExpr.body)) {
    throw error("E-CONV-04", "converge() until must not contain yield*", untilExpr.body, ctx);
  }

  const timeoutInitializer = (timeoutProp as ts.PropertyAssignment).initializer;
  if (containsYieldStar(timeoutInitializer)) {
    throw error("E-CONV-09", "converge() timeout must not contain yield*", timeoutInitializer, ctx);
  }

  const intervalInitializer = (intervalProp as ts.PropertyAssignment).initializer;
  if (containsYieldStar(intervalInitializer)) {
    throw error(
      "E-CONV-08",
      "converge() interval must not contain yield*",
      intervalInitializer,
      ctx,
    );
  }

  // W-CONV-01: effectless probe should emit a warning, but the compiler
  // currently has no warning channel. Deferred until a warning infrastructure
  // is added. See converge amendment §5.1/AC1.

  // Compile timeout and interval as expressions in the outer context
  const timeoutExprIr = emitExpression(timeoutInitializer, ctx);
  const intervalExprIr = emitExpression(intervalInitializer, ctx);

  // Build child contexts for compilation
  const timeboxBodyCtx: EmitContext = {
    ...ctx,
    scopeStack: cloneScopeStackForSpawnBody(ctx.scopeStack),
    handleBindings: undefined,
  };

  // Get the until parameter name
  const untilParam = untilExpr.parameters[0];
  const untilParamName =
    untilParam && ts.isIdentifier(untilParam.name) ? untilParam.name.text : "x";

  // Compile until body with its own scope frame containing the parameter
  const untilCtx: EmitContext = {
    ...timeboxBodyCtx,
    scopeStack: cloneScopeStack(timeboxBodyCtx.scopeStack),
  };
  pushFrame(untilCtx);
  declareBinding(untilParamName, "const", untilCtx);
  const untilBodyIr = emitExpression(untilExpr.body as ts.Expression, untilCtx);
  popFrame(untilCtx);

  // Compile probe body with timebox body context
  const probeCtx: EmitContext = {
    ...timeboxBodyCtx,
    scopeStack: cloneScopeStack(timeboxBodyCtx.scopeStack),
  };
  const probeBodyIr = emitBlock(Array.from(probeExpr.body.statements), probeCtx);

  // Generate synthetic names
  const untilName = ctx.counter.next("until");
  const pollName = ctx.counter.next("poll");
  const probeName = ctx.counter.next("probe");
  const discardName = ctx.counter.next("discard");

  // Build lowered IR:
  // TimeboxEval(timeout,
  //   Let(__until, Fn([param], untilBody),
  //     Let(__poll, Fn([],
  //       Let(__probe, probeBody,
  //         If(Call(Ref(__until), [Ref(__probe)]),
  //           Ref(__probe),
  //           Let(__discard, ExternalEval("sleep", [interval]),
  //             Call(Ref(__poll), []))))),
  //       Call(Ref(__poll), []))))
  return TimeboxEval(
    timeoutExprIr,
    Let(
      untilName,
      Fn([untilParamName], untilBodyIr),
      Let(
        pollName,
        Fn(
          [],
          Let(
            probeName,
            probeBodyIr,
            If(
              Call(Ref(untilName), [Ref(probeName)]),
              Ref(probeName),
              Let(
                discardName,
                ExternalEval("sleep", [intervalExprIr] as unknown as Expr),
                Call(Ref(pollName), []),
              ),
            ),
          ),
        ),
        Call(Ref(pollName), []),
      ),
    ),
  );
}

/**
 * Validate that provide appears exactly once in a valid position within a resource body.
 *
 * Valid positions (P4):
 *   (a) Final yield* statement in the resource body
 *   (b) Body of a try block at the resource body's top level
 *
 * Invalid positions (P5): inside if, while, scoped, spawn, all, race, nested generator
 * Post-provide (P6): no code after provide at same level (except finally in try form)
 */
function validateProvideInResourceBody(body: ts.Block, ctx: EmitContext): void {
  const stmts = body.statements;
  let provideFound = false;

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i]!;

    // Check if this statement is `yield* provide(expr)`
    if (isProvideStatement(stmt)) {
      if (provideFound) {
        throw error("P3", "Multiple provide calls in resource body", stmt, ctx);
      }
      provideFound = true;
      // P6: no code after provide at same level
      if (i < stmts.length - 1) {
        throw error(
          "P6",
          "No code may follow provide at the same nesting level",
          stmts[i + 1]!,
          ctx,
        );
      }
      continue;
    }

    // Check if this statement is a try block containing provide in its body
    if (ts.isTryStatement(stmt)) {
      const tryProvide = findProvideInTryBody(stmt.tryBlock);
      if (tryProvide) {
        if (provideFound) {
          throw error("P3", "Multiple provide calls in resource body", tryProvide, ctx);
        }
        provideFound = true;
        // P4b: provide must be in the try body, the try must be at top level
        // P6: no code after the try at same level (except it IS the try, so
        // only code after the entire try statement matters)
        if (i < stmts.length - 1) {
          throw error(
            "P6",
            "No code may follow the try/provide block at the same nesting level",
            stmts[i + 1]!,
            ctx,
          );
        }
        // Verify provide is the last statement in the try body
        validateProvideLastInTryBody(stmt.tryBlock, ctx);
        continue;
      }
    }

    // Scan for provide in invalid positions (P5)
    checkForProvideInInvalidPosition(stmt, ctx);
  }

  if (!provideFound) {
    throw error("RS4", "resource body must contain exactly one provide call", body, ctx);
  }
}

/** Check if a statement is `yield* provide(expr)` */
function isProvideStatement(stmt: ts.Statement): boolean {
  if (!ts.isExpressionStatement(stmt)) {
    return false;
  }
  const expr = stmt.expression;
  if (!ts.isYieldExpression(expr) || !expr.asteriskToken || !expr.expression) {
    return false;
  }
  if (!ts.isCallExpression(expr.expression)) {
    return false;
  }
  const callee = expr.expression.expression;
  return ts.isIdentifier(callee) && callee.text === "provide";
}

/** Find a provide statement in a try body's statements (first level only) */
function findProvideInTryBody(block: ts.Block): ts.Statement | null {
  for (const stmt of block.statements) {
    if (isProvideStatement(stmt)) {
      return stmt;
    }
  }
  return null;
}

/** Verify provide is the last statement in the try body */
function validateProvideLastInTryBody(block: ts.Block, ctx: EmitContext): void {
  const stmts = block.statements;
  for (let i = 0; i < stmts.length; i++) {
    if (isProvideStatement(stmts[i]!)) {
      if (i < stmts.length - 1) {
        throw error("P6", "No code may follow provide inside the try body", stmts[i + 1]!, ctx);
      }
    }
  }
}

/** Recursively check for provide in positions where it's forbidden (P5) */
function checkForProvideInInvalidPosition(node: ts.Node, ctx: EmitContext): void {
  if (isProvideStatement(node as ts.Statement)) {
    throw error(
      "P5",
      "provide must not appear inside control flow, scoped, spawn, or nested generators",
      node,
      ctx,
    );
  }
  // Don't recurse into generator functions — they are opaque boundaries
  if (ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
    return;
  }
  // For try statements, don't flag provide found at top level (already handled by caller)
  // But DO check catch/finally for stray provides
  if (ts.isTryStatement(node)) {
    // Only check catch and finally clauses for invalid provide
    if (node.catchClause) {
      ts.forEachChild(node.catchClause, (child) => checkForProvideInInvalidPosition(child, ctx));
    }
    // Don't check try body here — it's checked by the caller
    // Don't check finally — provide in finally is invalid and caught by P5
    if (node.finallyBlock) {
      for (const stmt of node.finallyBlock.statements) {
        checkForProvideInInvalidPosition(stmt, ctx);
      }
    }
    return;
  }
  ts.forEachChild(node, (child) => checkForProvideInInvalidPosition(child, ctx));
}

/**
 * Compile `yield* provide(expr)` → ProvideEval(compiledExpr).
 *
 * Only valid inside a resource body (P2).
 */
function emitProvide(callExpr: ts.CallExpression, ctx: EmitContext): Expr {
  if (!ctx.inResourceBody) {
    throw error("P2", "provide() is only valid inside a resource body", callExpr, ctx);
  }
  if (callExpr.arguments.length !== 1) {
    throw error("P1", "provide() requires exactly one argument", callExpr, ctx);
  }
  const valueExpr = emitExpression(callExpr.arguments[0]!, ctx);
  return ProvideEval(valueExpr);
}

// ── Handle method call (inside scoped body) ──

/**
 * Lower `yield* handle.method(args)` → ExternalEval(`${prefix}.${method}`, payload).
 * Single-arg methods pass the bare argument expression as the payload.
 * Multi-arg methods build a Construct keyed by the authored parameter names.
 * Only called when `handle` is known to be a useAgent binding.
 */
function emitHandleCall(
  callee: ts.PropertyAccessExpression,
  args: ts.NodeArray<ts.Expression>,
  ctx: EmitContext,
): Expr {
  const receiverName = (callee.expression as ts.Identifier).text;
  const methodName = callee.name.text;
  const prefix = ctx.handleBindings!.get(receiverName)!;
  const contract = ctx.scopedContracts!.get(prefix)!;
  const method = contract.methods.find((m) => m.name === methodName);
  if (!method) {
    throw error("H4", `Unknown method '${methodName}' on handle '${receiverName}'`, callee, ctx);
  }
  if (args.length !== method.params.length) {
    throw error(
      "H4",
      `'${methodName}' expects ${method.params.length} arg(s), got ${args.length}`,
      callee,
      ctx,
    );
  }
  if (method.params.length === 1) {
    return ExternalEval(`${prefix}.${methodName}`, emitExpression(args[0]!, ctx));
  }
  const fields: Record<string, Expr> = {};
  for (let i = 0; i < method.params.length; i++) {
    fields[method.params[i]!.name] = emitExpression(args[i]!, ctx);
  }
  return ExternalEval(`${prefix}.${methodName}`, Construct(fields));
}

// ── scoped() compilation ──

/**
 * Compile `yield* scoped(function* () { ... })` → ScopeEval(handler, bindings, bodyExpr).
 *
 * The generator body is partitioned into:
 * - Setup: `yield* useTransport(Contract, factory)` and `yield* Effects.around({dispatch*...})`
 * - Body: all remaining statements
 */
function emitScoped(callExpr: ts.CallExpression, ctx: EmitContext): Expr {
  if (!ctx.contracts) {
    throw error(
      "S0",
      "scoped() can only be used in a workflow (contracts not available)",
      callExpr,
      ctx,
    );
  }

  const arg = callExpr.arguments[0];
  if (!arg || !ts.isFunctionExpression(arg) || !arg.asteriskToken) {
    throw error("S0", "scoped() requires a single generator function argument", callExpr, ctx);
  }

  const stmts = Array.from(arg.body.statements);

  // Partition statements into setup and body
  const bindings: Record<string, import("@tisyn/ir").TisynExpr> = {};
  const scopedContracts: Map<string, DiscoveredContract> = new Map();
  const seenContracts = new Set<string>();
  let sawEffectsAround = false;
  let handlerFn: import("@tisyn/ir").FnNode | null = null;
  let bodyStart = 0;

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i]!;
    const useTransportCall = tryExtractUseTransportCall(stmt);
    const effectsAroundCall = tryExtractEffectsAroundCall(stmt);

    if (useTransportCall) {
      if (bodyStart > 0) {
        throw error("S1", "useTransport() must precede body statements", stmt, ctx);
      }
      const [contractIdent, factoryExpr] = useTransportCall;
      const contractName = contractIdent.text;
      if (seenContracts.has(contractName)) {
        throw error("S5", `Duplicate useTransport for '${contractName}'`, stmt, ctx);
      }
      seenContracts.add(contractName);
      const contract = ctx.contracts.get(contractName);
      if (!contract) {
        throw error("UT1", `Unknown contract: '${contractName}'`, stmt, ctx);
      }
      const prefix = toAgentId(contractName);
      bindings[prefix] = emitExpression(factoryExpr, ctx);
      scopedContracts.set(prefix, contract);
      bodyStart = i + 1;
    } else if (effectsAroundCall) {
      if (bodyStart > 0) {
        throw error("S1", "Effects.around() must precede body statements", stmt, ctx);
      }
      if (sawEffectsAround) {
        throw error("S6", "Only one Effects.around() is allowed per scoped()", stmt, ctx);
      }
      sawEffectsAround = true;
      handlerFn = emitEffectsAround(effectsAroundCall, ctx);
      bodyStart = i + 1;
    } else {
      // First non-setup statement — remaining stmts are body
      bodyStart = i;
      break;
    }
    bodyStart = i + 1;
  }

  const bodyStmts = stmts.slice(bodyStart);

  // Compile body in scoped context (emitBlock handles push/pop frame)
  const bodyCtx: EmitContext = {
    ...ctx,
    handleBindings: new Map(),
    scopedContracts,
  };
  const bodyExpr = emitBlock(bodyStmts, bodyCtx);

  return ScopeEval(handlerFn, bindings, bodyExpr);
}

/** Extract (contractIdent, factoryIdent) from `yield* useTransport(Contract, factory)` stmt. */
function tryExtractUseTransportCall(stmt: ts.Statement): [ts.Identifier, ts.Expression] | null {
  if (!ts.isExpressionStatement(stmt)) {
    return null;
  }
  const expr = stmt.expression;
  if (!ts.isYieldExpression(expr) || !expr.asteriskToken || !expr.expression) {
    return null;
  }
  if (!ts.isCallExpression(expr.expression)) {
    return null;
  }
  const callee = expr.expression.expression;
  if (!ts.isIdentifier(callee) || callee.text !== "useTransport") {
    return null;
  }
  const args = expr.expression.arguments;
  if (args.length !== 2 || !args[0] || !args[1]) {
    return null;
  }
  if (!ts.isIdentifier(args[0])) {
    return null;
  }
  return [args[0], args[1]];
}

/** Extract the CallExpression from `yield* Effects.around({...})` stmt. */
function tryExtractEffectsAroundCall(stmt: ts.Statement): ts.CallExpression | null {
  if (!ts.isExpressionStatement(stmt)) {
    return null;
  }
  const expr = stmt.expression;
  if (!ts.isYieldExpression(expr) || !expr.asteriskToken || !expr.expression) {
    return null;
  }
  if (!ts.isCallExpression(expr.expression)) {
    return null;
  }
  const callee = expr.expression.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !ts.isIdentifier(callee.expression) ||
    callee.expression.text !== "Effects" ||
    callee.name.text !== "around"
  ) {
    return null;
  }
  return expr.expression;
}

// ── Effects.around handler compilation ──

/**
 * Compile `Effects.around({ *dispatch([id, data], next) { ... } })` → FnNode.
 *
 * The resulting FnNode has params [p1Name, p2Name] (from the array destructuring
 * of the first parameter) and body compiled by emitMiddlewareBody.
 */
function emitEffectsAround(
  callExpr: ts.CallExpression,
  ctx: EmitContext,
): import("@tisyn/ir").FnNode {
  const arg = callExpr.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    throw error("EA1", "Effects.around() requires an object literal argument", callExpr, ctx);
  }
  if (arg.properties.length !== 1) {
    throw error("EA1", "Effects.around() object must have exactly one property", arg, ctx);
  }
  const prop = arg.properties[0]!;
  if (
    !ts.isMethodDeclaration(prop) ||
    !prop.asteriskToken ||
    !ts.isIdentifier(prop.name) ||
    prop.name.text !== "dispatch"
  ) {
    throw error(
      "EA2",
      "Effects.around() property must be a generator method named 'dispatch'",
      prop,
      ctx,
    );
  }

  const params = prop.parameters;
  if (params.length < 2) {
    throw error("EA2", "dispatch must have at least 2 parameters", prop, ctx);
  }

  // First param: destructuring [id, data]
  const firstParam = params[0]!;
  if (!ts.isArrayBindingPattern(firstParam.name) || firstParam.name.elements.length !== 2) {
    throw error(
      "EA2",
      "dispatch first parameter must be an array destructuring [id, data]",
      firstParam,
      ctx,
    );
  }
  const el0 = firstParam.name.elements[0]!;
  const el1 = firstParam.name.elements[1]!;
  if (
    !ts.isBindingElement(el0) ||
    !ts.isIdentifier(el0.name) ||
    !ts.isBindingElement(el1) ||
    !ts.isIdentifier(el1.name)
  ) {
    throw error(
      "EA2",
      "dispatch array destructuring elements must be simple identifiers",
      firstParam,
      ctx,
    );
  }
  const p1Name = el0.name.text;
  const p2Name = el1.name.text;

  // Second param: next
  const secondParam = params[1]!;
  if (!ts.isIdentifier(secondParam.name)) {
    throw error("EA2", "dispatch second parameter must be a simple identifier", secondParam, ctx);
  }
  const nextName = secondParam.name.text;

  if (!prop.body) {
    throw error("EA2", "dispatch method must have a body", prop, ctx);
  }

  const allowedRefs = new Set([p1Name, p2Name, nextName]);
  const body = emitMiddlewareBody(
    Array.from(prop.body.statements),
    0,
    allowedRefs,
    nextName,
    0,
    ctx,
  );
  return Fn([p1Name, p2Name], body);
}

// ── Middleware body compiler ──

/**
 * Index-based recursive compiler for dispatch handler bodies.
 * Supports: return, const, if (with/without else), throw new Error, yield* next(a,b).
 */
function emitMiddlewareBody(
  stmts: ts.Statement[],
  index: number,
  allowedRefs: Set<string>,
  nextName: string,
  nextCallCount: number,
  ctx: EmitContext,
): Expr {
  if (index >= stmts.length) {
    return null as unknown as Expr;
  }

  const stmt = stmts[index]!;

  // ── return yield* next(a, b) ──
  if (
    ts.isReturnStatement(stmt) &&
    stmt.expression &&
    ts.isYieldExpression(stmt.expression) &&
    stmt.expression.asteriskToken &&
    stmt.expression.expression &&
    ts.isCallExpression(stmt.expression.expression) &&
    ts.isIdentifier(stmt.expression.expression.expression) &&
    stmt.expression.expression.expression.text === nextName
  ) {
    if (nextCallCount + 1 > 1) {
      throw error("EA5", "next() can only be called once per dispatch handler", stmt, ctx);
    }
    const args = stmt.expression.expression.arguments;
    if (args.length !== 2 || !args[0] || !args[1]) {
      throw error("EA4", "next() must be called with exactly 2 arguments", stmt, ctx);
    }
    return ExternalEval(
      "dispatch",
      ArrayNode([emitMExpr(args[0], allowedRefs, ctx), emitMExpr(args[1], allowedRefs, ctx)]),
    );
  }

  // ── const name = yield* next(a, b); ...rest ──
  if (
    ts.isVariableStatement(stmt) &&
    !!(stmt.declarationList.flags & ts.NodeFlags.Const) &&
    stmt.declarationList.declarations.length === 1
  ) {
    const decl = stmt.declarationList.declarations[0]!;
    if (
      ts.isIdentifier(decl.name) &&
      decl.initializer &&
      ts.isYieldExpression(decl.initializer) &&
      decl.initializer.asteriskToken &&
      decl.initializer.expression &&
      ts.isCallExpression(decl.initializer.expression) &&
      ts.isIdentifier(decl.initializer.expression.expression) &&
      decl.initializer.expression.expression.text === nextName
    ) {
      if (nextCallCount + 1 > 1) {
        throw error("EA5", "next() can only be called once per dispatch handler", stmt, ctx);
      }
      const name = decl.name.text;
      const args = decl.initializer.expression.arguments;
      if (args.length !== 2 || !args[0] || !args[1]) {
        throw error("EA4", "next() must be called with exactly 2 arguments", stmt, ctx);
      }
      const newAllowedRefs = new Set([...allowedRefs, name]);
      return Let(
        name,
        ExternalEval(
          "dispatch",
          ArrayNode([emitMExpr(args[0], allowedRefs, ctx), emitMExpr(args[1], allowedRefs, ctx)]),
        ),
        emitMiddlewareBody(stmts, index + 1, newAllowedRefs, nextName, nextCallCount + 1, ctx),
      );
    }

    // ── const name = mExpr; ...rest ──
    if (ts.isIdentifier(decl.name) && decl.initializer) {
      const name = decl.name.text;
      const newAllowedRefs = new Set([...allowedRefs, name]);
      return Let(
        name,
        emitMExpr(decl.initializer, allowedRefs, ctx),
        emitMiddlewareBody(stmts, index + 1, newAllowedRefs, nextName, nextCallCount, ctx),
      );
    }
  }

  // ── return mExpr ──
  if (ts.isReturnStatement(stmt) && stmt.expression) {
    return emitMExpr(stmt.expression, allowedRefs, ctx);
  }

  // ── if (cond) { ... } [else { ... }] ──
  if (ts.isIfStatement(stmt)) {
    const cond = emitMExpr(stmt.expression, allowedRefs, ctx);
    const thenStmts = ts.isBlock(stmt.thenStatement)
      ? Array.from(stmt.thenStatement.statements)
      : [stmt.thenStatement];
    const thenBody = emitMiddlewareBody(thenStmts, 0, allowedRefs, nextName, nextCallCount, ctx);

    if (stmt.elseStatement) {
      // With else: terminal — any stmts after are dead code
      if (index + 1 < stmts.length) {
        throw error("EA3", "Unreachable code after if-else statement", stmts[index + 1]!, ctx);
      }
      const elseStmts = ts.isBlock(stmt.elseStatement)
        ? Array.from(stmt.elseStatement.statements)
        : [stmt.elseStatement];
      const elseBody = emitMiddlewareBody(elseStmts, 0, allowedRefs, nextName, nextCallCount, ctx);
      return If(cond, thenBody, elseBody);
    } else {
      // No else: continuation is implicit else
      const continuation = emitMiddlewareBody(
        stmts,
        index + 1,
        allowedRefs,
        nextName,
        nextCallCount,
        ctx,
      );
      return If(cond, thenBody, continuation);
    }
  }

  // ── throw new Error(msg) ──
  if (
    ts.isThrowStatement(stmt) &&
    stmt.expression &&
    ts.isNewExpression(stmt.expression) &&
    ts.isIdentifier(stmt.expression.expression) &&
    stmt.expression.expression.text === "Error"
  ) {
    const args = stmt.expression.arguments;
    if (!args || args.length !== 1 || !args[0]) {
      throw error("EA3", "throw new Error() must have exactly one argument", stmt, ctx);
    }
    return Throw(emitMExpr(args[0], allowedRefs, ctx));
  }

  // ── yield* as bare expression statement (not return/const) ──
  if (
    ts.isExpressionStatement(stmt) &&
    ts.isYieldExpression(stmt.expression) &&
    stmt.expression.asteriskToken
  ) {
    throw error("EA6", "Bare yield* in dispatch handler is not allowed", stmt, ctx);
  }

  // ── yield* anything else as value ──
  if (ts.isExpressionStatement(stmt) && ts.isYieldExpression(stmt.expression)) {
    throw error("EA7", "yield in dispatch handler must use yield*", stmt, ctx);
  }

  throw error("EA3", "Unsupported statement in dispatch handler body", stmt, ctx);
}

/**
 * Compile a middleware expression (restricted subset of full emitExpression).
 * Only references in `allowedRefs` are permitted; no effects or external calls.
 */
function emitMExpr(node: ts.Expression, allowedRefs: Set<string>, ctx: EmitContext): Expr {
  // Literals
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
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

  // Identifier — must be in allowedRefs
  if (ts.isIdentifier(node)) {
    if (!allowedRefs.has(node.text)) {
      throw error("EA8", `'${node.text}' is not in scope in dispatch handler`, node, ctx);
    }
    return Ref(node.text);
  }

  // Property access: a.prop
  if (ts.isPropertyAccessExpression(node)) {
    return Get(emitMExpr(node.expression, allowedRefs, ctx), node.name.text);
  }

  // Object literal: { k: v }
  if (ts.isObjectLiteralExpression(node)) {
    const fields: Record<string, Expr> = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        fields[prop.name.text] = emitMExpr(prop.initializer, allowedRefs, ctx);
      } else {
        throw error(
          "EA3",
          "Object literal in dispatch handler must use simple property assignments",
          prop,
          ctx,
        );
      }
    }
    return Construct(fields);
  }

  // Array literal: [e, ...]
  if (ts.isArrayLiteralExpression(node)) {
    return ArrayNode(node.elements.map((e) => emitMExpr(e, allowedRefs, ctx)));
  }

  // Template literal: `...${e}...`
  if (ts.isTemplateExpression(node)) {
    const parts: Expr[] = [];
    if (node.head.text) {
      parts.push(node.head.text);
    }
    for (const span of node.templateSpans) {
      parts.push(emitMExpr(span.expression, allowedRefs, ctx));
      if (span.literal.text) {
        parts.push(span.literal.text);
      }
    }
    return Concat(parts);
  }

  // No-template (just a string): `hello`
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  // Binary expressions
  if (ts.isBinaryExpression(node)) {
    const left = emitMExpr(node.left, allowedRefs, ctx);
    const right = emitMExpr(node.right, allowedRefs, ctx);
    switch (node.operatorToken.kind) {
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
      case ts.SyntaxKind.GreaterThanToken:
        return Gt(left, right);
      case ts.SyntaxKind.GreaterThanEqualsToken:
        return Gte(left, right);
      case ts.SyntaxKind.LessThanToken:
        return Lt(left, right);
      case ts.SyntaxKind.LessThanEqualsToken:
        return Lte(left, right);
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
        return Eq(left, right);
      case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        return Neq(left, right);
      case ts.SyntaxKind.AmpersandAmpersandToken:
        return And(left, right);
      case ts.SyntaxKind.BarBarToken:
        return Or(left, right);
      default:
        throw error("EA3", "Unsupported binary operator in dispatch handler", node, ctx);
    }
  }

  // Prefix unary: ! or -
  if (ts.isPrefixUnaryExpression(node)) {
    const operand = emitMExpr(node.operand, allowedRefs, ctx);
    if (node.operator === ts.SyntaxKind.ExclamationToken) {
      return Not(operand);
    }
    if (node.operator === ts.SyntaxKind.MinusToken) {
      return Neg(operand);
    }
    throw error("EA3", "Unsupported prefix operator in dispatch handler", node, ctx);
  }

  // Ternary: c ? a : b
  if (ts.isConditionalExpression(node)) {
    return If(
      emitMExpr(node.condition, allowedRefs, ctx),
      emitMExpr(node.whenTrue, allowedRefs, ctx),
      emitMExpr(node.whenFalse, allowedRefs, ctx),
    );
  }

  // new Error(...) at expression level — only valid at statement level in throw
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "Error"
  ) {
    throw error("EA3", "new Error() can only be used in a throw statement", node, ctx);
  }

  throw error("EA3", "Unsupported expression in dispatch handler", node, ctx);
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
    assertNotCapabilityInProhibitedPosition(node.text, "expression", node, ctx);
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
        assertNotCapabilityInProhibitedPosition(key, "object-field", prop, ctx);
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
      assertNotCapabilityInProhibitedPosition(key, "object-field", prop, ctx);
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

  // each(...) in call position → E-STREAM-004
  if (ts.isIdentifier(callee) && callee.text === "each") {
    throw error(
      "E-STREAM-004",
      "each() can only be used as the iterable in 'for (const x of yield* each(expr))'",
      node,
      ctx,
    );
  }

  // useConfig(...) without yield* → UC3
  if (ts.isIdentifier(callee) && callee.text === "useConfig") {
    throw error("UC3", "useConfig() must be called as Config.useConfig(Token)", node, ctx);
  }

  // resource(function* () { ... }) — bare call (e.g. inside non-generator helper)
  if (ts.isIdentifier(callee) && callee.text === "resource") {
    if (ctx.inResourceBody) {
      throw error(
        "RS7",
        "resource() cannot be nested inside another resource body (deferred to future specification)",
        node,
        ctx,
      );
    }
    return emitResource(node, ctx);
  }

  // f(args) → Call(Ref("f"), [args])
  if (ts.isIdentifier(callee)) {
    const args = node.arguments.map((a) => emitExpression(a, ctx));
    return Call(Ref(callee.text), args);
  }

  // Config.useConfig(...) without yield* → UC1
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Config" &&
    callee.name.text === "useConfig"
  ) {
    throw error(
      "UC1",
      "Config.useConfig() requires yield* — use yield* Config.useConfig(Token)",
      node,
      ctx,
    );
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
      if (callee.text === "each") {
        throw error(
          "E-STREAM-004",
          "each() can only be used as the iterable in 'for (const x of yield* each(expr))'",
          node,
          ctx,
        );
      }
      if (callee.text === "eval") {
        throw error("E014", "eval() is not allowed", node, ctx);
      }
      if (callee.text === "Promise") {
        throw error("E021", "Promise is not allowed", node, ctx);
      }
    }
    // each.next() → E-STREAM-005
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "each" &&
      callee.name.text === "next"
    ) {
      throw error(
        "E-STREAM-005",
        "each.next() is not part of the Tisyn authored language",
        node,
        ctx,
      );
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
