import { run } from "effection";
import { implementAgent } from "@tisyn/agent";
import { execute } from "@tisyn/runtime";
import { InMemoryStream } from "@tisyn/durable-streams";
import { Call } from "@tisyn/ir";
import type { IrInput } from "@tisyn/ir";
import { Dom } from "../dom-workflows.generated.js";
import { createDomAgentHandlers } from "./dom-agent.js";

(window as any).__tisyn_execute = (
  ir: IrInput,
): Promise<{
  status: string;
  value?: unknown;
  error?: { message: string };
}> => {
  return run(function* () {
    const domImpl = implementAgent(Dom(), createDomAgentHandlers());
    yield* domImpl.install();

    const stream = new InMemoryStream();
    const { result } = yield* execute({
      ir: Call(ir as any) as IrInput,
      stream,
    });
    return result;
  });
};
