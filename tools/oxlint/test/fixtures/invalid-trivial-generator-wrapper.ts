function bar() {
  return 42;
}

export function* foo() {
  return yield* bar();
}
