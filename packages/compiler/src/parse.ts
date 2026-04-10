/**
 * Phase 1: Parse TypeScript source → extract generator function declarations.
 *
 * Uses the TypeScript compiler API (ts.createSourceFile) to parse source.
 * Extracts generator function declarations with their name, params, and body.
 */

import ts from "typescript";

export interface ParsedFunction {
  name: string;
  params: string[];
  /** Type annotation text per param (parallel to params), defaults to "unknown". */
  paramTypes: string[];
  /** Return type extracted from Workflow<T> annotation, defaults to "unknown". */
  returnType: string;
  body: ts.Block;
  node: ts.FunctionDeclaration;
}

/**
 * Parse TypeScript source and extract all generator function declarations.
 *
 * Rejects: non-generator functions (extracted separately), async generators.
 */
export function parseSource(source: string, filename = "input.ts"): ParsedFunction[] {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const functions: ParsedFunction[] = [];

  for (const stmt of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(stmt)) {
      continue;
    }
    if (!stmt.asteriskToken) {
      continue;
    } // must be generator
    if (!stmt.name) {
      continue;
    } // must be named
    if (!stmt.body) {
      continue;
    } // must have body

    // Check for async — not allowed
    const isAsync = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    if (isAsync) {
      continue;
    } // async generators are rejected in discover

    const params: string[] = [];
    const paramTypes: string[] = [];
    for (const param of stmt.parameters) {
      if (ts.isIdentifier(param.name)) {
        params.push(param.name.text);
        paramTypes.push(param.type ? param.type.getText(sourceFile) : "unknown");
      }
    }

    // Extract return type from Workflow<T> annotation if present
    let returnType = "unknown";
    if (
      stmt.type &&
      ts.isTypeReferenceNode(stmt.type) &&
      ts.isIdentifier(stmt.type.typeName) &&
      stmt.type.typeName.text === "Workflow" &&
      stmt.type.typeArguments?.length === 1
    ) {
      returnType = stmt.type.typeArguments[0]!.getText(sourceFile);
    }

    functions.push({
      name: stmt.name.text,
      params,
      paramTypes,
      returnType,
      body: stmt.body,
      node: stmt,
    });
  }

  return functions;
}

export interface ModuleExports {
  /** Local exports: exportedName → localFunctionName. */
  local: Map<string, string>;
  /** Names re-exported from other modules (`export { x } from "./other"`). */
  reExports: string[];
}

/**
 * Collect all exported names from a TypeScript source file.
 *
 * Local exports cover:
 * - `export function* chat()` (direct modifier)
 * - `function* chat(); export { chat };` (named export declaration)
 * - `function* chat(); export { chat as myWorkflow };` (renamed export)
 *
 * Re-exports (`export { x } from "./other"`) are tracked separately because
 * the single-file compiler cannot resolve cross-module references.
 *
 * Type-only exports are skipped since they are not runtime values.
 */
export function collectExportedNames(sourceFile: ts.SourceFile): ModuleExports {
  const local = new Map<string, string>();
  const reExports: string[] = [];

  for (const stmt of sourceFile.statements) {
    // Direct: export function* chat()
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      stmt.name
    ) {
      local.set(stmt.name.text, stmt.name.text);
    }

    // Named or re-export: export { chat } / export { chat } from "./other"
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      if (stmt.isTypeOnly) {
        continue;
      }

      const isReExport = stmt.moduleSpecifier !== undefined;
      for (const spec of stmt.exportClause.elements) {
        if (spec.isTypeOnly) {
          continue;
        }
        const exportedName = spec.name.text;

        if (isReExport) {
          reExports.push(exportedName);
        } else {
          const localName = spec.propertyName?.getText(sourceFile) ?? exportedName;
          local.set(exportedName, localName);
        }
      }
    }
  }

  return { local, reExports };
}

/**
 * Parsed non-generator function — a candidate for expression helper compilation.
 * Includes function declarations, const-bound function expressions, and const-bound arrows.
 */
