import type { TisynExpr } from "./types.js";
import { isEvalNode, isQuoteNode, isRefNode, isFnNode } from "./guards.js";
import { classify, isCompoundExternal } from "./classify.js";

export interface DecompileOptions {
  indent?: number;
  typeAnnotations?: boolean;
  namedExport?: string;
}

export function decompile(expr: TisynExpr, options?: DecompileOptions): string {
  const opts = {
    indent: options?.indent ?? 2,
    typeAnnotations: options?.typeAnnotations ?? false,
    namedExport: options?.namedExport,
  };

  if (isFnNode(expr)) {
    const name = opts.namedExport ?? "anonymous";
    const params = expr.params.join(", ");
    const body = decompileBody(expr.body as TisynExpr, 1, opts);
    return `function* ${name}(${params}) {\n${body}\n}`;
  }

  return decompileExpr(expr, 0, opts);
}

function decompileBody(
  expr: TisynExpr,
  depth: number,
  opts: { indent: number; typeAnnotations: boolean },
): string {
  const pad = " ".repeat(depth * opts.indent);

  // Let chains flatten to sequential const statements
  if (isEvalNode(expr) && expr.id === "let") {
    const shape = unquoteShape(expr.data) as { name: string; value: TisynExpr; body: TisynExpr };

    // Check for recursive loop pattern (Fn + Call with same name)
    if (isLoopPattern(shape.name, shape.value, shape.body)) {
      return decompileLoop(shape.value as TisynExpr, depth, opts);
    }

    const valueStr = decompileStatement(shape.name, shape.value as TisynExpr, depth, opts);

    // Continue with body
    const bodyStr = decompileBody(shape.body as TisynExpr, depth, opts);
    return `${valueStr}\n${bodyStr}`;
  }

  // Terminal expression becomes a return
  return `${pad}return ${decompileExpr(expr, depth, opts)};`;
}

function decompileStatement(
  name: string,
  value: TisynExpr,
  depth: number,
  opts: { indent: number; typeAnnotations: boolean },
): string {
  const pad = " ".repeat(depth * opts.indent);

  // __discard_N bindings become bare yield* (no variable)
  if (name.startsWith("__discard_")) {
    return `${pad}${decompileExpr(value, depth, opts)};`;
  }

  return `${pad}const ${name} = ${decompileExpr(value, depth, opts)};`;
}

function decompileExpr(
  expr: TisynExpr,
  depth: number,
  opts: { indent: number; typeAnnotations: boolean },
): string {
  if (expr === null) return "null";
  if (typeof expr === "string") return JSON.stringify(expr);
  if (typeof expr === "number") return String(expr);
  if (typeof expr === "boolean") return String(expr);

  if (Array.isArray(expr)) {
    const items = expr.map((e) => decompileExpr(e as TisynExpr, depth, opts));
    return `[${items.join(", ")}]`;
  }

  if (isRefNode(expr)) {
    return expr.name;
  }

  if (isQuoteNode(expr)) {
    return decompileExpr(expr.expr as TisynExpr, depth, opts);
  }

  if (isFnNode(expr)) {
    const params = expr.params.join(", ");
    const body = decompileBody(expr.body as TisynExpr, depth + 1, opts);
    return `function*(${params}) {\n${body}\n${" ".repeat(depth * opts.indent)}}`;
  }

  if (isEvalNode(expr)) {
    return decompileEval(expr.id, expr.data as TisynExpr, depth, opts);
  }

  // Plain object literal
  const obj = expr as Record<string, TisynExpr>;
  const entries = Object.entries(obj).map(([k, v]) => `${k}: ${decompileExpr(v, depth, opts)}`);
  return `{ ${entries.join(", ")} }`;
}

function decompileEval(
  id: string,
  data: TisynExpr,
  depth: number,
  opts: { indent: number; typeAnnotations: boolean },
): string {
  const cls = classify(id);

  if (cls === "structural") {
    return decompileStructural(id, data, depth, opts);
  }

  if (isCompoundExternal(id)) {
    return decompileCompoundExternal(id, data, depth, opts);
  }

  // Standard external → yield* Agent().method(args)
  return decompileExternalCall(id, data, depth, opts);
}

