/**
 * Discover ambient factory contracts from workflow source files.
 *
 * Parses `declare function AgentName(instance?: string): { ... }` declarations
 * and extracts contract metadata for codegen.
 */

import ts from "typescript";
import { toAgentId } from "./agent-id.js";
import { CompileError } from "./errors.js";
import { getLocation } from "./parse.js";

// ── Public types ──

export interface ContractMethod {
  name: string;
  params: Array<{ name: string; type: string }>;
  resultType: string;
}

export interface DiscoveredContract {
  name: string;
  baseAgentId: string;
  hasInstance: boolean;
  methods: ContractMethod[];
}

export interface DiscoveryResult {
  contracts: DiscoveredContract[];
  /** AST type nodes from contract signatures, for import resolution. */
  contractTypeNodes: ts.TypeNode[];
}

// ── Discovery ──

/**
 * Discover ambient factory contracts from a parsed source file.
 *
 * Looks for top-level `declare function Name(instance?: string): { ... }` declarations
 * where methods return `Workflow<T>`.
 */
export function discoverContracts(sourceFile: ts.SourceFile): DiscoveryResult {
  const contracts: DiscoveredContract[] = [];
  const allTypeNodes: ts.TypeNode[] = [];
  const seen = new Set<string>();

  for (const stmt of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(stmt)) {
      continue;
    }
    if (!stmt.name) {
      continue;
    }

    // Must have DeclareKeyword modifier
    const isDeclare = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
    if (!isDeclare) {
      continue;
    }

    // Must not have a body (ambient declarations don't)
    if (stmt.body) {
      continue;
    }

    // Must not be a generator
    if (stmt.asteriskToken) {
      continue;
    }

    const name = stmt.name.text;

    // Check for duplicates
    if (seen.has(name)) {
      const loc = getLocation(stmt, sourceFile);
      throw new CompileError(
        "E999",
        `Duplicate ambient contract declaration: '${name}'`,
        loc.line,
        loc.column,
      );
    }
    seen.add(name);

    // Validate factory parameters: zero or one optional string param
    const hasInstance = validateFactoryParams(stmt, sourceFile);

    // Return type must be a TypeLiteral
    const returnType = stmt.type;
    if (!returnType || !ts.isTypeLiteralNode(returnType)) {
      const loc = getLocation(stmt, sourceFile);
      throw new CompileError(
        "E999",
        `Ambient contract '${name}' must have an object type literal as return type`,
        loc.line,
        loc.column,
      );
    }

    // Extract methods from the type literal
    const { methods, typeNodes } = extractMethods(name, returnType, sourceFile);
    allTypeNodes.push(...typeNodes);

    contracts.push({
      name,
      baseAgentId: toAgentId(name),
      hasInstance,
      methods,
    });
  }

  return { contracts, contractTypeNodes: allTypeNodes };
}

// ── Type import collection ──

const BUILTIN_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "null",
  "undefined",
  "void",
  "never",
  "any",
  "unknown",
  "object",
  "bigint",
  "symbol",
  // Well-known utility types
  "Record",
  "Array",
  "ReadonlyArray",
  "Promise",
  "Partial",
  "Required",
  "Readonly",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "ReturnType",
  "Parameters",
  "NonNullable",
  "Awaited",
]);

/**
 * Walk AST type nodes to collect type reference identifiers and namespace qualifiers.
 * Handles all type node shapes (arrays, unions, intersections, tuples, mapped types, etc.)
 * via ts.forEachChild recursion. Only extracts identifiers from TypeReferenceNode.typeName,
 * so property names in type literals are naturally skipped.
 *
 * Rejects unsupported type operators (typeof, keyof, readonly, unique) with a CompileError.
 */
