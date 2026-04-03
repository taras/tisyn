import { run } from "effection";

await run(function* () {
  return yield* something();
});

function something() {
  return 1;
}
