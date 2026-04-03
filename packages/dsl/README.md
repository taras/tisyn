# @tisyn/dsl

Parser for the Tisyn Constructor DSL. Converts constructor-call text into Tisyn IR by calling the real `@tisyn/ir` constructor functions. The parser is the inverse of `print()`.

```typescript
import {
  parseDSL, parseDSLSafe, parseDSLWithRecovery,
  tryAutoClose, DSLParseError,
  print,
} from "@tisyn/dsl";
```

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

## API

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

## Error format

```
DSLParseError: <message> (line N, col M)
  .line: number
  .column: number
  .offset: number  // UTF-16 code-unit offset
```

## Package boundaries

`@tisyn/dsl` owns syntax parsing and truncation recovery. `print` is re-exported here for convenience when working with text round-trips. Semantic validation of IR belongs to `@tisyn/validate`.

## Macro constructors

`Converge(probe, until, interval, timeout)` is a macro constructor — it expands at parse time into a `Timebox` node containing a recursive polling loop. The expansion is identical to the IR produced by the authored `yield* converge({ ... })` form.

```typescript
import { parseDSL } from "@tisyn/dsl";

const ir = parseDSL('Converge(42, Fn(["x"], Gt(Ref("x"), 0)), 100, 5000)');
// Produces: Timebox(5000, Let("__until_0", ..., Let("__poll_0", ..., Call(...))))
```

## V1 limitations

- No streaming parse.
- No type checking beyond the constructor-level shape constraints in §5.1 of the spec.
