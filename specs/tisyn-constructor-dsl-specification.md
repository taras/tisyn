# Tisyn Constructor DSL Specification

**Version:** 0.1.0
**Implements:** Tisyn System Specification 1.0.0
**Complements:** Tisyn Authoring Layer Specification 0.3.0
**Status:** Draft

---

## 1. Overview

This document specifies a textual DSL for constructing Tisyn IR
by writing constructor-call expressions. The DSL is the inverse
of `print()`: every string that `print()` produces MUST be
accepted by the parser, and the parsed result MUST be
structurally identical to the IR that `print()` received.

The DSL exists to support a second IR-production pathway
alongside the TypeScript generator compiler. Where the compiler
lowers *authored source* into IR deterministically, the DSL
parser lowers *constructor-call text* into IR — text that may
be produced by an LLM, a code generator, a REPL, or any other
tool that can emit the constructor vocabulary.

### 1.1 Design Principles

**Constructors are the execution boundary.** The parser
recognizes constructor names and calls the real `@tisyn/ir`
constructor functions. It does NOT produce IR nodes directly.
This means every successfully parsed expression inherits the
structural guarantees of the constructors: correct
discriminants, correct Quote wrapping, correct data shapes.

**No code execution.** The parser is a recursive descent parser
over a fixed grammar. It MUST NOT use `eval()`,
`new Function()`, or any form of dynamic code execution. The
constructor vocabulary is closed: only names registered in the
constructor table are accepted.

**Parse, don't interpret.** The parser produces IR. It does not
evaluate IR, check scope, validate journal equivalence, or
enforce any runtime property. Those concerns belong to
`@tisyn/validate` and `@tisyn/kernel`. The parser's sole
responsibility is syntactic: transform text into the IR tree
that the constructors would produce if called directly.

**Recovery over rejection.** When the input is structurally
complete but missing closing delimiters (a common failure mode
for streaming LLM output), the parser SHOULD attempt auto-close
recovery before reporting failure. Recovery MUST be
conservative: it closes delimiters only when all semantic
content (constructor arguments) is present.

### 1.2 Correctness Criterion

For every `TisynExpr` value `E`:

````
parseDSL(print(E)).ir  ≡  E        (deep structural equality)
````

For every DSL string `S` that `parseDSL` accepts:

````
print(parseDSL(S).ir)  ≡  S'       (S' is a canonical form of S)
````

The second property is weaker because `print()` normalizes
whitespace and line breaks. The round-trip `print → parse →
print` MUST be idempotent: `print(parseDSL(print(E)).ir) ≡
print(E)`.

### 1.3 Non-Goals

The following are explicitly out of scope:

- **Type checking.** The DSL carries no type annotations. The
  `Expr<T>` phantom types from the authoring layer do not exist
  in DSL text.
- **Scope validation.** Whether a `Ref("x")` is bound is not
  the parser's concern.
- **Semantic validation.** The single-Quote rule, evaluation
  positions, and all Level 2+ validation belong to
  `@tisyn/validate`.
- **Streaming parse.** The current specification defines batch
  parsing. A streaming extension (parse token-by-token as LLM
  output arrives) is a future concern.
- **Macro constructors.** Shorthand forms that expand into base
  constructor trees (e.g., `Do` for Let chains, `AllBind` for
  destructured All results) are a planned extension. See §12
  for design notes and candidates. The current specification
  defines only the base constructor vocabulary.

### 1.4 Relationship to Other Components

| Component             | Relationship                                |
| --------------------- | ------------------------------------------- |
| `@tisyn/ir` print()   | Canonical serializer. Parser is its inverse. |
| `@tisyn/ir` constructors | Parser calls these. Never constructs IR directly. |
| `@tisyn/validate`     | Runs after parsing. Parser does not validate. |
| `@tisyn/compiler`     | Independent IR producer. Same IR, different source language. |
| `@tisyn/kernel`       | Consumes the IR. Does not know how it was produced. |

---

## 2. Lexical Grammar

### 2.1 Character Set

The input is a UTF-8 string. The tokenizer operates on Unicode
code points.

### 2.2 Whitespace

Whitespace characters are: space (U+0020), tab (U+0009),
carriage return (U+000D), line feed (U+000A). Whitespace is
insignificant — it separates tokens but carries no semantic
meaning. The tokenizer MUST skip whitespace between tokens and
MUST track line and column positions across line breaks for
error reporting.

### 2.3 Token Types

The tokenizer produces tokens of the following kinds:

| Kind        | Pattern                              | Examples                  |
| ----------- | ------------------------------------ | ------------------------- |
| `IDENT`     | `[a-zA-Z_][a-zA-Z0-9_]*`            | `Let`, `Ref`, `true`      |
| `STRING`    | `"` (escaped-content)* `"`          | `"hello"`, `"a\nb"`       |
| `NUMBER`    | `-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?` | `42`, `-7`, `3.14`, `1e10` |
| `LPAREN`    | `(`                                  |                           |
| `RPAREN`    | `)`                                  |                           |
| `LBRACKET`  | `[`                                  |                           |
| `RBRACKET`  | `]`                                  |                           |
| `LBRACE`    | `{`                                  |                           |
| `RBRACE`    | `}`                                  |                           |
| `COMMA`     | `,`                                  |                           |
| `COLON`     | `:`                                  |                           |
| `EOF`       | end of input                         |                           |

### 2.4 String Literals

String literals are delimited by double quotes (`"`). The
following escape sequences MUST be recognized within strings:

| Escape   | Meaning           |
| -------- | ----------------- |
| `\\`     | backslash         |
| `\"`     | double quote      |
| `\n`     | line feed         |
| `\t`     | tab               |
| `\r`     | carriage return   |
| `\/`     | forward slash     |
| `\b`     | backspace         |
| `\f`     | form feed         |
| `\uXXXX` | Unicode code point |

These escapes match the JSON string specification (RFC 8259
§7). The tokenizer MUST reject unterminated strings.

### 2.5 Number Literals

Number literals follow JSON number syntax: an optional leading
minus, one or more digits, an optional decimal fraction, and an
optional exponent. The tokenizer MUST parse the full number
token and store it as a string. The parser converts it to a
JavaScript `number` via `Number()`.

Leading plus signs are NOT permitted. Bare `.5` (without a
leading zero) is NOT permitted. These restrictions match JSON
number syntax.

### 2.6 Identifiers

Identifiers start with `[a-zA-Z_]` and continue with
`[a-zA-Z0-9_]`. Three identifiers are reserved keywords:
`true`, `false`, `null`. All other identifiers are constructor
names and MUST be followed by `(` to form a constructor call.

A bare identifier not followed by `(` and not a keyword is a
parse error. The error message SHOULD suggest `Ref("name")` as
the likely intended form.

### 2.7 Token Position Tracking

Every token MUST carry its source position:

````typescript
interface Token {
  kind: TokenKind;
  value: string;     // raw token text (decoded for strings)
  offset: number;    // UTF-16 code-unit offset from start of input
  line: number;      // 1-indexed line number
  column: number;    // 1-indexed column within line
}
````

Line numbers increment on each `\n`. Column numbers reset to 1
after each `\n`. Tab characters advance the column by 1 (not to
a tab stop). These positions are used in error messages fed
back to LLM producers.

### 2.8 Tokenizer Errors

The tokenizer MUST reject and report:

- Unterminated string literals.
- Characters not covered by any token pattern (e.g., `@`, `#`,
  `$`, `;`).

Tokenizer errors MUST include line and column.

---

## 3. Syntactic Grammar

### 3.1 Productions

The grammar has six productions. It is LL(1) — single-token
lookahead is sufficient for all parse decisions.