function collectTypeReferences(
  typeNodes: ts.TypeNode[],
  sourceFile: ts.SourceFile,
): {
  identifiers: Set<string>;
  nsQualifiers: Set<string>;
  nsMembers: Set<string>;
} {
  const identifiers = new Set<string>();
  const nsQualifiers = new Set<string>();
  const nsMembers = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isTypeReferenceNode(node)) {
      if (ts.isIdentifier(node.typeName)) {
        const name = node.typeName.text;
        if (!BUILTIN_TYPES.has(name)) {
          identifiers.add(name);
        }
      } else if (ts.isQualifiedName(node.typeName)) {
        const left = node.typeName.left;
        const right = node.typeName.right;
        if (ts.isIdentifier(left) && !BUILTIN_TYPES.has(left.text)) {
          nsQualifiers.add(left.text);
          nsMembers.add(right.text);
        }
      }
    }

    // Reject typeof (TypeQueryNode) — v1 restriction
    if (ts.isTypeQueryNode(node)) {
      const loc = getLocation(node, sourceFile);
      throw new CompileError(
        "E999",
        `Type operator 'typeof' is not supported in contract signatures (v1 restriction)`,
        loc.line,
        loc.column,
      );
    }

    // Reject keyof, unique, readonly type operators (TypeOperatorNode) — v1 restriction
    if (ts.isTypeOperatorNode(node)) {
      const operatorText =
        node.operator === ts.SyntaxKind.KeyOfKeyword
          ? "keyof"
          : node.operator === ts.SyntaxKind.ReadonlyKeyword
            ? "readonly"
            : node.operator === ts.SyntaxKind.UniqueKeyword
              ? "unique"
              : "type operator";
      const loc = getLocation(node, sourceFile);
      throw new CompileError(
        "E999",
        `Type operator '${operatorText}' is not supported in contract signatures (v1 restriction)`,
        loc.line,
        loc.column,
      );
    }

    ts.forEachChild(node, visit);
  }

  for (const typeNode of typeNodes) {
    visit(typeNode);
  }
  return { identifiers, nsQualifiers, nsMembers };
}

/**
 * Collect locally-defined type names (interface/type alias declarations) from source.
 */
function collectLocalTypeNames(sourceFile: ts.SourceFile): Set<string> {
  const locals = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name) {
      locals.add(stmt.name.text);
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name) {
      locals.add(stmt.name.text);
    }
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      locals.add(stmt.name.text);
    }
    if (ts.isEnumDeclaration(stmt) && stmt.name) {
      locals.add(stmt.name.text);
    }
  }
  return locals;
}

/**
 * Collect type-only imports from source that are referenced by contract signatures.
 *
 * Walks AST type nodes to find type reference identifiers, then forwards matching
 * `import type` declarations. Value imports are never forwarded.
 *
 * Rejects source-local types (interface/type alias in the same file) with
 * a CompileError — they must be moved to an importable file.
 */
