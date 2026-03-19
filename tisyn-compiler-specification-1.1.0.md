# Tisyn Compiler Specification

**Version:** 1.1.0
**Target:** Tisyn System Specification 1.0.0
**Status:** Normative

---

## 1. Overview

This document specifies a compiler that transforms a restricted subset of JavaScript generator functions into Tisyn IR. The output is a Tisyn `Fn` node — a JSON document — that, when interpreted by the Tisyn evaluator, produces the same journal as executing the original generator in the Effection runtime.

### 1.1 Correctness Criterion

```
∀R: journal(interpret(compile(G), R)) = journal(run(G, R))
```

### 1.2 Guarantee Hierarchy

**Level 1 — Structural validity.** Output conforms to grammar, passes all validation rules. Always guaranteed.

**Level 2 — Scope consistency.** Every Ref bound by enclosing Let or Fn. Always guaranteed.

**Level 3 — Journal equivalence.** Guaranteed for source within the authoring subset.

---

## 2. Authoring Model

### 2.1 Allowed Constructs

| Construct       | Authoring form                             | IR                                       |
| --------------- | ------------------------------------------ | ---------------------------------------- |
| Effect          | `yield* Agent().method(args)`              | External Eval                            |
| Concurrency     | `yield* all([...])` / `yield* race([...])` | Compound Eval                            |
| Sleep           | `yield* sleep(ms)`                         | External Eval                            |
| Sub-workflow    | `yield* otherWorkflow(args)`               | Inlined or `call`                        |
| Variable        | `const x = <expr>`                         | `let`                                    |
| Conditional     | `if / else`                                | `if`                                     |
| While           | `while (cond) { ... }`                     | `while` or recursive Fn                  |
| Return          | `return <expr>`                            | Final expression                         |
| Throw           | `throw new Error(msg)`                     | `throw`                                  |
| Property        | `obj.prop` / `obj["literal"]`              | `get`                                    |
| Arithmetic      | `+`, `-`, `*`, `/`, `%`, unary `-`         | `add`, `sub`, `mul`, `div`, `mod`, `neg` |
| Comparison      | `>`, `>=`, `<`, `<=`, `===`, `!==`         | `gt`, `gte`, `lt`, `lte`, `eq`, `neq`    |
| Logical         | `&&`, `\|\|`, `!`                          | `and`, `or`, `not`                       |
| String template | `` `hello ${name}` ``                      | `concat`                                 |
| Object literal  | `{ a: 1, b: x }`                           | `construct`                              |
| Array literal   | `[a, b, c]`                                | `array`                                  |
| Arrow function  | `(x) => pureExpr`                          | `fn`                                     |

### 2.2 Effects and the Durability Boundary

An **effect** is a `yield*` targeting an Agent method, `all`, `race`, `sleep`, or a sub-workflow containing effects. Each agent method call produces one Yield event.

**Rule:** `yield*` MUST appear only in statement position — as the RHS of `const x = yield* ...` or as a bare statement. It MUST NOT appear in condition expressions, short-circuit operands, function arguments, or array/object literals.

---

## 3. Compilation Pipeline

### 3.1 Four Phases

```
Source (.ts) → [Parse] → AST → [Discover] → AnnotatedAST
                                                   ↓
           Tisyn IR (JSON) ← [Emit] ← TransformedAST ← [Transform]
```

### 3.2 Determinism

Same source → byte-identical JSON. Monotonic counter for synthetic names. Canonical JSON encoding. Source-order traversal.

### 3.3 Naming

Compiler names: `__discard_0`, `__all_0`, `__loop_0`, `__sub_0`. User variables MUST NOT start with `__`.

---

## 4. The `yield*` Desugaring

### 4.1 Three Cases

| Case         | Target                        | IR                            |
| ------------ | ----------------------------- | ----------------------------- |
| Agent effect | `yield* Agent().method(args)` | External Eval (unquoted data) |
| Concurrency  | `yield* all/race([...])`      | Compound Eval (quoted data)   |
| Built-in     | `yield* sleep(ms)`            | External Eval (unquoted data) |

### 4.2 Agent Effect