````
Expr        = Constructor
            | ArrayLit
            | ObjectLit
            | STRING
            | NUMBER
            | "true"
            | "false"
            | "null"

Constructor = IDENT "(" ArgList? ")"

ArgList     = Expr ("," Expr)*

ArrayLit    = "[" (Expr ("," Expr)* ","?)? "]"

ObjectLit   = "{" (Entry ("," Entry)* ","?)? "}"

Entry       = Key ":" Expr

Key         = IDENT | STRING
````

### 3.2 Disambiguation

The `IDENT` token appears in three roles:

1. **Constructor name.** `IDENT` followed by `LPAREN`.
2. **Keyword literal.** `IDENT` with value `true`, `false`, or
   `null`.
3. **Object key.** `IDENT` inside `ObjectLit` before `COLON`.

Disambiguation uses one-token lookahead:

- If the `IDENT` value is `true`, `false`, or `null`, it is a
  keyword literal.
- Else if the next token is `LPAREN`, it is a constructor name.
- Else if parsing inside an `ObjectLit` and the next token is
  `COLON`, it is an object key.
- Else it is a **parse error**. The error SHOULD suggest
  `Ref("name")`.

### 3.3 Trailing Commas

`ArrayLit` and `ObjectLit` MUST accept an optional trailing
comma before the closing delimiter. This accommodates multi-line
output from `print()` with `compact: false`.

`ArgList` MUST NOT accept trailing commas. Constructor argument
lists in `print()` output never have trailing commas.

### 3.4 Top-Level Structure

A valid DSL input is exactly one `Expr` followed by `EOF`. If
tokens remain after parsing the top-level `Expr`, the parser
MUST report an error.

---

## 4. Constructor Table

### 4.1 Purpose

The constructor table maps constructor names to their arity
constraints and dispatch functions. It is the closed vocabulary
of the DSL. Any `IDENT` not present in this table is rejected
as an unknown constructor.

### 4.2 Arity Constraints

Each constructor has a minimum and maximum argument count. The
parser MUST reject calls with fewer than the minimum or more
than the maximum. Variadic constructors have `maxArgs = ∞`.

### 4.3 Registry

| Constructor    | Min | Max | Dispatch                                 |
| -------------- | --- | --- | ---------------------------------------- |
| `Ref`          | 1   | 1   | `Ref(string)`                            |
| `Q`            | 1   | 1   | `Q(expr)`                                |
| `Fn`           | 2   | 2   | `Fn(string[], expr)`                     |
| `Let`          | 3   | 3   | `Let(string, expr, expr)`                |
| `If`           | 2   | 3   | `If(expr, expr, expr?)`                  |
| `While`        | 2   | 2   | `While(expr, expr[])`                    |
| `Call`         | 1   | ∞   | `Call(expr, ...expr[])`                  |
| `Get`          | 2   | 2   | `Get(expr, string)`                      |
| `Seq`          | 0   | ∞   | `Seq(...expr[])`                         |
| `Add`          | 2   | 2   | `Add(expr, expr)`                        |
| `Sub`          | 2   | 2   | `Sub(expr, expr)`                        |
| `Mul`          | 2   | 2   | `Mul(expr, expr)`                        |
| `Div`          | 2   | 2   | `Div(expr, expr)`                        |
| `Mod`          | 2   | 2   | `Mod(expr, expr)`                        |
| `Neg`          | 1   | 1   | `Neg(expr)`                              |
| `Gt`           | 2   | 2   | `Gt(expr, expr)`                         |
| `Gte`          | 2   | 2   | `Gte(expr, expr)`                        |
| `Lt`           | 2   | 2   | `Lt(expr, expr)`                         |
| `Lte`          | 2   | 2   | `Lte(expr, expr)`                        |
| `Eq`           | 2   | 2   | `Eq(expr, expr)`                         |
| `Neq`          | 2   | 2   | `Neq(expr, expr)`                        |
| `And`          | 2   | 2   | `And(expr, expr)`                        |
| `Or`           | 2   | 2   | `Or(expr, expr)`                         |
| `Not`          | 1   | 1   | `Not(expr)`                              |
| `Construct`    | 1   | 1   | `Construct(object)`                      |
| `Arr`          | 0   | ∞   | `Arr(...expr[])`                         |
| `Concat`       | 0   | ∞   | `Concat(...expr[])`                      |
| `ConcatArrays` | 0   | ∞   | `ConcatArrays(...expr[])`                |
| `MergeObjects` | 0   | ∞   | `MergeObjects(...expr[])`                |
| `Throw`        | 1   | 1   | `Throw(expr)`                            |
| `Eval`         | 2   | 2   | `Eval(string, expr)`                     |
| `All`          | 0   | ∞   | `All(...expr[])`                         |
| `Race`         | 0   | ∞   | `Race(...expr[])`                        |

### 4.4 Argument Routing

The dispatch function receives a flat array of parsed `Expr`
values. It MUST route arguments to the correct positional
parameters of the underlying `@tisyn/ir` constructor.

For constructors where `print()` unwraps intermediate structure
(e.g., `Let` prints as `Let(name, value, body)` but the
constructor internally builds
`{ tisyn: "eval", id: "let", data: Q({ name, value, body }) }`),
the dispatch function calls the real constructor with the
positional arguments. The constructor handles all internal
wrapping. The parser MUST NOT construct Quote nodes, Eval nodes,
or any IR structure directly.

### 4.5 Extensibility

The constructor table MUST be a static mapping defined at module
scope. It MUST NOT be configurable at runtime, accept external
registrations, or load constructors dynamically. To add a new
constructor to the DSL, the table and the `@tisyn/ir`
constructors must be updated together.

If a future Tisyn version adds new constructor functions to
`@tisyn/ir`, the constructor table MUST be updated to include
them. The parser version MUST be incremented on any table
change.

The constructors in §4.3 are **base constructors**: each maps
directly to a single `@tisyn/ir` constructor function. A future
extension (§12) may introduce **macro constructors** that expand
into trees of base constructor calls. If implemented, macro
constructors MUST be registered in a separate section of the
table, clearly distinguished from base constructors. The base
table in §4.3 MUST NOT be modified to accommodate macros.

---

## 5. Semantic Constraints

### 5.1 Argument Type Expectations

Some constructors expect arguments of specific JSON types.
These expectations are enforced by the dispatch function at
parse time:

| Constructor | Argument   | Expected type | Error if wrong          |
| ----------- | ---------- | ------------- | ----------------------- |
| `Ref`       | arg 0      | `string`      | "Ref requires a string" |
| `Let`       | arg 0      | `string`      | "Let name must be a string" |
| `Get`       | arg 1      | `string`      | "Get key must be a string" |
| `Eval`      | arg 0      | `string`      | "Eval id must be a string" |
| `Fn`        | arg 0      | `string[]`    | "Fn params must be a string array" |
| `While`     | arg 1      | `array`       | "While body must be an array" |
| ~~`Call`~~  | ~~arg 1~~  | ~~`array`~~   | ~~removed: Call is variadic~~ |

These checks catch common LLM mistakes early. They are NOT
type-system enforcement — they verify that the argument shape
is one the constructor can accept.

### 5.2 Constructor Output Invariant

For every successful parse of a constructor call
`Name(arg₁, ..., argₙ)`, the result MUST be identical to
calling the corresponding `@tisyn/ir` constructor function with
the same arguments:

````
parse("Name(a₁, ..., aₙ)")  ≡  Name(parse("a₁"), ..., parse("aₙ"))
````

This is guaranteed by construction: the parser calls the real
constructor.

---

## 6. Error Model

### 6.1 Error Type

````typescript
class DSLParseError extends Error {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}
````

