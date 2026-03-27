import type { TisynExpr } from "./types.js";
import { isEvalNode, isQuoteNode, isRefNode, isFnNode } from "./guards.js";
import { classify, isCompoundExternal } from "./classify.js";

export interface PrintOptions {
  indent?: number;
  maxWidth?: number;
  compact?: boolean;
}

/**
 * Print an expression as a constructor-call representation.
 */
export function print(expr: TisynExpr, options?: PrintOptions): string {
  const opts = {
    indent: options?.indent ?? 2,
    maxWidth: options?.maxWidth ?? 80,
    compact: options?.compact ?? true,
  };
  return printNode(expr, 0, opts);
}

function printNode(
  expr: TisynExpr,
  depth: number,
  opts: PrintOptions & { indent: number; maxWidth: number; compact: boolean },
): string {
  if (expr === null) return "null";
  if (typeof expr === "string") return JSON.stringify(expr);
  if (typeof expr === "number" || typeof expr === "boolean") return String(expr);

  if (Array.isArray(expr)) {
    if (expr.length === 0) return "[]";
    const items = expr.map((e) => printNode(e as TisynExpr, depth + 1, opts));
    const inline = `[${items.join(", ")}]`;
    if (opts.compact && inline.length <= opts.maxWidth) return inline;
    const pad = " ".repeat((depth + 1) * opts.indent);
    return `[\n${items.map((i) => `${pad}${i}`).join(",\n")}\n${" ".repeat(depth * opts.indent)}]`;
  }

  if (isRefNode(expr)) {
    return `Ref(${JSON.stringify(expr.name)})`;
  }

  if (isQuoteNode(expr)) {
    return `Q(${printNode(expr.expr as TisynExpr, depth, opts)})`;
  }

  if (isFnNode(expr)) {
    const params = `[${expr.params.map((p) => JSON.stringify(p)).join(", ")}]`;
    const body = printNode(expr.body as TisynExpr, depth + 1, opts);
    const inline = `Fn(${params}, ${body})`;
    if (opts.compact && inline.length <= opts.maxWidth) return inline;
    const pad = " ".repeat((depth + 1) * opts.indent);
    return `Fn(${params},\n${pad}${body})`;
  }

  if (isEvalNode(expr)) {
    return printEval(expr.id, expr.data as TisynExpr, depth, opts);
  }

  // Plain object literal
  return printObject(expr as Record<string, TisynExpr>, depth, opts);
}

function printEval(
  id: string,
  data: TisynExpr,
  depth: number,
  opts: PrintOptions & { indent: number; maxWidth: number; compact: boolean },
): string {
  const cls = classify(id);

  if (cls === "structural") {
    return printStructural(id, data, depth, opts);
  }

  if (isCompoundExternal(id)) {
    return printCompoundExternal(id, data, depth, opts);
  }

  // Standard external — render data as single payload expression
  const name = `Eval(${JSON.stringify(id)}`;
  const inner = printNode(data, depth + 1, opts);
  const inline = `${name}, ${inner})`;
  if (opts.compact && inline.length <= opts.maxWidth) return inline;
  const pad = " ".repeat((depth + 1) * opts.indent);
  return `${name},\n${pad}${inner})`;
}

