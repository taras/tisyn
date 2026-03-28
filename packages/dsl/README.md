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

### `parseDSLSafe(source: string): ParseResult`

Returns `{ ok: true, ir }` or `{ ok: false, error, recovery? }`. Never throws.

`result.recovery` is present when the failure was caused by unexpected EOF. `result.recovery.autoClosable` indicates whether the input is a candidate for auto-close repair.

```typescript
const result = parseDSLSafe(source);
if (result.ok) {
  use(result.ir);
} else {
  console.error(result.error.message); // includes line/col
}
```

### `parseDSLWithRecovery(source: string): ParseResult & { repaired?: string }`

Recommended entry point for LLM-generated input. On failure, attempts to close unbalanced delimiters — but **only** when `recovery.autoClosable` is true (i.e. the parser reached EOF mid-expression with enough arguments present to complete every open constructor). Ordinary syntax errors are returned as-is.

```typescript
const result = parseDSLWithRecovery(llmOutput);
if (result.ok) {
  if (result.repaired) console.log("repaired:", result.repaired);
  use(result.ir);
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

## V1 limitations

- No streaming parse.
- No macro constructors (`Do`, `AllBind`, `RaceBind`).
- No type checking beyond the constructor-level shape constraints in §5.1 of the spec.
