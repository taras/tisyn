import { z } from "zod";

export const stringSchema = z.string();
export const optionalStringSchema = z.string().optional();
export const booleanSchema = z.boolean();
export const stringArraySchema = z.array(z.string());
export function enumSchema<T extends readonly [string, ...string[]]>(values: T) {
  return z.enum([...values] as [string, ...string[]]);
}
