import type { Workflow } from "@tisyn/agent";

declare global {
  function timebox<T>(
    duration: number,
    body: () => Workflow<T>,
  ): Workflow<{ status: "completed"; value: T } | { status: "timeout" }>;
}
