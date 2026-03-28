# @tisyn/dsl

Parser for the Tisyn Constructor DSL. Converts constructor-call text into Tisyn IR by calling the real `@tisyn/ir` constructor functions. The parser is the inverse of `@tisyn/ir#print()`.

## API

```typescript
import { parseDSL, parseDSLSafe, parseDSLWithRecovery, tryAutoClose, DSLParseError } from "@tisyn/dsl";
```

### `parseDSL(source: string): TisynExpr`

Throws `DSLParseError` on failure. Default strict entry point.

```typescript
const ir = parseDSL('Let("x", 1, Ref("x"))');
```

### `parseDSLSafe(source: string): ParseResult`

Returns a discriminated result, never throws. `result.recovery` is present for EOF-truncation failures.

```typescript
const result = parseDSLSafe(source);
if (result.ok) {
  use(result.ir);
} else {
  console.error(result.error.message); // includes line/col
}
```

### `parseDSLWithRecovery(source: string): ParseResult & { repaired?: string }`

Recommended entry point for LLM-generated input. Attempts auto-close recovery on truncated input.

```typescript
const result = parseDSLWithRecovery(llmOutput);
if (result.ok) {
  if (result.repaired) console.log("recovered:", result.repaired);
  use(result.ir);
} else {
  feedBackToLLM(result.error.message);
}
```

### `tryAutoClose(source: string): string | null`

Attempts to close unbalanced delimiters. Returns the repaired string or `null`.

## Error format

```
DSLParseError: <message> (line N, col M)
  .line: number
  .column: number
  .offset: number  // UTF-16 code-unit offset
```

## V1 limitations

- No streaming parse.
- No macro constructors (`Do`, `AllBind`, `RaceBind`).
- No type checking beyond the constructor-level shape constraints in §5.1 of the spec.