Every parse error MUST include the line, column, and byte offset
of the token where the error was detected. The `message` MUST
include the line and column in human-readable form:
`"message (line N, col M)"`.

### 6.2 Error Categories

The parser produces errors in four categories:

**Lexical errors.** Produced by the tokenizer.

- Unterminated string literal.
- Unexpected character.

**Syntactic errors.** Produced by the parser.

- Unexpected token (expected X, got Y).
- Trailing tokens after top-level expression.

**Constructor errors.** Produced during constructor dispatch.

- Unknown constructor name.
- Arity violation (too few or too many arguments).
- Argument type mismatch (§5.1).

**EOF errors.** Produced when input ends mid-expression.

- These are the primary trigger for auto-close recovery (§7).
- The error MUST carry a `RecoveryInfo` object (§7.2).

### 6.3 Error Messages for LLM Feedback

Error messages MUST be written to be actionable by an LLM
producer. Specifically:

- Unknown constructor errors MUST list all available constructor
  names.
- Arity errors MUST state the expected range and the actual
  count.
- Bare identifier errors MUST suggest the `Ref("name")` form.
- EOF errors MUST describe what was expected and what frames
  are open.

### 6.4 Single Error Reporting

The parser reports the first error encountered and stops. It
does NOT attempt error recovery beyond the auto-close mechanism
in §7. Partial parse results are NOT returned on failure.

---

## 7. Auto-Close Recovery

### 7.1 Motivation

When an LLM generates constructor DSL text via streaming, the
output may be truncated — the LLM's token budget expires or the
stream is interrupted. The most common truncation mode leaves
all semantic content intact but omits trailing closing
delimiters: `)`, `]`, `}`.

Auto-close recovery detects this specific failure mode and
repairs it.

### 7.2 Recovery Information

When the parser encounters EOF mid-expression, it MUST compute
a `RecoveryInfo` structure:

````typescript
interface RecoveryInfo {
  expected: string;
  frameStack: FrameInfo[];
  unclosedParens: number;
  unclosedBrackets: number;
  unclosedBraces: number;
  autoClosable: boolean;
}

interface FrameInfo {
  constructor: string;
  argsReceived: number;
  minArgs: number;
  maxArgs: number;
}
````

### 7.3 Frame Stack

The parser MUST maintain a frame stack during parsing. A frame
is pushed when a constructor call's `LPAREN` is consumed and
popped when its `RPAREN` is consumed. Each frame tracks:

- The constructor name.
- The number of arguments received so far.
- The constructor's minimum and maximum arity (from the table).

The frame stack is also used for delimiter depth tracking:
`LPAREN`/`RPAREN` increment/decrement `parenDepth`;
`LBRACKET`/`RBRACKET` increment/decrement `bracketDepth`;
`LBRACE`/`RBRACE` increment/decrement `braceDepth`.

### 7.4 Auto-Closable Condition

Input is **auto-closable** if and only if ALL of the following
hold:

1. Every frame in the frame stack has received at least its
   minimum number of arguments
   (`argsReceived >= minArgs` for all frames).
2. `unclosedParens >= 0`, `unclosedBrackets >= 0`,
   `unclosedBraces >= 0`.
3. No frame is in the middle of parsing an argument expression
   (the current parse position is at a point where a closing
   delimiter would be syntactically valid).

If the input is auto-closable, the recovery mechanism appends
the missing closing delimiters in reverse stack order and
re-parses.

### 7.5 Auto-Close Algorithm

````
tryAutoClose(source):
  tokens = tokenize(source)
  stack = []
  for tok in tokens:
    if tok is LPAREN:  push "("
    if tok is LBRACKET: push "["
    if tok is LBRACE:  push "{"
    if tok is RPAREN:
      if stack is empty or top ≠ "(": return null
      pop stack
    if tok is RBRACKET:
      if stack is empty or top ≠ "[": return null
      pop stack
    if tok is RBRACE:
      if stack is empty or top ≠ "{": return null
      pop stack

  if stack is empty: return source   // already balanced

  suffix = reverse(stack).map(opener → closer)
  repaired = source + suffix

  result = parseDSL(repaired)
  if result.ok: return repaired
  return null                        // semantic content missing
````

The final re-parse is essential: it catches cases where the
delimiters balance but the semantic content is incomplete (e.g.,
`Let("x", Add(1, 2))` — closing is balanced but `Let` needs a
third argument). If re-parse fails, auto-close MUST NOT return
the repaired string.

### 7.6 Limitations

Auto-close MUST NOT:

- Invent missing arguments. If `Let` has received 2 of 3
  arguments, auto-close cannot supply the third.
- Insert commas. If the LLM omitted a comma between arguments,
  that is a syntactic error, not a truncation.
- Guess constructor names. If the stream stopped mid-identifier,
  auto-close cannot complete it.

---

## 8. Public API

### 8.1 `parseDSL`

````typescript
function parseDSL(source: string): ParseResult;

type ParseResult = ParseSuccess | ParseFailure;

interface ParseSuccess {
  ok: true;
  ir: TisynExpr;
}

interface ParseFailure {
  ok: false;
  error: DSLParseError;
  recovery?: RecoveryInfo;
}
````

Parses a DSL string and returns a discriminated result. MUST
NOT throw. All parse errors are returned in the `error` field.

### 8.2 `parseDSLOrThrow`

````typescript
function parseDSLOrThrow(source: string): TisynExpr;
````

Convenience wrapper. Calls `parseDSL` and throws on failure.
For use in tests and trusted contexts.

### 8.3 `parseDSLWithRecovery`

````typescript
function parseDSLWithRecovery(
  source: string,
): ParseResult & { repaired?: string };
````

Attempts `parseDSL` first. If it fails, attempts auto-close
recovery (§7). If recovery succeeds, returns `{ ok: true,
ir, repaired }` where `repaired` is the auto-closed source
string. If recovery fails, returns the original parse failure.

This is the recommended entry point for LLM-generated input.

### 8.4 `tryAutoClose`

````typescript
function tryAutoClose(source: string): string | null;
````

Attempts to close unbalanced delimiters. Returns the repaired
string if successful, `null` if repair is not possible. Does
NOT parse the result — callers should pass the returned string
to `parseDSL` for validation.

Exposed as a utility for tooling. Not required for normal
parsing.

---

## 9. Integration

### 9.1 LLM-Produced IR Pipeline

The intended pipeline for LLM-generated IR is:

````
LLM generates constructor DSL text
  → parseDSLWithRecovery()
  → if ok: validateIr(ir)
  → if valid: kernel evaluates with full durability
  → if parse failed: feed error.message back to LLM
  → if validation failed: feed validation errors back to LLM
````

The parser produces IR. Validation checks it. The kernel
executes it. Each stage is independent and has a single
responsibility.

### 9.2 LLM Prompt Context

When using the DSL as an LLM output format, the prompt SHOULD
include:

- The constructor table (§4.3) with arities.
- The available agent IDs and their method signatures.
- One or two example programs in DSL syntax.
- The instruction that bare variable references must use
  `Ref("name")`, not bare `name`.

The prompt SHOULD NOT include:

- IR JSON syntax. The constructors handle all JSON structure.
- Quote wrapping rules. The constructors handle Quote.
- The `tisyn` discriminant. The constructors handle it.

### 9.3 Relationship to `print()`

The parser and `print()` are inverses. Changes to `print()`'s
output format MUST be reflected in the parser. Changes to the
parser's accepted syntax that go beyond `print()`'s output
format (e.g., accepting single-quoted strings, accepting
trailing commas in argument lists) MUST be documented as
parser extensions and MUST NOT be relied upon by `print()`.

### 9.4 Relationship to the Compiler

