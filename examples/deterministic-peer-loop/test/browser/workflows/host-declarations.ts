import type { Workflow } from "@tisyn/agent";
import type { IrInput } from "@tisyn/ir";

export declare function Host(): {
  stop(input: Record<string, never>): Workflow<void>;
  restart(input: { journalPath?: string }): Workflow<void>;
};

export declare function Browser(): {
  open(input: Record<string, never>): Workflow<void>;
  close(input: Record<string, never>): Workflow<void>;
  reload(input: Record<string, never>): Workflow<void>;
  openSession(input: { sessionId: string }): Workflow<void>;
  switchSession(input: { sessionId: string }): Workflow<void>;
  closeSession(input: { sessionId: string }): Workflow<void>;
  execute(input: { workflow: IrInput }): Workflow<void>;
};