function decompileStructural(
  id: string,
  data: TisynExpr,
  depth: number,
  opts: { indent: number; typeAnnotations: boolean },
): string {
  const shape = unquoteShape(data);
  const pad = " ".repeat(depth * opts.indent);
  const innerPad = " ".repeat((depth + 1) * opts.indent);

  switch (id) {
    case "if": {
      const s = shape as { condition: TisynExpr; then: TisynExpr; else?: TisynExpr };
      const condStr = decompileExpr(s.condition, depth, opts);
      const thenStr = decompileExpr(s.then, depth + 1, opts);
      if (s.else !== undefined) {
        const elseStr = decompileExpr(s.else, depth + 1, opts);
        return `(${condStr}) ? ${thenStr} : ${elseStr}`;
      }
      return `(${condStr}) ? ${thenStr} : null`;
    }
    case "add":
      return binOp(shape, "+", depth, opts);
    case "sub":
      return binOp(shape, "-", depth, opts);
    case "mul":
      return binOp(shape, "*", depth, opts);
    case "div":
      return binOp(shape, "/", depth, opts);
    case "mod":
      return binOp(shape, "%", depth, opts);
    case "gt":
      return binOp(shape, ">", depth, opts);
    case "gte":
      return binOp(shape, ">=", depth, opts);
    case "lt":
      return binOp(shape, "<", depth, opts);
    case "lte":
      return binOp(shape, "<=", depth, opts);
    case "eq":
      return binOp(shape, "===", depth, opts);
    case "neq":
      return binOp(shape, "!==", depth, opts);
    case "and":
      return binOp(shape, "&&", depth, opts);
    case "or":
      return binOp(shape, "||", depth, opts);
    case "not": {
      const s = shape as { a: TisynExpr };
      return `!${decompileExpr(s.a, depth, opts)}`;
    }
    case "neg": {
      const s = shape as { a: TisynExpr };
      return `-${decompileExpr(s.a, depth, opts)}`;
    }
    case "get": {
      const s = shape as { obj: TisynExpr; key: string };
      return `${decompileExpr(s.obj, depth, opts)}.${s.key}`;
    }
    case "call": {
      const s = shape as { fn: TisynExpr; args: TisynExpr[] };
      const fnStr = decompileExpr(s.fn, depth, opts);
      const argsStr = s.args.map((a) => decompileExpr(a, depth, opts)).join(", ");
      return `${fnStr}(${argsStr})`;
    }
    case "seq": {
      const s = shape as { exprs: TisynExpr[] };
      const stmts = s.exprs.map((e) => decompileExpr(e, depth, opts));
      return stmts.join(", ");
    }
    case "construct": {
      const fields = shape as Record<string, TisynExpr>;
      const entries = Object.entries(fields).map(
        ([k, v]) => `${k}: ${decompileExpr(v, depth, opts)}`,
      );
      return `{ ${entries.join(", ")} }`;
    }
    case "array": {
      const s = shape as { items: TisynExpr[] };
      const items = s.items.map((e) => decompileExpr(e, depth, opts));
      return `[${items.join(", ")}]`;
    }
    case "concat": {
      const s = shape as { parts: TisynExpr[] };
      const parts = s.parts.map((p) => decompileExpr(p, depth, opts));
      return parts.join(" + ");
    }
    case "throw": {
      const s = shape as { message: TisynExpr };
      return `(() => { throw new Error(${decompileExpr(s.message, depth, opts)}); })()`;
    }
    case "concat-arrays": {
      const s = shape as { arrays: TisynExpr[] };
      const parts = s.arrays.map((e) => `...${decompileExpr(e, depth, opts)}`);
      return `[${parts.join(", ")}]`;
    }
    case "merge-objects": {
      const s = shape as { objects: TisynExpr[] };
      const parts = s.objects.map((e) => `...${decompileExpr(e, depth, opts)}`);
      return `{ ${parts.join(", ")} }`;
    }
    case "while": {
      const s = shape as { condition: TisynExpr; exprs: TisynExpr[] };
      const condStr = decompileExpr(s.condition, depth, opts);
      const bodyStmts = s.exprs.map((e) => `${innerPad}${decompileExpr(e, depth + 1, opts)};`);
      return `while (${condStr}) {\n${bodyStmts.join("\n")}\n${pad}}`;
    }
    case "let": {
      const s = shape as { name: string; value: TisynExpr; body: TisynExpr };
      return `(() => { const ${s.name} = ${decompileExpr(s.value, depth, opts)}; return ${decompileExpr(s.body, depth, opts)}; })()`;
    }
    default:
      return `/* unknown structural: ${id} */`;
  }
}

function decompileCompoundExternal(
  id: string,
  data: TisynExpr,
  depth: number,
  opts: { indent: number; typeAnnotations: boolean },
): string {
  const shape = unquoteShape(data) as { exprs: TisynExpr[] };
  const args = shape.exprs.map((e) => {
    if (isFnNode(e)) {
      const body = decompileBody(e.body as TisynExpr, depth + 1, opts);
      return `() => {\n${body}\n${" ".repeat(depth * opts.indent)}}`;
    }
    return `() => ${decompileExpr(e, depth, opts)}`;
  });

  return `yield* ${id}([${args.join(", ")}])`;
}

