# `@tisyn/dsl`

`@tisyn/dsl` parses Tisyn Constructor DSL text into IR by calling the real `@tisyn/ir` constructor functions. The parser is the inverse of `print()` — it round-trips between text and IR.

This package is the bridge between human-readable or LLM-generated constructor text and executable Tisyn IR.

## Where It Fits

`@tisyn/dsl` sits between text representations and the IR layer.

- `@tisyn/ir` defines the IR node shapes and provides `print()` for serialization.
- `@tisyn/dsl` parses constructor text back into those IR nodes.
- `@tisyn/validate` checks that parsed IR is well-formed.

Use this package when you need to convert constructor-call text into IR, especially from LLM-generated output or developer tooling.

## Round-trip

```typescript
import { Let, Ref } from "@tisyn/ir";
import { print, parseDSL } from "@tisyn/dsl";

const ir = Let("x", 1, Ref("x"));
const text = print(ir);            // 'Let("x", 1, Ref("x"))'
const reparsed = parseDSL(text);   // structurally equal to ir
```

## Which API should I use?

| API | Throws? | Recovery? | Use when |
|---|---|---|---|
| `parseDSL` | yes | no | input is trusted; you want exceptions |
| `parseDSLSafe` | no | no | you want a discriminated result |
| `parseDSLWithRecovery` | no | yes | input is LLM-generated and may be truncated |

## Main APIs

### `parseDSL(source: string): TisynExpr`

Throws `DSLParseError` on any failure.

```typescript
try {
  const ir = parseDSL('Let("x", 1, Ref("x"))');
} catch (e) {
  if (e instanceof DSLParseError) {
    console.error(e.message); // "... (line 1, col 5)"
  }
}
```

### `parseDSLSafe(source: string): Result<TisynExpr>`

Returns Effection's `Result<TisynExpr>`: `{ ok: true, value }` or `{ ok: false, error }`. Never throws.

When parsing fails due to unexpected EOF, `result.error` is a `DSLParseError` with a `recovery` field. `error.recovery.autoClosable` indicates whether the input is a candidate for auto-close repair.

```typescript
const result = parseDSLSafe(source);
if (result.ok) {
  use(result.value);
} else {
  console.error(result.error.message); // includes line/col
}
```

### `parseDSLWithRecovery(source: string): ParseResult & { repaired?: string }`

Recommended entry point for LLM-generated input. On failure, attempts to close unbalanced delimiters — but **only** when `error.recovery.autoClosable` is true (i.e. the parser reached EOF mid-expression with enough arguments present to complete every open constructor). Ordinary syntax errors are returned as-is.

```typescript
const result = parseDSLWithRecovery(llmOutput);
if (result.ok) {
  if (result.repaired) console.log("repaired:", result.repaired);
  use(result.value);
} else {
  feedBackToLLM(result.error.message);
}
```

### `tryAutoClose(source: string): string | null`

Attempts to close unbalanced delimiters and re-parse. Returns the repaired string or `null`.

### `print(ir: TisynExpr): string`

Re-exported from `@tisyn/ir`. Serializes IR to Constructor DSL text.

## Macro Constructors

`Converge(probe, until, interval, timeout)` is a macro constructor — it expands at parse time into a `Timebox` node containing a recursive polling loop. The expansion is identical to the IR produced by the authored `yield* converge({ ... })` form.

```typescript
import { parseDSL } from "@tisyn/dsl";

const ir = parseDSL('Converge(42, Fn(["x"], Gt(Ref("x"), 0)), 100, 5000)');
// Produces: Timebox(5000, Let("__until_0", ..., Let("__poll_0", ..., Call(...))))
```

## Error Format

```
DSLParseError: <message> (line N, col M)
  .line: number
  .column: number
  .offset: number  // UTF-16 code-unit offset
```

## Relationship to the Rest of Tisyn

- [`@tisyn/ir`](../ir/README.md) defines the IR node shapes that this package parses into, and provides `print()` for the forward direction.
- [`@tisyn/validate`](../validate/README.md) checks that parsed IR is structurally valid.
- [`@tisyn/runtime`](../runtime/README.md) executes the IR that this package produces.

## Boundaries

`@tisyn/dsl` owns:

- constructor DSL parsing
- truncation recovery for LLM-generated input
- macro constructor expansion (`Converge`)

`@tisyn/dsl` does not own:

- IR node definitions or `print()` serialization (owned by `@tisyn/ir`)
- semantic IR validation (owned by `@tisyn/validate`)
- workflow compilation from TypeScript (owned by `@tisyn/compiler`)

## V1 Limitations

- No streaming parse.
- No type checking beyond the constructor-level shape constraints in the spec.
