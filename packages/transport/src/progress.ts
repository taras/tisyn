import { createContext } from "effection";
import type { Val } from "@tisyn/ir";

export interface ProgressEvent {
  token: string;
  effectId: string;
  coroutineId: string;
  value: Val;
}

export type ProgressSink = (event: ProgressEvent) => void;

export const ProgressContext = createContext<ProgressSink | null>("$progress", null);
export const CoroutineContext = createContext<string>("$coroutineId", "root");
