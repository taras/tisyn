import { call } from "effection";

function activePage(state: { page: { close(): Promise<void> } }) {
  return state.page;
}

export function* run(state: { page: { close(): Promise<void> } }) {
  yield* call(() => activePage(state).close());
}