The compiler and the DSL parser are independent IR producers.
They share no code. IR produced by either pathway enters the
same validation and execution pipeline. The kernel does not
know and MUST NOT need to know which producer created the IR
it evaluates.

````
@tisyn/compiler  ──→ TisynExpr ──→ @tisyn/validate ──→ @tisyn/kernel
@tisyn/dsl ──→ TisynExpr ──→ @tisyn/validate ──→ @tisyn/kernel
````

### 9.5 Security Boundary

The parser accepts untrusted input. It MUST NOT execute
arbitrary code, access the file system, make network requests,
or perform any side effect beyond allocating memory for the
parse result. The constructor functions it calls are pure
functions that return plain objects.

Input from an LLM is untrusted by definition. The parser is
the first line of defense. `@tisyn/validate` is the second.
The kernel's evaluation rules are the third.

---

## 10. Conformance

### 10.1 Round-Trip Property

An implementation conforms to this specification if and only if
for every `TisynExpr` value `E` accepted by `validateIr`:

````
parseDSL(print(E)).ok === true
parseDSL(print(E)).ir  ≡  E       (deep structural equality)
````

### 10.2 Auto-Close Property

For every DSL string `S` where `parseDSLWithRecovery(S)` returns
`{ ok: true, repaired: R }`:

````
parseDSL(R).ok === true
parseDSL(R).ir  ≡  parseDSLWithRecovery(S).ir
````

### 10.3 Error Position Property

For every DSL string `S` where `parseDSL(S)` returns
`{ ok: false, error: E }`:

````
E.line ≥ 1
E.column ≥ 1
E.offset ≥ 0
E.offset ≤ S.length
````

### 10.4 Vocabulary Closure Property

For every DSL string `S` where `parseDSL(S)` returns
`{ ok: true }`:

Every constructor name that appeared in `S` MUST be present
in the constructor table (§4.3). No constructor call in `S`
may invoke a function outside this table.

---

## 11. Conformance Test Suite

### 11.1 Purpose

This section defines the normative conformance fixtures for the
constructor DSL parser. An implementation conforms to this
specification if and only if it passes all Core tier fixtures.

### 11.2 Fixture Schema

````typescript
interface DSLFixture {
  id: string;                  // e.g. "DSL-001"
  suite_version: string;       // matches spec version
  tier: "core" | "extended";
  category: string;            // dotted path
  spec_ref: string;            // section reference
  description: string;

  // Exactly one of:
  type: "round_trip"           // input parses to expected IR
      | "parse_only"           // input parses successfully (IR not checked)
      | "negative_parse"       // input must be rejected
      | "auto_close"           // truncated input recovered
      | "auto_close_fail";     // truncated input cannot be recovered
}

interface RoundTripFixture extends DSLFixture {
  type: "round_trip";
  input: string;               // DSL text
  expected_ir: TisynExpr;      // deep-equal comparison target
}

interface ParseOnlyFixture extends DSLFixture {
  type: "parse_only";
  input: string;
}

interface NegativeParseFixture extends DSLFixture {
  type: "negative_parse";
  input: string;
  expected_error: string;      // substring match on error message
}

interface AutoCloseFixture extends DSLFixture {
  type: "auto_close";
  input: string;               // truncated DSL text
  expected_repaired: string;   // auto-closed form
  expected_ir: TisynExpr;      // IR from repaired parse
}

interface AutoCloseFailFixture extends DSLFixture {
  type: "auto_close_fail";
  input: string;               // truncated DSL text
  expected_error: string;      // substring match
}
````

### 11.3 Fixture Categories

| Category prefix        | Tests                                    |
| ---------------------- | ---------------------------------------- |
| `literal.*`            | Literal value parsing                    |
| `constructor.*`        | Constructor call syntax and dispatch     |
| `roundtrip.*`          | print() → parse → identical IR           |
| `arity.*`              | Argument count enforcement               |
| `recovery.*`           | Auto-close and truncation handling        |
| `error.*`              | Error message quality and positions      |
| `edge.*`               | Boundary conditions and corner cases     |

### 11.4 Core Fixtures — Literals

**DSL-001: Integer literal**

| Field          | Value                        |
| -------------- | ---------------------------- |
| id             | DSL-001                      |
| tier           | core                         |
| category       | literal.number               |
| spec_ref       | dsl.2.5                      |
| type           | round_trip                   |
| input          | `42`                         |
| expected_ir    | `42`                         |

**DSL-002: Negative number**

| Field          | Value                        |
| -------------- | ---------------------------- |
| id             | DSL-002                      |
| tier           | core                         |
| category       | literal.number               |
| spec_ref       | dsl.2.5                      |
| type           | round_trip                   |
| input          | `-7`                         |
| expected_ir    | `-7`                         |

**DSL-003: Float**

| Field          | Value                        |
| -------------- | ---------------------------- |
| id             | DSL-003                      |
| tier           | core                         |
| category       | literal.number               |
| spec_ref       | dsl.2.5                      |
| type           | round_trip                   |
| input          | `3.14`                       |
| expected_ir    | `3.14`                       |

**DSL-004: String literal**

| Field          | Value                        |
| -------------- | ---------------------------- |
| id             | DSL-004                      |
| tier           | core                         |
| category       | literal.string               |
| spec_ref       | dsl.2.4                      |
| type           | round_trip                   |
| input          | `"hello"`                    |
| expected_ir    | `"hello"`                    |

**DSL-005: String with escape sequences**

| Field          | Value                        |
| -------------- | ---------------------------- |
| id             | DSL-005                      |
| tier           | core                         |
| category       | literal.string               |
| spec_ref       | dsl.2.4                      |
| type           | round_trip                   |
| input          | `"a\nb"`                     |
| expected_ir    | `"a\nb"`                     |

**DSL-006: Boolean true**

| Field          | Value                        |
| -------------- | ---------------------------- |
| id             | DSL-006                      |
| tier           | core                         |
| category       | literal.boolean              |
| spec_ref       | dsl.2.6                      |
| type           | round_trip                   |
| input          | `true`                       |
| expected_ir    | `true`                       |

**DSL-007: Boolean false**

| Field          | Value                        |
| -------------- | ---------------------------- |
| id             | DSL-007                      |
| tier           | core                         |
| category       | literal.boolean              |
| spec_ref       | dsl.2.6                      |
| type           | round_trip                   |
| input          | `false`                      |
| expected_ir    | `false`                      |

**DSL-008: Null**

| Field          | Value                        |
| -------------- | ---------------------------- |
| id             | DSL-008                      |
| tier           | core                         |
| category       | literal.null                 |
| spec_ref       | dsl.2.6                      |
| type           | round_trip                   |
| input          | `null`                       |
| expected_ir    | `null`                       |

**DSL-009: Empty array**

| Field          | Value                        |
| -------------- | ---------------------------- |
| id             | DSL-009                      |
| tier           | core                         |
| category       | literal.array                |
| spec_ref       | dsl.3.1                      |
| type           | round_trip                   |
| input          | `[]`                         |
| expected_ir    | `[]`                         |

**DSL-010: Array of mixed literals**

| Field          | Value                        |
| -------------- | ---------------------------- |
| id             | DSL-010                      |
| tier           | core                         |
| category       | literal.array                |
| spec_ref       | dsl.3.1                      |
| type           | round_trip                   |
| input          | `[1, "two", true, null]`     |
| expected_ir    | `[1, "two", true, null]`     |

### 11.5 Core Fixtures — Simple Constructors

**DSL-020: Ref**

| Field          | Value                        |
| -------------- | ---------------------------- |
| id             | DSL-020                      |
| tier           | core                         |
| category       | constructor.ref              |
| spec_ref       | dsl.4.3                      |
| type           | round_trip                   |
| input          | `Ref("x")`                   |
| expected_ir    | `{ tisyn: "ref", name: "x" }` |