export function collectReferencedTypeImports(
  sourceFile: ts.SourceFile,
  contractTypeNodes: ts.TypeNode[],
): string[] {
  // Walk AST type nodes to collect referenced type identifiers
  const refs = collectTypeReferences(contractTypeNodes, sourceFile);
  const referencedIds = refs.identifiers;
  const nsQualifiers = refs.nsQualifiers;
  // Remove namespace-qualified members (Order in T.Order is resolved via namespace, not bare)
  for (const m of refs.nsMembers) {
    referencedIds.delete(m);
  }

  if (referencedIds.size === 0 && nsQualifiers.size === 0) {
    return [];
  }

  // Reject source-local types
  const localTypes = collectLocalTypeNames(sourceFile);
  for (const id of referencedIds) {
    if (localTypes.has(id)) {
      throw new CompileError(
        "E999",
        `Contract references source-local type '${id}'. Move it to an importable file and use 'import type'.`,
        1,
        1,
      );
    }
  }

  // Collect matching type-only imports
  const imports: string[] = [];
  const resolvedIds = new Set<string>();
  const resolvedNsQualifiers = new Set<string>();

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) {
      continue;
    }

    const clause = stmt.importClause;
    if (!clause) {
      continue;
    }

    const moduleSpecifier = (stmt.moduleSpecifier as ts.StringLiteral).text;

    // Only process type-only imports
    if (clause.isTypeOnly) {
      // Default import: import type Foo from "..."
      if (clause.name && referencedIds.has(clause.name.text)) {
        imports.push(`import type ${clause.name.text} from "${moduleSpecifier}";`);
        resolvedIds.add(clause.name.text);
      }

      // Namespace import: import type * as T from "..."
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        const nsName = clause.namedBindings.name.text;
        if (nsQualifiers.has(nsName)) {
          imports.push(`import type * as ${nsName} from "${moduleSpecifier}";`);
          resolvedNsQualifiers.add(nsName);
        }
        continue;
      }

      // Named import: import type { A, B } from "..."
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        const matchingSpecifiers = clause.namedBindings.elements.filter((el) =>
          referencedIds.has(el.name.text),
        );
        if (matchingSpecifiers.length > 0) {
          const names = matchingSpecifiers
            .map((el) =>
              el.propertyName ? `${el.propertyName.text} as ${el.name.text}` : el.name.text,
            )
            .join(", ");
          imports.push(`import type { ${names} } from "${moduleSpecifier}";`);
          for (const el of matchingSpecifiers) {
            resolvedIds.add(el.name.text);
          }
        }
      }
      continue;
    }

    // Mixed import: check for individual type-only specifiers
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      const typeSpecifiers = clause.namedBindings.elements.filter(
        (el) => el.isTypeOnly && referencedIds.has(el.name.text),
      );
      if (typeSpecifiers.length > 0) {
        const names = typeSpecifiers
          .map((el) =>
            el.propertyName ? `${el.propertyName.text} as ${el.name.text}` : el.name.text,
          )
          .join(", ");
        imports.push(`import type { ${names} } from "${moduleSpecifier}";`);
        for (const el of typeSpecifiers) {
          resolvedIds.add(el.name.text);
        }
      }
    }
  }

  // Reject unresolved namespace qualifiers
  for (const q of nsQualifiers) {
    if (!resolvedNsQualifiers.has(q)) {
      throw new CompileError(
        "E999",
        `Contract references namespace-qualified type '${q}.*' but no 'import type * as ${q}' was found in source`,
        1,
        1,
      );
    }
  }

  // Reject unresolved type references
  for (const id of referencedIds) {
    if (!resolvedIds.has(id)) {
      throw new CompileError(
        "E999",
        `Contract references type '${id}' which has no 'import type' declaration in source. Add 'import type { ${id} } from "..."' to the workflow source file.`,
        1,
        1,
      );
    }
  }

  return imports;
}

// ── Internal helpers ──

function validateFactoryParams(decl: ts.FunctionDeclaration, sourceFile: ts.SourceFile): boolean {
  const params = decl.parameters;

  if (params.length === 0) {
    return false;
  }

  if (params.length > 1) {
    const loc = getLocation(decl, sourceFile);
    throw new CompileError(
      "E999",
      `Ambient contract '${decl.name!.text}' must have zero or one parameter (instance?: string)`,
      loc.line,
      loc.column,
    );
  }

  const param = params[0]!;

  // Must be optional
  if (!param.questionToken) {
    const loc = getLocation(param, sourceFile);
    throw new CompileError(
      "E999",
      `Ambient contract factory parameter must be optional (instance?: string)`,
      loc.line,
      loc.column,
    );
  }

  // Must have a type annotation
  if (!param.type) {
    const loc = getLocation(param, sourceFile);
    throw new CompileError(
      "E999",
      `Ambient contract factory parameter must have a type annotation (instance?: string)`,
      loc.line,
      loc.column,
    );
  }

  // Must be typed as string
  if (param.type.kind !== ts.SyntaxKind.StringKeyword) {
    const loc = getLocation(param, sourceFile);
    throw new CompileError(
      "E999",
      `Ambient contract factory parameter must be typed as string`,
      loc.line,
      loc.column,
    );
  }

  return true;
}

