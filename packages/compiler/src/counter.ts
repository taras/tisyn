/**
 * Monotonic counter for synthetic names.
 *
 * Produces deterministic names: __discard_0, __loop_0, __sub_0, __all_0.
 * Same source → same counter sequence → byte-identical output.
 */

export class Counter {
  private counts = new Map<string, number>();

  next(prefix: string): string {
    const n = this.counts.get(prefix) ?? 0;
    this.counts.set(prefix, n + 1);
    return `__${prefix}_${n}`;
  }
}