**DSL-021: Add**

| Field          | Value                                                     |
| -------------- | --------------------------------------------------------- |
| id             | DSL-021                                                   |
| tier           | core                                                      |
| category       | constructor.binary                                        |
| spec_ref       | dsl.4.3                                                   |
| type           | round_trip                                                |
| input          | `Add(1, 2)`                                               |
| expected_ir    | `{ tisyn: "eval", id: "add", data: Q({ a: 1, b: 2 }) }`  |

**DSL-022: Not**

| Field          | Value                                                      |
| -------------- | ---------------------------------------------------------- |
| id             | DSL-022                                                    |
| tier           | core                                                       |
| category       | constructor.unary                                          |
| spec_ref       | dsl.4.3                                                    |
| type           | round_trip                                                 |
| input          | `Not(true)`                                                |
| expected_ir    | `{ tisyn: "eval", id: "not", data: Q({ a: true }) }`      |

**DSL-023: Throw**

| Field          | Value                                                           |
| -------------- | --------------------------------------------------------------- |
| id             | DSL-023                                                         |
| tier           | core                                                            |
| category       | constructor.throw                                               |
| spec_ref       | dsl.4.3                                                         |
| type           | round_trip                                                      |
| input          | `Throw("bad")`                                                  |
| expected_ir    | `{ tisyn: "eval", id: "throw", data: Q({ message: "bad" }) }`  |

### 11.6 Core Fixtures — Nested Constructors

**DSL-030: Let + Ref**

| Field          | Value                                              |
| -------------- | -------------------------------------------------- |
| id             | DSL-030                                            |
| tier           | core                                               |
| category       | roundtrip.let                                      |
| spec_ref       | dsl.4.3, dsl.10.1                                  |
| type           | round_trip                                         |
| input          | `Let("x", 1, Ref("x"))`                           |
| expected_ir    | `Let("x", 1, Ref("x"))` — constructor output      |

Note: `expected_ir` is the result of calling the real `Let`
constructor. Fixture implementations MUST call the constructor
to produce the comparison target, not hand-write the JSON.

**DSL-031: If with else**

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| id             | DSL-031                                |
| tier           | core                                   |
| category       | roundtrip.if                           |
| spec_ref       | dsl.4.3                                |
| type           | round_trip                             |
| input          | `If(Eq(1, 2), "yes", "no")`           |
| expected_ir    | `If(Eq(1, 2), "yes", "no")`           |

**DSL-032: If without else**

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| id             | DSL-032                                |
| tier           | core                                   |
| category       | roundtrip.if                           |
| spec_ref       | dsl.4.3                                |
| type           | round_trip                             |
| input          | `If(true, 1)`                          |
| expected_ir    | `If(true, 1)`                          |

**DSL-033: Nested binary ops**

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| id             | DSL-033                                |
| tier           | core                                   |
| category       | roundtrip.nested                       |
| spec_ref       | dsl.4.3                                |
| type           | round_trip                             |
| input          | `Add(Add(1, 2), 3)`                   |
| expected_ir    | `Add(Add(1, 2), 3)`                   |

### 11.7 Core Fixtures — External Effects

**DSL-040: Eval with Ref payload**

| Field          | Value                                          |
| -------------- | ---------------------------------------------- |
| id             | DSL-040                                        |
| tier           | core                                           |
| category       | roundtrip.eval                                 |
| spec_ref       | dsl.4.3                                        |
| type           | round_trip                                     |
| input          | `Eval("svc.op", Ref("x"))`                    |
| expected_ir    | `Eval("svc.op", Ref("x"))`                    |

**DSL-041: Eval with array payload**

| Field          | Value                                          |
| -------------- | ---------------------------------------------- |
| id             | DSL-041                                        |
| tier           | core                                           |
| category       | roundtrip.eval                                 |
| spec_ref       | dsl.4.3                                        |
| type           | round_trip                                     |
| input          | `Eval("svc.op", [Ref("x"), 42])`              |
| expected_ir    | `Eval("svc.op", [Ref("x"), 42])`              |

**DSL-042: Eval with null payload**

| Field          | Value                                          |
| -------------- | ---------------------------------------------- |
| id             | DSL-042                                        |
| tier           | core                                           |
| category       | roundtrip.eval                                 |
| spec_ref       | dsl.4.3                                        |
| type           | round_trip                                     |
| input          | `Eval("svc.op", null)`                         |
| expected_ir    | `Eval("svc.op", null)`                         |

### 11.8 Core Fixtures — Compound and Data

**DSL-050: All**

| Field          | Value                                                      |
| -------------- | ---------------------------------------------------------- |
| id             | DSL-050                                                    |
| tier           | core                                                       |
| category       | roundtrip.compound                                         |
| spec_ref       | dsl.4.3                                                    |
| type           | round_trip                                                 |
| input          | `All(Eval("a.b", null), Eval("c.d", null))`               |
| expected_ir    | `All(Eval("a.b", null), Eval("c.d", null))`               |

**DSL-051: Race**

| Field          | Value                                                      |
| -------------- | ---------------------------------------------------------- |
| id             | DSL-051                                                    |
| tier           | core                                                       |
| category       | roundtrip.compound                                         |
| spec_ref       | dsl.4.3                                                    |
| type           | round_trip                                                 |
| input          | `Race(Eval("a.b", null), Eval("c.d", null))`              |
| expected_ir    | `Race(Eval("a.b", null), Eval("c.d", null))`              |

**DSL-052: Arr**

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| id             | DSL-052                                |
| tier           | core                                   |
| category       | roundtrip.data                         |
| spec_ref       | dsl.4.3                                |
| type           | round_trip                             |
| input          | `Arr(1, 2, 3)`                         |
| expected_ir    | `Arr(1, 2, 3)`                         |

**DSL-053: Construct**

| Field          | Value                                            |
| -------------- | ------------------------------------------------ |
| id             | DSL-053                                          |
| tier           | core                                             |
| category       | roundtrip.data                                   |
| spec_ref       | dsl.4.3                                          |
| type           | round_trip                                       |
| input          | `Construct({ name: "test", value: 42 })`        |
| expected_ir    | `Construct({ name: "test", value: 42 })`        |

### 11.9 Core Fixtures — Fn and Call

**DSL-060: Fn with body**

| Field          | Value                                         |
| -------------- | --------------------------------------------- |
| id             | DSL-060                                       |
| tier           | core                                          |
| category       | roundtrip.fn                                  |
| spec_ref       | dsl.4.3                                       |
| type           | round_trip                                    |
| input          | `Fn(["x"], Add(Ref("x"), 1))`                |
| expected_ir    | `Fn(["x"], Add(Ref("x"), 1))`                |

**DSL-061: Let + Fn + Call**

| Field       | Value                                                         |
| ----------- | ------------------------------------------------------------- |
| id          | DSL-061                                                       |
| tier        | core                                                          |
| category    | roundtrip.call                                                |
| spec_ref    | dsl.4.3                                                       |
| type        | round_trip                                                    |
| input       | `Let("f", Fn(["x"], Add(Ref("x"), 1)), Call(Ref("f"), [42]))` |
| expected_ir | `Let("f", Fn(["x"], Add(Ref("x"), 1)), Call(Ref("f"), [42]))` |

### 11.10 Core Fixtures — Complex Workflow

**DSL-070: Poll-job pattern**

| Field       | Value |
| ----------- | ----- |
| id          | DSL-070 |
| tier        | core |
| category    | roundtrip.workflow |
| spec_ref    | dsl.10.1 |
| type        | round_trip |
| description | Full poll-job workflow from Authoring Layer Spec Appendix A |