export interface ParsedNonGeneratorFunction {
  name: string;
  params: string[];
  paramTypes: string[];
  body: ts.Block | ts.Expression;
  node: ts.FunctionDeclaration | ts.VariableStatement;
  kind: "function-declaration" | "function-expression" | "arrow";
}

/**
 * Extract generator functions from an already-parsed SourceFile.
 *
 * Like parseSource but takes a SourceFile instead of a source string.
 */
export function parseGenerators(sourceFile: ts.SourceFile): ParsedFunction[] {
  const functions: ParsedFunction[] = [];

  for (const stmt of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(stmt)) continue;
    if (!stmt.asteriskToken) continue;
    if (!stmt.name) continue;
    if (!stmt.body) continue;

    const isAsync = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    if (isAsync) continue;

    const params: string[] = [];
    const paramTypes: string[] = [];
    for (const param of stmt.parameters) {
      if (ts.isIdentifier(param.name)) {
        params.push(param.name.text);
        paramTypes.push(param.type ? param.type.getText(sourceFile) : "unknown");
      }
    }

    let returnType = "unknown";
    if (
      stmt.type &&
      ts.isTypeReferenceNode(stmt.type) &&
      ts.isIdentifier(stmt.type.typeName) &&
      stmt.type.typeName.text === "Workflow" &&
      stmt.type.typeArguments?.length === 1
    ) {
      returnType = stmt.type.typeArguments[0]!.getText(sourceFile);
    }

    functions.push({
      name: stmt.name.text,
      params,
      paramTypes,
      returnType,
      body: stmt.body,
      node: stmt,
    });
  }

  return functions;
}

/**
 * Extract non-generator function candidates from a SourceFile.
 *
 * Captures:
 * - Top-level non-generator `function` declarations (SE2)
 * - `const`-bound function expressions: `const f = function(...) { ... }`
 * - `const`-bound arrow expressions: `const f = (...) => expr` or `const f = (...) => { ... }`
 * - `const`-bound generator function expressions: `const f = function*(...) { ... }`
 *   (these are returned as ParsedFunction via parseConstBoundGenerators)
 *
 * Skips: async functions, functions without names, functions without bodies.
 */
export function parseNonGeneratorFunctions(
  sourceFile: ts.SourceFile,
): ParsedNonGeneratorFunction[] {
  const results: ParsedNonGeneratorFunction[] = [];

  for (const stmt of sourceFile.statements) {
    // Case 1: function declaration (non-generator)
    if (ts.isFunctionDeclaration(stmt)) {
      if (stmt.asteriskToken) continue; // generator — handled by parseGenerators
      if (!stmt.name) continue;
      if (!stmt.body) continue;
      const isAsync = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (isAsync) continue;

      results.push({
        name: stmt.name.text,
        params: extractParams(stmt.parameters, sourceFile),
        paramTypes: extractParamTypes(stmt.parameters, sourceFile),
        body: stmt.body,
        node: stmt,
        kind: "function-declaration",
      });
      continue;
    }

    // Case 2: const-bound function expression or arrow
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        if (!decl.initializer) continue;

        // Skip let/var — only const
        if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) continue;

        const init = decl.initializer;

        // const f = function(...) { ... } (non-generator)
        if (ts.isFunctionExpression(init) && !init.asteriskToken) {
          const isAsync = init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
          if (isAsync) continue;
          if (!init.body) continue;

          results.push({
            name: decl.name.text,
            params: extractParams(init.parameters, sourceFile),
            paramTypes: extractParamTypes(init.parameters, sourceFile),
            body: init.body,
            node: stmt,
            kind: "function-expression",
          });
        }

        // const f = (...) => expr  or  const f = (...) => { ... }
        if (ts.isArrowFunction(init)) {
          const isAsync = init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
          if (isAsync) continue;

          results.push({
            name: decl.name.text,
            params: extractParams(init.parameters, sourceFile),
            paramTypes: extractParamTypes(init.parameters, sourceFile),
            body: init.body,
            node: stmt,
            kind: "arrow",
          });
        }
      }
    }
  }

  return results;
}

