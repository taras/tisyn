/**
 * CLI entry point — wraps the generated workflow Fn in a Call so
 * `tsn run` executes the body instead of returning a closure.
 *
 * The compiler generates `chat` as Fn([], body). The CLI passes
 * the named export directly to execute(), which evaluates Fn as
 * a closure. Wrapping in Call() invokes the function.
 */
import { Call } from "@tisyn/ir";
import { chat as chatFn } from "./workflow.generated.js";
export { inputSchemas } from "./workflow.generated.js";

export const chat = Call(chatFn);