Input (multi-line):
````
Fn(["jobId"],
  Let("config",
    Eval("config-service.getRetryConfig", []),
    Let("__loop_0",
      Fn([],
        Let("status",
          Eval("job-service.checkStatus", [Ref("jobId")]),
          If(
            Eq(Get(Ref("status"), "state"), "complete"),
            Eval("job-service.getResult", [Ref("jobId")]),
            If(
              Eq(Get(Ref("status"), "state"), "failed"),
              Throw("Job failed"),
              Let("__discard_0",
                Eval("sleep", [Get(Ref("config"), "intervalMs")]),
                Call(Ref("__loop_0"), [])))))),
      Call(Ref("__loop_0"), []))))
````

Expected IR: The result of calling the equivalent nested
constructor expression. Implementations MUST produce the
comparison target by calling the constructors, not by
hand-writing JSON.

### 11.11 Core Fixtures — Arity Enforcement

**DSL-080: Too few args for Let**

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| id             | DSL-080                                   |
| tier           | core                                      |
| category       | arity.under                               |
| spec_ref       | dsl.4.2                                   |
| type           | negative_parse                            |
| input          | `Let("x", 1)`                             |
| expected_error | `at least 3`                              |

**DSL-081: Too many args for Add**

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| id             | DSL-081                                   |
| tier           | core                                      |
| category       | arity.over                                |
| spec_ref       | dsl.4.2                                   |
| type           | negative_parse                            |
| input          | `Add(1, 2, 3)`                            |
| expected_error | `at most 2`                               |

**DSL-082: Too few args for Ref**

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| id             | DSL-082                                   |
| tier           | core                                      |
| category       | arity.under                               |
| spec_ref       | dsl.4.2                                   |
| type           | negative_parse                            |
| input          | `Ref()`                                   |
| expected_error | `at least 1`                              |

### 11.12 Core Fixtures — Error Diagnostics

**DSL-090: Unknown constructor**

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| id             | DSL-090                                   |
| tier           | core                                      |
| category       | error.unknown                             |
| spec_ref       | dsl.6.3                                   |
| type           | negative_parse                            |
| input          | `Foo(1, 2)`                               |
| expected_error | `Unknown constructor`                     |

**DSL-091: Bare identifier suggests Ref**

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| id             | DSL-091                                   |
| tier           | core                                      |
| category       | error.bare_ident                          |
| spec_ref       | dsl.2.6, dsl.6.3                          |
| type           | negative_parse                            |
| input          | `orderId`                                 |
| expected_error | `Ref("orderId")`                          |

**DSL-092: Unterminated string**

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| id             | DSL-092                                   |
| tier           | core                                      |
| category       | error.lexical                             |
| spec_ref       | dsl.2.8                                   |
| type           | negative_parse                            |
| input          | `Ref("hello`                              |
| expected_error | (any — implementation-defined message)     |

**DSL-093: Unexpected character**

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| id             | DSL-093                                   |
| tier           | core                                      |
| category       | error.lexical                             |
| spec_ref       | dsl.2.8                                   |
| type           | negative_parse                            |
| input          | `Add(1 @ 2)`                              |
| expected_error | `Unexpected character`                    |

**DSL-094: Trailing tokens after expression**

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| id             | DSL-094                                   |
| tier           | core                                      |
| category       | error.trailing                            |
| spec_ref       | dsl.3.4                                   |
| type           | negative_parse                            |
| input          | `Add(1, 2) Add(3, 4)`                     |
| expected_error | `Unexpected token`                        |

**DSL-095: Error position is accurate**

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| id             | DSL-095                                   |
| tier           | core                                      |
| category       | error.position                            |
| spec_ref       | dsl.6.1, dsl.10.3                         |
| type           | negative_parse                            |
| input          | `Let("x",\n  1,\n  @@@)`                 |
| expected_error | (any — but error.line MUST be 3)           |

### 11.13 Core Fixtures — Auto-Close Recovery

**DSL-100: Trailing parens closed**

| Field             | Value                                    |
| ----------------- | ---------------------------------------- |
| id                | DSL-100                                  |
| tier              | core                                     |
| category          | recovery.paren                           |
| spec_ref          | dsl.7.4, dsl.7.5                         |
| type              | auto_close                               |
| input             | `Let("x", Add(1, 2), Ref("x")`          |
| expected_repaired | `Let("x", Add(1, 2), Ref("x"))`         |
| expected_ir       | `Let("x", Add(1, 2), Ref("x"))`         |

**DSL-101: Nested parens and brackets closed**

| Field             | Value                                    |
| ----------------- | ---------------------------------------- |
| id                | DSL-101                                  |
| tier              | core                                     |
| category          | recovery.mixed                           |
| spec_ref          | dsl.7.4, dsl.7.5                         |
| type              | auto_close                               |
| input             | `Eval("svc.op", [Ref("x"), 42`          |
| expected_repaired | `Eval("svc.op", [Ref("x"), 42])`        |
| expected_ir       | `Eval("svc.op", [Ref("x"), 42])`        |

**DSL-102: Deeply nested recovery**

| Field             | Value                                              |
| ----------------- | -------------------------------------------------- |
| id                | DSL-102                                            |
| tier              | core                                               |
| category          | recovery.deep                                      |
| spec_ref          | dsl.7.4, dsl.7.5                                   |
| type              | auto_close                                         |
| input             | `Let("a", 1, Let("b", 2, Add(Ref("a"), Ref("b")`  |
| expected_repaired | `Let("a", 1, Let("b", 2, Add(Ref("a"), Ref("b"))))` |
| expected_ir       | `Let("a", 1, Let("b", 2, Add(Ref("a"), Ref("b"))))` |

**DSL-110: Cannot recover missing semantic content**

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| id             | DSL-110                                   |
| tier           | core                                      |
| category       | recovery.fail                             |
| spec_ref       | dsl.7.6                                   |
| type           | auto_close_fail                           |
| input          | `Let("x", Add(1, 2)`                     |
| expected_error | `at least 3`                              |

**DSL-111: Cannot recover mismatched delimiters**

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| id             | DSL-111                                   |
| tier           | core                                      |
| category       | recovery.fail                             |
| spec_ref       | dsl.7.5                                   |
| type           | auto_close_fail                           |
| input          | `Add(1, 2]`                               |
| expected_error | (any — mismatched delimiter)               |

**DSL-112: Already balanced input passes through**

| Field             | Value                            |
| ----------------- | -------------------------------- |
| id                | DSL-112                          |
| tier              | core                             |
| category          | recovery.noop                    |
| spec_ref          | dsl.7.5                          |
| type              | auto_close                       |
| input             | `Add(1, 2)`                      |
| expected_repaired | `Add(1, 2)`                      |
| expected_ir       | `Add(1, 2)`                      |

### 11.14 Extended Fixtures — Edge Cases

**DSL-200: Empty string value**

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| id             | DSL-200                                |
| tier           | extended                               |
| category       | edge.string                            |
| spec_ref       | dsl.2.4                                |
| type           | round_trip                             |
| input          | `""`                                   |
| expected_ir    | `""`                                   |

**DSL-201: String with unicode escape**

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| id             | DSL-201                                |
| tier           | extended                               |
| category       | edge.string                            |
| spec_ref       | dsl.2.4                                |
| type           | round_trip                             |
| input          | `"\u0041"`                             |
| expected_ir    | `"A"`                                  |

**DSL-202: Zero**

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| id             | DSL-202                                |
| tier           | extended                               |
| category       | edge.number                            |
| spec_ref       | dsl.2.5                                |
| type           | round_trip                             |
| input          | `0`                                    |
| expected_ir    | `0`                                    |