function decompileExternalCall(
  id: string,
  data: TisynExpr,
  depth: number,
  opts: { indent: number; typeAnnotations: boolean },
): string {
  // Single-payload convention: data is always one expression (the payload)
  const arg = decompileExpr(data, depth, opts);

  if (id.includes(".")) {
    const dotIndex = id.indexOf(".");
    const agentKebab = id.slice(0, dotIndex);
    const method = id.slice(dotIndex + 1);
    const agentPascal = kebabToPascal(agentKebab);
    return `yield* ${agentPascal}().${method}(${arg})`;
  }

  return `yield* ${id}(${arg})`;
}

function binOp(
  shape: Record<string, unknown>,
  op: string,
  depth: number,
  opts: { indent: number; typeAnnotations: boolean },
): string {
  const s = shape as { a: TisynExpr; b: TisynExpr };
  return `${decompileExpr(s.a, depth, opts)} ${op} ${decompileExpr(s.b, depth, opts)}`;
}

function unquoteShape(data: TisynExpr): Record<string, unknown> {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (obj["tisyn"] === "quote" && "expr" in obj) {
      return obj["expr"] as Record<string, unknown>;
    }
  }
  return data as Record<string, unknown>;
}

function isLoopPattern(name: string, value: TisynExpr, body: TisynExpr): boolean {
  if (!name.startsWith("__loop_")) return false;
  if (!isFnNode(value)) return false;
  if (!isEvalNode(body) || body.id !== "call") return false;
  const callShape = unquoteShape(body.data as TisynExpr) as { fn: TisynExpr };
  return isRefNode(callShape.fn) && callShape.fn.name === name;
}

function decompileLoop(
  fnExpr: TisynExpr,
  depth: number,
  opts: { indent: number; typeAnnotations: boolean },
): string {
  if (!isFnNode(fnExpr)) return decompileExpr(fnExpr, depth, opts);
  const pad = " ".repeat(depth * opts.indent);
  const innerPad = " ".repeat((depth + 1) * opts.indent);
  const body = decompileLoopBody(fnExpr.body as TisynExpr, depth + 1, opts);
  return `${pad}while (true) {\n${body}\n${pad}}`;
}

function decompileLoopBody(
  expr: TisynExpr,
  depth: number,
  opts: { indent: number; typeAnnotations: boolean },
): string {
  const pad = " ".repeat(depth * opts.indent);

  if (isEvalNode(expr) && expr.id === "let") {
    const shape = unquoteShape(expr.data) as { name: string; value: TisynExpr; body: TisynExpr };
    const valueStr = decompileStatement(shape.name, shape.value as TisynExpr, depth, opts);
    const bodyStr = decompileLoopBody(shape.body as TisynExpr, depth, opts);
    return `${valueStr}\n${bodyStr}`;
  }

  if (isEvalNode(expr) && expr.id === "if") {
    const shape = unquoteShape(expr.data) as {
      condition: TisynExpr;
      then: TisynExpr;
      else?: TisynExpr;
    };
    const condStr = decompileExpr(shape.condition, depth, opts);
    const thenStr = decompileIfBranch(shape.then as TisynExpr, depth + 1, opts);
    let result = `${pad}if (${condStr}) {\n${thenStr}\n${pad}}`;
    if (shape.else !== undefined) {
      const elseStr = decompileIfBranch(shape.else as TisynExpr, depth + 1, opts);
      result += ` else {\n${elseStr}\n${pad}}`;
    }
    return result;
  }

  // Recursive call back to __loop — becomes continue (or just falls through)
  if (isEvalNode(expr) && expr.id === "call") {
    const callShape = unquoteShape(expr.data) as { fn: TisynExpr };
    if (isRefNode(callShape.fn) && callShape.fn.name.startsWith("__loop_")) {
      return ""; // Loop continues naturally
    }
  }

  return `${pad}return ${decompileExpr(expr, depth, opts)};`;
}

function decompileIfBranch(
  expr: TisynExpr,
  depth: number,
  opts: { indent: number; typeAnnotations: boolean },
): string {
  const pad = " ".repeat(depth * opts.indent);

  // If the branch is a return value (not more control flow), emit return
  if (isEvalNode(expr) && expr.id === "let") {
    const shape = unquoteShape(expr.data) as { name: string; value: TisynExpr; body: TisynExpr };
    const valueStr = decompileStatement(shape.name, shape.value as TisynExpr, depth, opts);
    const bodyStr = decompileIfBranch(shape.body as TisynExpr, depth, opts);
    return `${valueStr}\n${bodyStr}`;
  }

  if (isEvalNode(expr) && expr.id === "if") {
    return decompileLoopBody(expr, depth, opts);
  }

  // Recursive call to __loop — continue
  if (isEvalNode(expr) && expr.id === "call") {
    const callShape = unquoteShape(expr.data) as { fn: TisynExpr };
    if (isRefNode(callShape.fn) && callShape.fn.name.startsWith("__loop_")) {
      return ""; // implicit continue
    }
  }

  return `${pad}return ${decompileExpr(expr, depth, opts)};`;
}

function kebabToPascal(kebab: string): string {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