function extractMethods(
  contractName: string,
  typeLiteral: ts.TypeLiteralNode,
  sourceFile: ts.SourceFile,
): { methods: ContractMethod[]; typeNodes: ts.TypeNode[] } {
  const methods: ContractMethod[] = [];
  const typeNodes: ts.TypeNode[] = [];

  for (const member of typeLiteral.members) {
    // Must be a method signature
    if (!ts.isMethodSignature(member)) {
      const loc = getLocation(member, sourceFile);
      throw new CompileError(
        "E999",
        `Ambient contract '${contractName}' type literal must contain only method signatures`,
        loc.line,
        loc.column,
      );
    }

    if (!member.name || !ts.isIdentifier(member.name)) {
      const loc = getLocation(member, sourceFile);
      throw new CompileError(
        "E999",
        `Ambient contract method must have an identifier name`,
        loc.line,
        loc.column,
      );
    }

    const methodName = member.name.text;

    // Extract return type — must be Workflow<T>
    const { resultType, typeArg } = extractWorkflowReturnType(
      contractName,
      methodName,
      member,
      sourceFile,
    );

    // Extract parameters — must have at least one (v1 restriction)
    const params = extractMethodParams(contractName, methodName, member, sourceFile);

    if (params.length === 0) {
      const loc = getLocation(member, sourceFile);
      throw new CompileError(
        "E999",
        `Ambient contract method '${contractName}.${methodName}' must have at least one parameter (v1 restriction)`,
        loc.line,
        loc.column,
      );
    }

    // Collect AST type nodes for import resolution
    for (const p of member.parameters) {
      if (p.type) {
        typeNodes.push(p.type);
      }
    }
    typeNodes.push(typeArg);

    methods.push({ name: methodName, params, resultType });
  }

  return { methods, typeNodes };
}

function extractWorkflowReturnType(
  contractName: string,
  methodName: string,
  member: ts.MethodSignature,
  sourceFile: ts.SourceFile,
): { resultType: string; typeArg: ts.TypeNode } {
  const returnType = member.type;

  if (!returnType) {
    const loc = getLocation(member, sourceFile);
    throw new CompileError(
      "E999",
      `Ambient contract method '${contractName}.${methodName}' must have a Workflow<T> return type`,
      loc.line,
      loc.column,
    );
  }

  // Must be Workflow<T>
  if (
    !ts.isTypeReferenceNode(returnType) ||
    !ts.isIdentifier(returnType.typeName) ||
    returnType.typeName.text !== "Workflow"
  ) {
    const loc = getLocation(returnType, sourceFile);
    throw new CompileError(
      "E999",
      `Ambient contract method '${contractName}.${methodName}' return type must be Workflow<T>`,
      loc.line,
      loc.column,
    );
  }

  if (!returnType.typeArguments || returnType.typeArguments.length !== 1) {
    const loc = getLocation(returnType, sourceFile);
    throw new CompileError(
      "E999",
      `Ambient contract method '${contractName}.${methodName}' Workflow must have exactly one type argument`,
      loc.line,
      loc.column,
    );
  }

  // Extract T as source text
  const typeArg = returnType.typeArguments[0]!;
  return { resultType: typeArg.getText(sourceFile), typeArg };
}

function extractMethodParams(
  contractName: string,
  methodName: string,
  member: ts.MethodSignature,
  sourceFile: ts.SourceFile,
): Array<{ name: string; type: string }> {
  const params: Array<{ name: string; type: string }> = [];

  for (const param of member.parameters) {
    if (!ts.isIdentifier(param.name)) {
      const loc = getLocation(param, sourceFile);
      throw new CompileError(
        "E999",
        `Ambient contract method '${contractName}.${methodName}' parameter must be a simple identifier`,
        loc.line,
        loc.column,
      );
    }

    const paramName = param.name.text;

    if (param.questionToken) {
      const loc = getLocation(param, sourceFile);
      throw new CompileError(
        "E999",
        `Ambient contract method '${contractName}.${methodName}' parameter '${paramName}' must not be optional (v1 restriction)`,
        loc.line,
        loc.column,
      );
    }

    if (param.dotDotDotToken) {
      const loc = getLocation(param, sourceFile);
      throw new CompileError(
        "E999",
        `Ambient contract method '${contractName}.${methodName}' parameter '${paramName}' must not be a rest parameter (v1 restriction)`,
        loc.line,
        loc.column,
      );
    }

    if (!param.type) {
      const loc = getLocation(param, sourceFile);
      throw new CompileError(
        "E999",
        `Ambient contract method '${contractName}.${methodName}' parameter '${paramName}' must have a type annotation`,
        loc.line,
        loc.column,
      );
    }

    const paramType = param.type.getText(sourceFile);
    params.push({ name: paramName, type: paramType });
  }

  return params;
}