/**
 * Extract const-bound generator function expressions from a SourceFile.
 *
 * These are entrypoint candidates just like top-level function* declarations:
 *   `export const wf = function*() { ... }`
 */
export function parseConstBoundGenerators(sourceFile: ts.SourceFile): ParsedFunction[] {
  const results: ParsedFunction[] = [];

  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) continue;

    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      if (!decl.initializer) continue;

      const init = decl.initializer;
      if (!ts.isFunctionExpression(init)) continue;
      if (!init.asteriskToken) continue;
      if (!init.body) continue;

      const isAsync = init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (isAsync) continue;

      const params: string[] = [];
      const paramTypes: string[] = [];
      for (const param of init.parameters) {
        if (ts.isIdentifier(param.name)) {
          params.push(param.name.text);
          paramTypes.push(param.type ? param.type.getText(sourceFile) : "unknown");
        }
      }

      let returnType = "unknown";
      if (
        init.type &&
        ts.isTypeReferenceNode(init.type) &&
        ts.isIdentifier(init.type.typeName) &&
        init.type.typeName.text === "Workflow" &&
        init.type.typeArguments?.length === 1
      ) {
        returnType = init.type.typeArguments[0]!.getText(sourceFile);
      }

      results.push({
        name: decl.name.text,
        params,
        paramTypes,
        returnType,
        body: init.body,
        // Use the VariableStatement as the node for location tracking.
        // Cast is safe because we need the FunctionDeclaration shape for existing code,
        // but callers in the graph pipeline use node only for source location.
        node: stmt as unknown as ts.FunctionDeclaration,
      });
    }
  }

  return results;
}

function extractParams(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  sourceFile: ts.SourceFile,
): string[] {
  const params: string[] = [];
  for (const param of parameters) {
    if (ts.isIdentifier(param.name)) {
      params.push(param.name.text);
    }
  }
  return params;
}

function extractParamTypes(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  sourceFile: ts.SourceFile,
): string[] {
  const types: string[] = [];
  for (const param of parameters) {
    types.push(param.type ? param.type.getText(sourceFile) : "unknown");
  }
  return types;
}

/**
 * Collect exported names from a SourceFile, including const-bound exports.
 *
 * Extends collectExportedNames to also capture:
 * - `export const f = function*() {}` / `export const f = function() {}` / `export const f = () => {}`
 * - `export function helper() {}`
 */
export function collectAllExportedNames(sourceFile: ts.SourceFile): ModuleExports {
  const local = new Map<string, string>();
  const reExports: string[] = [];

  for (const stmt of sourceFile.statements) {
    const isExported = hasExportModifier(stmt);

    // Direct: export function* chat() / export function helper()
    if (ts.isFunctionDeclaration(stmt) && isExported && stmt.name) {
      local.set(stmt.name.text, stmt.name.text);
    }

    // Const-bound: export const f = function*() {} / export const f = () => {}
    if (ts.isVariableStatement(stmt) && isExported) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          local.set(decl.name.text, decl.name.text);
        }
      }
    }

    // Named or re-export: export { chat } / export { chat } from "./other"
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      if (stmt.isTypeOnly) continue;

      const isReExport = stmt.moduleSpecifier !== undefined;
      for (const spec of stmt.exportClause.elements) {
        if (spec.isTypeOnly) continue;
        const exportedName = spec.name.text;

        if (isReExport) {
          reExports.push(exportedName);
        } else {
          const localName = spec.propertyName?.getText(sourceFile) ?? exportedName;
          local.set(exportedName, localName);
        }
      }
    }
  }

  return { local, reExports };
}

function hasExportModifier(node: ts.Statement): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    : false;
}

/**
 * Get line and column for a node in a source file.
 */
export function getLocation(
  node: ts.Node,
  sourceFile?: ts.SourceFile,
): { line: number; column: number } {
  const sf = sourceFile ?? node.getSourceFile();
  if (!sf) {
    return { line: 0, column: 0 };
  }
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: line + 1, column: character + 1 };
}