```typescript
yield * OrderService().fetchOrder(orderId);
```

```json
{
  "tisyn": "eval",
  "id": "order-service.fetchOrder",
  "data": [{ "tisyn": "ref", "name": "orderId" }]
}
```

**ID:** `Agent.id + "." + methodName`. **Data:** plain array (NOT quoted). `resolve()` traverses at runtime.

### 4.3 Concurrency

```typescript
yield * all([() => A().step1(x), () => B().step2(y)]);
```

```json
{
  "tisyn": "eval",
  "id": "all",
  "data": {
    "tisyn": "quote",
    "expr": {
      "exprs": [
        { "tisyn": "eval", "id": "a.step1", "data": [{ "tisyn": "ref", "name": "x" }] },
        { "tisyn": "eval", "id": "b.step2", "data": [{ "tisyn": "ref", "name": "y" }] }
      ]
    }
  }
}
```

**Data:** Quote wrapping `{ exprs: [...] }`. Children remain unevaluated. Execution layer uses `unquote()`, NOT `resolve()`. Arrow functions are unwrapped — body extracted into `exprs`.

### 4.4 Built-in Effect

```
yield* sleep(5000) → { tisyn: "eval", id: "sleep", data: [5000] }
```

### 4.5 Sub-Workflow Composition

```typescript
function* sub(x: string): Workflow<number> { ... }
function* main(): Workflow<string> {
  const n = yield* sub("hello");
}
```

**Strategy A — Inline** (small workflows):

```
⟦ yield* sub("hello") ⟧ = Let("x", "hello", ⟦sub.body⟧)
```

**Strategy B — Call** (large or recursive workflows):

```
Let("__sub_0", ⟦compile(sub)⟧, Let("n", Call(Ref("__sub_0"), "hello"), ...))
```

---

## 5. Sequential Statement Compilation

### 5.1 Block-to-Let Transformation

```
transform_block([]):
  return null

transform_block([return expr]):
  return ⟦expr⟧

transform_block([const x = expr, ...rest]):
  return Let("x", ⟦expr⟧, transform_block(rest))

transform_block([yield* effect, ...rest]):
  return Let("__discard_N", ⟦effect⟧, transform_block(rest))

transform_block([if (cond) { return A }, ...rest]):
  return If(⟦cond⟧, ⟦A⟧, transform_block(rest))

transform_block([while ..., ...rest]):
  return Let("__while_N", ⟦while⟧, transform_block(rest))

transform_block([throw new Error(msg)]):
  return Throw(⟦msg⟧)
```

### 5.2 Implicit Return

Workflows with no explicit `return` emit `null` as terminal value.

---

## 6. Control Flow

### 6.1 Conditional

```
⟦ if (cond) { A } else { B } ⟧
= If(⟦cond⟧, ⟦A⟧, ⟦B⟧)
```

With early return:

```typescript
if (x < 0) {
  return "negative";
}
const result = yield * Agent().process(x);
return result;
```

```
If(Lt(Ref("x"), 0), "negative",
  Let("result", Eval("agent.process", [Ref("x")]), Ref("result")))
```

Code after `if`-with-return becomes the `else` branch.

### 6.2 While Loop — Two Compilation Strategies

The Tisyn `while` node has **no early-exit mechanism**. Its body expressions evaluate, the result is stored, the condition is re-checked, and the loop continues. A value returned from the body is just the iteration's result — the loop does not terminate.

This means `while` with `return` inside the body CANNOT compile to a `while` IR node. The compiler MUST distinguish two cases:

**Case A: No return in body.** Compile to `while` IR node directly.

```typescript
while (true) {
  yield * Agent().tick();
}
```

```
While(true, [Eval("agent.tick", [])])
```

This loop terminates only via error, cancellation, or the condition becoming falsy via effect in a future iteration. For `while(true)` with no return, this typically runs until cancellation.

**Case B: Return in body.** Compile to recursive Fn + Call.

```typescript
while (true) {
  const status = yield * JobService().checkStatus(jobId);
  if (status.state === "complete") {
    return yield * JobService().getResult(jobId);
  }
  yield * sleep(1000);
}
```

The compiler transforms this into:

```
Let("__loop_0", Fn([],
  Let("status", Eval("job-service.checkStatus", [Ref("jobId")]),
    If(Eq(Get(Ref("status"), "state"), "complete"),
      Eval("job-service.getResult", [Ref("jobId")]),
      Let("__discard_0", Eval("sleep", [1000]),
        Call(Ref("__loop_0")))))),
  Call(Ref("__loop_0")))
```

**How this works:**

1. `__loop_0` is bound to a Fn with no params.
2. The outer `Call(Ref("__loop_0"))` starts the first iteration.
3. Inside the body: if status is "complete", return the result (the `If`'s then-branch value propagates out through the Call as the result).
4. If not complete: sleep, then `Call(Ref("__loop_0"))` recurses.
5. Tisyn uses call-site resolution — `Ref("__loop_0")` inside the body resolves in the caller's environment, which contains the `__loop_0 → Fn(...)` binding.
6. Free variables from the enclosing scope (`jobId`) resolve correctly via call-site resolution — the caller's environment includes them.

**Detection:** The compiler walks the while body's AST. If any `return` statement exists (at any nesting depth within the body), use Case B. Otherwise, use Case A.

**Throw in body:** `throw` inside a while body works with both strategies. Errors propagate upward through `while` (Case A) and through `call` (Case B) identically.

### 6.3 While with Invariant Condition

```typescript
const limit = 10;
while (count < limit) { ... }
```

If `count` is an immutable `const`, the condition is invariant. The compiler SHOULD emit warning W001.

### 6.4 Break/Continue

DISALLOWED. No IR equivalent. Loops terminate via return (Case B), throw, or condition.

---

## 7. Expression Compilation

### 7.1 Structural Operations

All pure expressions compile to structural Eval nodes with quoted data:

```
⟦ a + b ⟧ = { tisyn:"eval", id:"add", data:Q({ a:⟦a⟧, b:⟦b⟧ }) }
⟦ a > b ⟧ = { tisyn:"eval", id:"gt",  data:Q({ a:⟦a⟧, b:⟦b⟧ }) }
⟦ !a    ⟧ = { tisyn:"eval", id:"not", data:Q({ a:⟦a⟧ }) }
⟦ -a    ⟧ = { tisyn:"eval", id:"neg", data:Q({ a:⟦a⟧ }) }
```

### 7.2 Type Constraints

| Operator                  | Operands    | Note                                         |
| ------------------------- | ----------- | -------------------------------------------- |
| `add/sub/mul/div/mod/neg` | number only | TypeError on non-number                      |
| `gt/gte/lt/lte`           | number only | TypeError on non-number                      |
| `eq/neq`                  | any         | Structural comparison via canonical encoding |
| `and/or`                  | any         | Returns operand values, not booleans         |
| `not`                     | any         | Returns boolean                              |

### 7.3 `+` Disambiguation

JavaScript `+` is addition or concatenation. The compiler MUST disambiguate:

- Both operands statically typed `number` → `add`
- String context (template literal) → `concat`
- Ambiguous → compile error E011

### 7.4 Short-Circuit

`&&` → `and`, `||` → `or`. Return operand values (Tisyn Spec §6.7). This works correctly as conditions because `if` uses truthiness.

### 7.5 Property Access

```
⟦ obj.prop ⟧ = Get(⟦obj⟧, "prop")
⟦ obj.a.b ⟧ = Get(Get(⟦obj⟧, "a"), "b")
```

Computed access (`obj[expr]`) DISALLOWED.

### 7.6 Object Literals

```
⟦ { a: e1, b: e2 } ⟧ = Construct({ a: ⟦e1⟧, b: ⟦e2⟧ })
```

Evaluator sorts keys lexicographically at runtime (Spec §6.10).

### 7.7 Array Literals

```
⟦ [a, b, c] ⟧ = Array([⟦a⟧, ⟦b⟧, ⟦c⟧])
```

### 7.8 Template Literals

```
⟦ `Hello ${name}` ⟧ = Concat(["Hello ", ⟦name⟧])
```

### 7.9 Throw

```
⟦ throw new Error(msgExpr) ⟧ = Throw(⟦msgExpr⟧)
```

`msgExpr` may be string, template, or variable. Non-Error throws DISALLOWED.

---

## 8. Concurrency

### 8.1 `all` with Simple Children

```typescript
yield * all([() => A().step(x), () => B().step(y)]);
```

Arrow functions unwrapped. Bodies placed in `exprs`:

```json
{
  "tisyn": "eval",
  "id": "all",
  "data": {
    "tisyn": "quote",
    "expr": {
      "exprs": [
        { "tisyn": "eval", "id": "a.step", "data": [{ "tisyn": "ref", "name": "x" }] },
        { "tisyn": "eval", "id": "b.step", "data": [{ "tisyn": "ref", "name": "y" }] }
      ]
    }
  }
}
```

### 8.2 `all` with Multi-Step Children

Generator functions compiled as inline expression trees:

```typescript
yield *
  all([
    function* () {
      const order = yield* OrderService().fetchOrder("123");
      return yield* Processor().process(order);
    },
    () => FastService().quick(),
  ]);
```

```json
{
  "exprs": [
    {
      "tisyn": "eval",
      "id": "let",
      "data": {
        "tisyn": "quote",
        "expr": {
          "name": "order",
          "value": { "tisyn": "eval", "id": "order-service.fetchOrder", "data": ["123"] },
          "body": {
            "tisyn": "eval",
            "id": "processor.process",
            "data": [{ "tisyn": "ref", "name": "order" }]
          }
        }
      }
    },
    { "tisyn": "eval", "id": "fast-service.quick", "data": [] }
  ]
}
```

Generator children are inlined, NOT compiled as Fn nodes.

### 8.3 `race`

Same structure, `id: "race"`. Winner's result returned (not array).

### 8.4 Destructured Results

```typescript
const [a, b] = yield* all([...]);
```

```
Let("__all_0", Eval("all", Q({exprs:[...]})),
  Let("a", Get(Ref("__all_0"), "0"),
    Let("b", Get(Ref("__all_0"), "1"), ...)))
```

### 8.5 Free Variables in Children

Children may reference parent-scope variables via Ref. Correct — execution layer evaluates children in parent's environment. Compiler MUST verify all free variables are in scope at the call site.

---

## 9. Function Semantics

### 9.1 Arrow Functions → Fn

```typescript
const double = (x: number) => x * 2;
```

```json
{
  "tisyn": "fn",
  "params": ["x"],
  "body": {
    "tisyn": "eval",
    "id": "mul",
    "data": {
      "tisyn": "quote",
      "expr": {
        "a": { "tisyn": "ref", "name": "x" },
        "b": 2
      }
    }
  }
}
```

### 9.2 Arrow Function Bodies

Arrow function bodies MUST be **single pure expressions**. No block bodies, no `yield*`, no statements. This is a JavaScript language constraint — arrow functions cannot use `yield*`.

Arrow functions passed to `all`/`race` as thunks `() => expr` are unwrapped (§8.1), not compiled as Fn nodes.

### 9.3 Fn Bodies CAN Contain Effects

A Fn called via Tisyn `call` evaluates its body using the full evaluator. If the body contains external Evals, they cross the execution boundary normally. The `call` structural operation invokes `eval(body, E')`, and `eval` handles suspension/resumption transparently.

This is relevant for sub-workflow composition (§4.5 Strategy B) and the recursive loop pattern (§6.2 Case B), where the Fn body contains agent method calls.

### 9.4 Closure Restriction

Tisyn Fn has no closures. The compiler MUST ensure:

**Condition A:** No free variables. **Condition B:** All free variables in scope at every call site.

**Substitution** (replace free Refs with values) is MANDATORY when a Fn crosses the execution boundary as an agent argument.

### 9.5 Calling

```
⟦ f(a, b) ⟧ = Call(⟦f⟧, [⟦a⟧, ⟦b⟧])
```

---

## 10. Environment and Scope

### 10.1 Variables → Let

Every `const` → `let` binding. Scoped by nesting:

```
⟦ const a = e1; const b = e2; return a + b ⟧
= Let("a", ⟦e1⟧, Let("b", ⟦e2⟧, Add(Ref("a"), Ref("b"))))
```

### 10.2 Block Scoping

Variables in `if` branches scoped to branch body. Not visible outside.

### 10.3 Shadowing

Inner bindings shadow outer with same name. Outer restored after inner scope.

### 10.4 No Mutation

`const` only. `let`/`var`/reassignment → compile error.

---

## 11. Unsupported Constructs

| Construct                 | Code              | Error             |
| ------------------------- | ----------------- | ----------------- |
| Mutable binding           | `let x = ...`     | E001: Use "const" |
| Var                       | `var x = ...`     | E002: Use "const" |
| Reassignment              | `x = v`           | E003              |
| Property mutation         | `obj.p = v`       | E004              |
| Computed property         | `obj[expr]`       | E005              |
| `Math.random()`           |                   | E006              |
| `Date.now()`              |                   | E007              |
| `new Map/Set()`           |                   | E008              |
| `async/await`             |                   | E009              |
| `yield*` in expr position | `if (yield* ...)` | E010              |
| Ambiguous `+`             |                   | E011              |
| `for...in`                |                   | E013              |
| `eval()/new Function()`   |                   | E014              |
| `try/catch`               |                   | E015              |
| `class/this`              |                   | E016              |
| `yield` (no `*`)          |                   | E017              |
| `call(() => ...)`         |                   | E018              |
| `typeof/instanceof`       |                   | E019              |
| `break/continue`          |                   | E020              |
| `Promise`                 |                   | E021              |
| Non-Error throw           | `throw "string"`  | E023              |
| Arrow block body          | `(x) => { ... }`  | E024              |
| `delete`/`Symbol`         |                   | E029/E030         |
| User var `__` prefix      | `const __x`       | E028              |

---

## 12. End-to-End Examples

### 12.1 Simple Sequential Workflow

**Source:**

```typescript
function* processOrder(orderId: string): Workflow<Receipt> {
  const order = yield* OrderService().fetchOrder(orderId);
  const receipt = yield* PaymentService().chargeCard(order.payment);
  return receipt;
}
```

**IR:**

```json
{
  "tisyn": "fn",
  "params": ["orderId"],
  "body": {
    "tisyn": "eval",
    "id": "let",
    "data": {
      "tisyn": "quote",
      "expr": {
        "name": "order",
        "value": {
          "tisyn": "eval",
          "id": "order-service.fetchOrder",
          "data": [{ "tisyn": "ref", "name": "orderId" }]
        },
        "body": {
          "tisyn": "eval",
          "id": "let",
          "data": {
            "tisyn": "quote",
            "expr": {
              "name": "receipt",
              "value": {
                "tisyn": "eval",
                "id": "payment-service.chargeCard",
                "data": [
                  {
                    "tisyn": "eval",
                    "id": "get",
                    "data": {
                      "tisyn": "quote",
                      "expr": {
                        "obj": { "tisyn": "ref", "name": "order" },
                        "key": "payment"
                      }
                    }
                  }
                ]
              },
              "body": { "tisyn": "ref", "name": "receipt" }
            }
          }
        }
      }
    }
  }
}
```

**Key:** Two external Evals with unquoted data arrays. Two Lets with quoted data. All Refs bound. ✓

### 12.2 Effect-Driven Loop with Early Return

**Source:**

```typescript
function* pollJob(jobId: string): Workflow<Result> {
  const config = yield* ConfigService().getRetryConfig();

  while (true) {
    const status = yield* JobService().checkStatus(jobId);

    if (status.state === "complete") {
      return yield* JobService().getResult(jobId);
    }

    if (status.state === "failed") {
      throw new Error("Job failed");
    }

    yield* sleep(config.intervalMs);
  }
}
```

**Analysis:** Body contains `return` → Case B (recursive Fn + Call).

**IR:**

```json
{
  "tisyn": "fn",
  "params": ["jobId"],
  "body": {
    "tisyn": "eval",
    "id": "let",
    "data": {
      "tisyn": "quote",
      "expr": {
        "name": "config",
        "value": { "tisyn": "eval", "id": "config-service.getRetryConfig", "data": [] },
        "body": {
          "tisyn": "eval",
          "id": "let",
          "data": {
            "tisyn": "quote",
            "expr": {
              "name": "__loop_0",
              "value": {
                "tisyn": "fn",
                "params": [],
                "body": {
                  "tisyn": "eval",
                  "id": "let",
                  "data": {
                    "tisyn": "quote",
                    "expr": {
                      "name": "status",
                      "value": {
                        "tisyn": "eval",
                        "id": "job-service.checkStatus",
                        "data": [{ "tisyn": "ref", "name": "jobId" }]
                      },
                      "body": {
                        "tisyn": "eval",
                        "id": "if",
                        "data": {
                          "tisyn": "quote",
                          "expr": {
                            "condition": {
                              "tisyn": "eval",
                              "id": "eq",
                              "data": {
                                "tisyn": "quote",
                                "expr": {
                                  "a": {
                                    "tisyn": "eval",
                                    "id": "get",
                                    "data": {
                                      "tisyn": "quote",
                                      "expr": {
                                        "obj": { "tisyn": "ref", "name": "status" },
                                        "key": "state"
                                      }
                                    }
                                  },
                                  "b": "complete"
                                }
                              }
                            },
                            "then": {
                              "tisyn": "eval",
                              "id": "job-service.getResult",
                              "data": [{ "tisyn": "ref", "name": "jobId" }]
                            },
                            "else": {
                              "tisyn": "eval",
                              "id": "if",
                              "data": {
                                "tisyn": "quote",
                                "expr": {
                                  "condition": {
                                    "tisyn": "eval",
                                    "id": "eq",
                                    "data": {
                                      "tisyn": "quote",
                                      "expr": {
                                        "a": {
                                          "tisyn": "eval",
                                          "id": "get",
                                          "data": {
                                            "tisyn": "quote",
                                            "expr": {
                                              "obj": { "tisyn": "ref", "name": "status" },
                                              "key": "state"
                                            }
                                          }
                                        },
                                        "b": "failed"
                                      }
                                    }
                                  },
                                  "then": {
                                    "tisyn": "eval",
                                    "id": "throw",
                                    "data": {
                                      "tisyn": "quote",
                                      "expr": {
                                        "message": "Job failed"
                                      }
                                    }
                                  },
                                  "else": {
                                    "tisyn": "eval",
                                    "id": "let",
                                    "data": {
                                      "tisyn": "quote",
                                      "expr": {
                                        "name": "__discard_0",
                                        "value": {
                                          "tisyn": "eval",
                                          "id": "sleep",
                                          "data": [
                                            {
                                              "tisyn": "eval",
                                              "id": "get",
                                              "data": {
                                                "tisyn": "quote",
                                                "expr": {
                                                  "obj": { "tisyn": "ref", "name": "config" },
                                                  "key": "intervalMs"
                                                }
                                              }
                                            }
                                          ]
                                        },
                                        "body": {
                                          "tisyn": "eval",
                                          "id": "call",
                                          "data": {
                                            "tisyn": "quote",
                                            "expr": {
                                              "fn": { "tisyn": "ref", "name": "__loop_0" },
                                              "args": []
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              "body": {
                "tisyn": "eval",
                "id": "call",
                "data": {
                  "tisyn": "quote",
                  "expr": {
                    "fn": { "tisyn": "ref", "name": "__loop_0" },
                    "args": []
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

**How the recursion works:**

1. `__loop_0` is bound to a nullary Fn.
2. Outer `Call(Ref("__loop_0"))` starts the first iteration.
3. Each iteration: checks status, returns on complete, throws on failed, or sleeps and calls `__loop_0` again.
4. `Ref("__loop_0")` resolves via call-site resolution — the caller's env contains the binding.
5. `Ref("jobId")` and `Ref("config")` resolve in the caller's env, which includes the outer Let chain.
6. When the "complete" branch fires, the getResult value propagates out through the Call → Let → Fn return chain.

**Journal** (assuming checkStatus returns "pending", "pending", "complete"):

```
[0] yield root config-service.getRetryConfig ok {intervalMs:1000}
[1] yield root job-service.checkStatus ok {state:"pending"}
[2] yield root sleep ok null
[3] yield root job-service.checkStatus ok {state:"pending"}
[4] yield root sleep ok null
[5] yield root job-service.checkStatus ok {state:"complete"}
[6] yield root job-service.getResult ok {data:"result-data"}
[7] close root ok {data:"result-data"}
```

### 12.3 Concurrency with `all`

**Source:**

```typescript
function* parallelProcess(id1: string, id2: string): Workflow<string> {
  const orderA = yield* OrderService().fetchOrder(id1);
  const orderB = yield* OrderService().fetchOrder(id2);

  const results = yield* all([
    () => Processor().process(orderA),
    () => Processor().process(orderB),
  ]);

  return yield* Aggregator().combine(results);
}
```

**IR:**

```json
{
  "tisyn": "fn",
  "params": ["id1", "id2"],
  "body": {
    "tisyn": "eval",
    "id": "let",
    "data": {
      "tisyn": "quote",
      "expr": {
        "name": "orderA",
        "value": {
          "tisyn": "eval",
          "id": "order-service.fetchOrder",
          "data": [{ "tisyn": "ref", "name": "id1" }]
        },
        "body": {
          "tisyn": "eval",
          "id": "let",
          "data": {
            "tisyn": "quote",
            "expr": {
              "name": "orderB",
              "value": {
                "tisyn": "eval",
                "id": "order-service.fetchOrder",
                "data": [{ "tisyn": "ref", "name": "id2" }]
              },
              "body": {
                "tisyn": "eval",
                "id": "let",
                "data": {
                  "tisyn": "quote",
                  "expr": {
                    "name": "results",
                    "value": {
                      "tisyn": "eval",
                      "id": "all",
                      "data": {
                        "tisyn": "quote",
                        "expr": {
                          "exprs": [
                            {
                              "tisyn": "eval",
                              "id": "processor.process",
                              "data": [{ "tisyn": "ref", "name": "orderA" }]
                            },
                            {
                              "tisyn": "eval",
                              "id": "processor.process",
                              "data": [{ "tisyn": "ref", "name": "orderB" }]
                            }
                          ]
                        }
                      }
                    },
                    "body": {
                      "tisyn": "eval",
                      "id": "aggregator.combine",
                      "data": [{ "tisyn": "ref", "name": "results" }]
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

**Key observations:**

- `all` data is **quoted** — children stay unevaluated for execution layer.
- Arrow functions unwrapped — body expressions in `exprs`.
- `Ref("orderA")` and `Ref("orderB")` inside children are free variables resolved in parent's env at child task spawn time.
- `processor.process` data arrays are unquoted — `resolve()` handles them per-child.
- `all` result bound to `results`, passed directly to `aggregator.combine`.

**Journal:**

```
[0] yield root order-service.fetchOrder ok {id:"1",...}
[1] yield root order-service.fetchOrder ok {id:"2",...}
[2] yield root.0 processor.process ok "processed-1"
[3] yield root.1 processor.process ok "processed-2"
[4] close root.0 ok "processed-1"
[5] close root.1 ok "processed-2"
[6] yield root aggregator.combine ok "final-result"
[7] close root ok "final-result"
```

Note child task IDs `root.0` and `root.1` for the `all` children.

### 12.4 Validation Checklist

Every compiled IR MUST:

1. Pass Tisyn grammar validation (§10 of Spec).
2. Use exactly one Quote per structural operation data.
3. Have no Quote at any evaluation position (positions table).
4. Have all Refs bound by enclosing Let or Fn.
5. Use unquoted data for standard external Evals.
6. Use quoted data for `all`/`race`/`spawn`.
7. Produce the same journal as the source generator.

---

## 13. Compiler Interface

```
tisyn compile <input.ts> [--output <output.json>] [--validate] [--pretty]
```

| Code | Meaning           |
| ---- | ----------------- |
| 0    | Success           |
| 1    | Compilation error |
| 2    | Validation error  |
| 3    | Internal error    |

Errors include source locations. Partial compilation: failing workflows produce errors; remaining workflows compile and output.
