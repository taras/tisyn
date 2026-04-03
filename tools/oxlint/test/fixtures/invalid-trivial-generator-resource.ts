import { resource } from "effection";

export function* foo() {
  return yield* resource(function* () {
    return 1;
  });
}