**DSL-203: Scientific notation**

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| id             | DSL-203                                |
| tier           | extended                               |
| category       | edge.number                            |
| spec_ref       | dsl.2.5                                |
| type           | round_trip                             |
| input          | `1e10`                                 |
| expected_ir    | `10000000000`                          |

**DSL-204: Seq with zero args (variadic minimum)**

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| id             | DSL-204                                |
| tier           | extended                               |
| category       | edge.variadic                          |
| spec_ref       | dsl.4.3                                |
| type           | round_trip                             |
| input          | `Seq()`                                |
| expected_ir    | `Seq()`                                |

**DSL-205: Whitespace-only differences**

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| id             | DSL-205                                |
| tier           | extended                               |
| category       | edge.whitespace                        |
| spec_ref       | dsl.2.2                                |
| type           | parse_only                             |
| input          | `  Let( "x" , 1 , Ref( "x" ) )  `     |

This fixture tests that arbitrary whitespace between tokens
does not affect parsing. The result MUST be identical to
`Let("x", 1, Ref("x"))`.

**DSL-206: Trailing comma in array**

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| id             | DSL-206                                |
| tier           | extended                               |
| category       | edge.trailing_comma                    |
| spec_ref       | dsl.3.3                                |
| type           | round_trip                             |
| input          | `[1, 2, 3,]`                           |
| expected_ir    | `[1, 2, 3]`                            |

**DSL-207: Object with string keys**

| Field          | Value                                          |
| -------------- | ---------------------------------------------- |
| id             | DSL-207                                        |
| tier           | extended                                       |
| category       | edge.object                                    |
| spec_ref       | dsl.3.1                                        |
| type           | round_trip                                     |
| input          | `Construct({ "na me": 1 })`                   |
| expected_ir    | `Construct({ "na me": 1 })`                   |

**DSL-208: Deeply nested (10+ levels)**

| Field       | Value                                                 |
| ----------- | ----------------------------------------------------- |
| id          | DSL-208                                               |
| tier        | extended                                              |
| category    | edge.depth                                            |
| spec_ref    | dsl.3.1                                               |
| type        | parse_only                                            |
| input       | `Let("a", 1, Let("b", 2, Let("c", 3, Let("d", 4, Let("e", 5, Let("f", 6, Let("g", 7, Let("h", 8, Let("i", 9, Let("j", 10, Ref("j")))))))))))` |

### 11.15 Fixture Count Summary

| Tier     | Category          | Count |
| -------- | ----------------- | ----- |
| Core     | Literals          | 10    |
| Core     | Constructors      | 4     |
| Core     | Nested/roundtrip  | 4     |
| Core     | External effects  | 3     |
| Core     | Compound/data     | 4     |
| Core     | Fn/Call           | 2     |
| Core     | Complex workflow  | 1     |
| Core     | Arity enforcement | 3     |
| Core     | Error diagnostics | 6     |
| Core     | Auto-close        | 6     |
| Extended | Edge cases        | 9     |
| **Total**|                   | **52** |

### 11.16 Conformance Rule

An implementation passes conformance if and only if:

1. All Core tier fixtures produce the specified outcome.
2. For `round_trip` fixtures, `parseDSL(input).ir` is
   deep-equal to the expected IR.
3. For `negative_parse` fixtures, `parseDSL(input).ok` is
   `false` and the error message contains the
   `expected_error` substring.
4. For `auto_close` fixtures,
   `parseDSLWithRecovery(input).repaired` equals
   `expected_repaired` and the IR matches `expected_ir`.
5. For `auto_close_fail` fixtures,
   `parseDSLWithRecovery(input).ok` is `false`.
6. For `parse_only` fixtures, `parseDSL(input).ok` is `true`.

Extended tier fixtures are recommended but not required for
conformance. They test edge cases that a correct
implementation handles naturally but that a bug might miss.

---

## 12. Future Extensions: Macro Constructors

### 12.1 Motivation

The base constructor vocabulary (§4.3) maps one-to-one with
`@tisyn/ir` constructor functions. For human authors using the
TypeScript compiler, this mapping is invisible — the compiler
handles structural lowering. For LLM producers writing DSL text
directly, certain IR patterns are both common and verbose:

- **Let chains.** Sequential bindings nest deeply. Three
  sequential constants require three nested `Let` calls.
- **Fire-and-forget effects.** Effects whose results are unused
  require a synthetic `__discard_N` binding.
- **Destructured All results.** Binding individual results from
  `All` requires a temporary, followed by `Get` calls by index,
  each wrapped in `Let`.

These patterns are structurally simple (no SSA, no recursive
self-reference, no carried state) and could be collapsed into
shorthand forms that the parser expands at parse time.

### 12.2 Design Constraints

Macro constructors, if implemented, MUST obey these constraints:

**C1 — Expansion is deterministic.** The same macro call with
the same arguments MUST always expand to the same IR tree.
No counters, no gensym, no state.

**C2 — Expansion uses only base constructors.** The expanded
output MUST be expressible as a tree of calls to §4.3
constructors. No new IR node types, no kernel changes, no
runtime changes.

**C3 — Expansion is invisible to downstream stages.** After
parsing, the IR tree is indistinguishable from one produced by
base constructors alone. `validateIr()`, the kernel, and the
runtime MUST NOT know or care whether a macro produced the tree.

**C4 — Macros do not appear in `print()` output.** The
`print()` function outputs base constructor syntax. The
round-trip property (§1.2) applies to base constructors only.
A macro round-trip property is weaker: `parseDSL(print(
parseDSL(macroText).ir))` produces the same IR, but
`print()` emits the expanded form.

**C5 — Macro names MUST NOT collide with base constructor
names.** The two registries share the `IDENT "("` syntax but
are conceptually separate tables.

**C6 — Macros MUST NOT handle compiler-internal patterns.**
Patterns that involve SSA naming (versioned variables like
`x_0`, `x_1`), recursive loop lowering (`__loop_N` with
carried state), or early-return packing (`__tag`, `__value`)
are compiler concerns. These patterns require whole-program
analysis that no local macro expansion can perform safely. An
LLM needing these patterns MUST use the TypeScript compiler
pathway, not the DSL.

### 12.3 Candidate Macros

The following macros are candidates for a future revision.
Their signatures and expansion rules are provisional and
subject to change after empirical evaluation with LLM
producers.

#### 12.3.1 `Do` — Sequential Bindings

Flattens a sequence of bindings and a final body expression
into a nested Let chain.

**Syntax:**

````
Do(step₁, step₂, ..., stepₙ, body)
````

Each step is one of:

- `["name", expr]` — bind `expr` to `name`.
- `expr` — evaluate `expr`, discard the result.

**Expansion:**

````
Do(["a", e1], e2, ["b", e3], body)
→ Let("a", e1,
    Let("__discard_0", e2,
      Let("b", e3,
        body)))
````

**Design note:** The discard counter (`__discard_0`,
`__discard_1`, ...) requires deterministic naming. This may
violate C1 if multiple `Do` calls appear in the same IR tree
and their discard names collide. Resolution options: (a) use
the step index within the `Do` call (`__do_0_discard_1`),
(b) require all discards to use a caller-supplied name, or
(c) accept that discard name collisions are harmless because
the bindings are never referenced. Option (c) is likely
correct — shadowing an unused binding is safe — but requires
analysis.

**Arity:** 2 to ∞. The last argument is always the body
expression. All preceding arguments are steps.

**Token savings:** For `n` sequential bindings, base syntax
requires `n` nested `Let(` prefixes and `n` closing `)`. `Do`
uses one `Do(` and one `)`. Savings grow linearly with chain
length: roughly `2n - 2` tokens saved for `n` bindings.

#### 12.3.2 `AllBind` — Destructured All Results