function printStructural(
  id: string,
  data: TisynExpr,
  depth: number,
  opts: PrintOptions & { indent: number; maxWidth: number; compact: boolean },
): string {
  // Unwrap Quote
  const qdata = data as Record<string, unknown>;
  const shape =
    qdata && typeof qdata === "object" && "tisyn" in qdata && qdata["tisyn"] === "quote"
      ? ((qdata as { expr: unknown }).expr as Record<string, unknown>)
      : qdata;

  const name = constructorName(id);

  switch (id) {
    case "let": {
      const s = shape as { name: string; value: TisynExpr; body: TisynExpr };
      const args = [
        JSON.stringify(s.name),
        printNode(s.value, depth + 1, opts),
        printNode(s.body, depth + 1, opts),
      ];
      return formatCall(name, args, depth, opts);
    }
    case "seq": {
      const s = shape as { exprs: TisynExpr[] };
      const args = s.exprs.map((e) => printNode(e, depth + 1, opts));
      return formatCall(name, args, depth, opts);
    }
    case "if": {
      const s = shape as { condition: TisynExpr; then: TisynExpr; else?: TisynExpr };
      const args = [printNode(s.condition, depth + 1, opts), printNode(s.then, depth + 1, opts)];
      if (s.else !== undefined) {
        args.push(printNode(s.else, depth + 1, opts));
      }
      return formatCall(name, args, depth, opts);
    }
    case "while": {
      const s = shape as { condition: TisynExpr; exprs: TisynExpr[] };
      const condArg = printNode(s.condition, depth + 1, opts);
      const exprsArg = s.exprs.map((e) => printNode(e, depth + 1, opts));
      const inline = `${name}(${condArg}, [${exprsArg.join(", ")}])`;
      if (opts.compact && inline.length <= opts.maxWidth) return inline;
      const pad = " ".repeat((depth + 1) * opts.indent);
      return `${name}(${condArg}, [\n${exprsArg.map((a) => `${pad}${a}`).join(",\n")}\n${" ".repeat(depth * opts.indent)}])`;
    }
    case "call": {
      const s = shape as { fn: TisynExpr; args: TisynExpr[] };
      const args = [
        printNode(s.fn, depth + 1, opts),
        ...s.args.map((e) => printNode(e, depth + 1, opts)),
      ];
      return formatCall(name, args, depth, opts);
    }
    case "get": {
      const s = shape as { obj: TisynExpr; key: string };
      const args = [printNode(s.obj, depth + 1, opts), JSON.stringify(s.key)];
      return formatCall(name, args, depth, opts);
    }
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
    case "or": {
      const s = shape as { a: TisynExpr; b: TisynExpr };
      const args = [printNode(s.a, depth + 1, opts), printNode(s.b, depth + 1, opts)];
      return formatCall(name, args, depth, opts);
    }
    case "not":
    case "neg": {
      const s = shape as { a: TisynExpr };
      return formatCall(name, [printNode(s.a, depth + 1, opts)], depth, opts);
    }
    case "construct": {
      const fields = shape as Record<string, TisynExpr>;
      const entries = Object.entries(fields).map(
        ([k, v]) => `${k}: ${printNode(v, depth + 2, opts)}`,
      );
      const inline = `Construct({ ${entries.join(", ")} })`;
      if (opts.compact && inline.length <= opts.maxWidth) return inline;
      const pad = " ".repeat((depth + 1) * opts.indent);
      return `Construct({\n${entries.map((e) => `${pad}${e}`).join(",\n")}\n${" ".repeat(depth * opts.indent)}})`;
    }
    case "array": {
      const s = shape as { items: TisynExpr[] };
      const args = s.items.map((e) => printNode(e, depth + 1, opts));
      return formatCall("Arr", args, depth, opts);
    }
    case "concat": {
      const s = shape as { parts: TisynExpr[] };
      const args = s.parts.map((e) => printNode(e, depth + 1, opts));
      return formatCall(name, args, depth, opts);
    }
    case "throw": {
      const s = shape as { message: TisynExpr };
      return formatCall(name, [printNode(s.message, depth + 1, opts)], depth, opts);
    }
    case "concat-arrays": {
      const s = shape as { arrays: TisynExpr[] };
      const args = s.arrays.map((e) => printNode(e, depth + 1, opts));
      return formatCall("ConcatArrays", args, depth, opts);
    }
    case "merge-objects": {
      const s = shape as { objects: TisynExpr[] };
      const args = s.objects.map((e) => printNode(e, depth + 1, opts));
      return formatCall("MergeObjects", args, depth, opts);
    }
    default:
      return `${name}(${printNode(shape as TisynExpr, depth + 1, opts)})`;
  }
}

function printCompoundExternal(
  id: string,
  data: TisynExpr,
  depth: number,
  opts: PrintOptions & { indent: number; maxWidth: number; compact: boolean },
): string {
  const qdata = data as Record<string, unknown>;
  const shape =
    qdata && typeof qdata === "object" && "tisyn" in qdata && qdata["tisyn"] === "quote"
      ? (qdata as { expr: Record<string, unknown> }).expr
      : qdata;
  const s = shape as { exprs: TisynExpr[] };
  const name = constructorName(id);
  const args = s.exprs.map((e) => printNode(e, depth + 1, opts));
  return formatCall(name, args, depth, opts);
}

function constructorName(id: string): string {
  switch (id) {
    case "let":
      return "Let";
    case "seq":
      return "Seq";
    case "if":
      return "If";
    case "while":
      return "While";
    case "call":
      return "Call";
    case "get":
      return "Get";
    case "add":
      return "Add";
    case "sub":
      return "Sub";
    case "mul":
      return "Mul";
    case "div":
      return "Div";
    case "mod":
      return "Mod";
    case "neg":
      return "Neg";
    case "gt":
      return "Gt";
    case "gte":
      return "Gte";
    case "lt":
      return "Lt";
    case "lte":
      return "Lte";
    case "eq":
      return "Eq";
    case "neq":
      return "Neq";
    case "and":
      return "And";
    case "or":
      return "Or";
    case "not":
      return "Not";
    case "construct":
      return "Construct";
    case "array":
      return "Arr";
    case "concat":
      return "Concat";
    case "throw":
      return "Throw";
    case "concat-arrays":
      return "ConcatArrays";
    case "merge-objects":
      return "MergeObjects";
    case "all":
      return "All";
    case "race":
      return "Race";
    default:
      return id;
  }
}

function formatCall(
  name: string,
  args: string[],
  depth: number,
  opts: { indent: number; maxWidth: number; compact: boolean },
): string {
  const inline = `${name}(${args.join(", ")})`;
  if (opts.compact && inline.length <= opts.maxWidth) return inline;
  const pad = " ".repeat((depth + 1) * opts.indent);
  return `${name}(\n${args.map((a) => `${pad}${a}`).join(",\n")}\n${" ".repeat(depth * opts.indent)})`;
}

function printObject(
  obj: Record<string, TisynExpr>,
  depth: number,
  opts: PrintOptions & { indent: number; maxWidth: number; compact: boolean },
): string {
  const entries = Object.entries(obj).map(
    ([k, v]) => `${JSON.stringify(k)}: ${printNode(v, depth + 1, opts)}`,
  );
  if (entries.length === 0) return "{}";
  const inline = `{ ${entries.join(", ")} }`;
  if (opts.compact && inline.length <= opts.maxWidth) return inline;
  const pad = " ".repeat((depth + 1) * opts.indent);
  return `{\n${entries.map((e) => `${pad}${e}`).join(",\n")}\n${" ".repeat(depth * opts.indent)}}`;
}
