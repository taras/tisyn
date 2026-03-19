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
    if (!ts.isFunctionDeclaration(stmt)) continue;
    if (!stmt.asteriskToken) continue; // must be generator
    if (!stmt.name) continue; // must be named
    if (!stmt.body) continue; // must have body

    // Check for async — not allowed
    const isAsync = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    if (isAsync) continue; // async generators are rejected in discover

    const params: string[] = [];
    for (const param of stmt.parameters) {
      if (ts.isIdentifier(param.name)) {
        params.push(param.name.text);
      }
    }

    functions.push({
      name: stmt.name.text,
      params,
      body: stmt.body,
      node: stmt,
    });
  }

  return functions;
}

/**
 * Get line and column for a node in a source file.
 */
export function getLocation(
  node: ts.Node,
  sourceFile?: ts.SourceFile,
): { line: number; column: number } {
  const sf = sourceFile ?? node.getSourceFile();
  if (!sf) return { line: 0, column: 0 };
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: line + 1, column: character + 1 };
}