Runs `All` on a list of expressions and binds each result to
a name, then evaluates a body with those names in scope.

**Syntax:**

````
AllBind(["a", "b", "c"], [e1, e2, e3], body)
````

**Expansion:**

````
AllBind(["a", "b"], [e1, e2], body)
→ Let("__all_0", All(e1, e2),
    Let("a", Get(Ref("__all_0"), "0"),
      Let("b", Get(Ref("__all_0"), "1"),
        body)))
````

**Design note:** The synthetic name `__all_0` has the same
collision concern as `Do`'s discard names. Additionally, the
name count and expression count MUST match — a mismatch is
a parse-time error.

**Arity:** Exactly 3. First argument is a string array (names),
second is an expression array (children), third is the body.

**Token savings:** For `n` parallel results, base syntax
requires `1 + n` `Let` calls, `n` `Get` calls, and `n`
`Ref("__all_N")` references. `AllBind` replaces all of this
with a single call. Savings are roughly `5n` tokens.

#### 12.3.3 `RaceBind` — Named Race Result

Runs `Race` on a list of expressions and binds the winner to
a name, then evaluates a body.

**Syntax:**

````
RaceBind("winner", [e1, e2, e3], body)
````

**Expansion:**

````
RaceBind("winner", [e1, e2], body)
→ Let("winner", Race(e1, e2), body)
````

**Design note:** This is a trivial expansion — one `Let` +
`Race`. Its value is ergonomic, not structural: it signals
intent clearly and matches the `AllBind` pattern. It may not
be worth adding if `Do(["winner", Race(e1, e2)], body)`
covers the same use case adequately.

**Arity:** Exactly 3. String, expression array, body.

**Token savings:** Minimal (~4 tokens). Include only if the
parallel with `AllBind` justifies it.

### 12.4 Patterns Explicitly Excluded from Macros

The following patterns MUST NOT be implemented as macros (per
C6). They require whole-program analysis that local expansion
cannot provide:

**Loops with carried state.** The `while` → recursive Fn + Call
pattern threads SSA-versioned variables through parameter
lists. The compiler performs dataflow analysis to determine
which variables are loop-carried, what their initial values
are, and how to pack/unpack early-return results. A macro
cannot do this because it would need to inspect the loop body
for reassignment targets — that is compilation, not expansion.

**SSA lowering.** Converting `let x = 0; x = x + 1; x = x + 1`
into `Let("x_0", 0, Let("x_1", Add(Ref("x_0"), 1),
Let("x_2", Add(Ref("x_1"), 1), ...)))` requires tracking
version counters across the entire scope. A macro sees only
its own arguments.

**Early-return packing.** The `__tag`/`__value` Construct
pattern that discriminates between loop-exit paths depends on
control-flow analysis of the enclosing function body.

**Sub-workflow inlining.** Inlining one workflow's IR into
another requires resolving parameter bindings and potentially
renaming variables to avoid capture. This is Strategy A in the
compiler spec (§4.5) and is a compiler transform.

An LLM that needs any of these patterns SHOULD generate
TypeScript source for the standard compiler rather than DSL
text for the parser.

### 12.5 Implementation Guidance

If macros are implemented in a future revision:

**Where to expand.** Macro expansion SHOULD happen inside the
parser's constructor dispatch (§4.4). The parser recognizes
the macro name, validates arity, and calls an expansion
function that returns `TisynExpr` (just as base constructor
dispatch does). No separate expansion pass is needed.

**Registry structure.** The constructor table (§4.3) SHOULD
be split into two sections: a base section (current §4.3,
unchanged) and a macro section. Both share the same `IDENT "("
ArgList ")"` syntax. Name collision between sections MUST be
rejected at compile time of the parser module.

**Conformance.** Each macro MUST have conformance fixtures that
verify the expansion output matches the expected base
constructor tree. These fixtures test the macro's expansion
function, not the parser's core logic.

**LLM prompt guidance.** When macros are available, the prompt
context (§9.2) SHOULD include the macro table alongside the
base table. Macros SHOULD be presented first because they cover
the most common patterns. The prompt SHOULD explicitly state
that loop patterns and SSA lowering require the TypeScript
compiler.

### 12.6 Decision Criteria

Macros SHOULD be added to the specification when:

1. Empirical testing with LLM producers identifies specific
   patterns where token cost or error rate justifies a
   shorthand.
2. The expansion rule is simple enough that a spec reader can
   verify it by inspection.
3. The naming strategy for synthetic bindings (discard names,
   All temporaries) is resolved.
4. At least three candidate macros pass the C1–C6 constraints.

Macros SHOULD NOT be added speculatively. The base constructor
vocabulary is sufficient for any program the kernel can
evaluate. Macros are a usability optimization, not a
correctness requirement.

---

## Appendix A: Grammar in EBNF

````ebnf
program     = expr EOF ;

expr        = constructor
            | array_lit
            | object_lit
            | STRING
            | NUMBER
            | "true"
            | "false"
            | "null"
            ;

constructor = IDENT "(" [ arg_list ] ")" ;

arg_list    = expr { "," expr } ;

array_lit   = "[" [ expr { "," expr } [ "," ] ] "]" ;

object_lit  = "{" [ entry { "," entry } [ "," ] ] "}" ;

entry       = key ":" expr ;

key         = IDENT | STRING ;
````

---

## Appendix B: Example Parse

Input:

````
Let("status",
  Eval("order-service.checkStatus", [Ref("orderId")]),
  If(Eq(Get(Ref("status"), "state"), "complete"),
    Eval("order-service.getResult", [Ref("orderId")]),
    Throw("Order not complete")))
````

Token stream (abbreviated):

````
IDENT:"Let"  LPAREN  STRING:"status"  COMMA
IDENT:"Eval"  LPAREN  STRING:"order-service.checkStatus"  COMMA
LBRACKET  IDENT:"Ref"  LPAREN  STRING:"orderId"  RPAREN  RBRACKET
RPAREN  COMMA
IDENT:"If"  LPAREN  IDENT:"Eq"  LPAREN  ...
````

Parse frames (at deepest nesting):

````
[0] Let:  3 args expected, 1 received ("status")
[1] If:   2-3 args expected, 0 received
[2] Eq:   2 args expected, 0 received
[3] Get:  2 args expected, 0 received
````

Output: The IR tree that `Let("status", Eval(...), If(...))`
would produce when calling the `@tisyn/ir` constructors.

---

## Appendix C: Auto-Close Example

Truncated input (LLM stream cut off):

````
Let("x", Add(1, 2), Ref("x")
````

Delimiter stack after tokenization: `["("]`

Auto-close appends `)`, producing:

````
Let("x", Add(1, 2), Ref("x"))
````

Re-parse succeeds. `Let` has 3 arguments (min: 3). Result is
valid IR.

---

Truncated input where auto-close correctly fails:

````
Let("x", Add(1, 2)
````

Delimiter stack: `["("]`. Auto-close appends `)`, producing:

````
Let("x", Add(1, 2))
````

Re-parse fails: `Let` has 2 arguments (min: 3). Auto-close
returns `null`. The original parse error is reported.

---

## Changelog

### v0.1.0 — Initial draft

- Lexical grammar (§2).
- Syntactic grammar (§3).
- Constructor table (§4).
- Semantic constraints (§5).
- Error model (§6).
- Auto-close recovery (§7).
- Public API (§8).
- Integration guidance (§9).
- Conformance criteria (§10).
- Conformance test suite: 52 fixtures across 11 categories (§11).
- Future extensions: macro constructor design notes, three
  candidates (`Do`, `AllBind`, `RaceBind`), explicit exclusion
  of compiler-internal patterns, decision criteria (§12).
