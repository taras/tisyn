/**
 * Input schema → CLI flag mapping and parsing.
 *
 * Maps compiler-emitted InputSchema metadata to CLI flags for `tsn run`.
 */

import type { InputSchema, InputFieldSchema } from "@tisyn/compiler";
import { CliError } from "./load-descriptor.js";

export interface FlagDefinition {
  /** kebab-case CLI flag name */
  flag: string;
  /** Original camelCase field name */
  fieldName: string;
  fieldType: "string" | "number" | "boolean";
  optional: boolean;
}

/** Built-in flags that cannot be overridden by workflow inputs. */
const BUILT_IN_FLAGS = new Set([
  "help",
  "entrypoint",
  "env-example",
  "verbose",
]);

/**
 * Derive CLI flag definitions from an InputSchema.
 */
export function deriveFlags(schema: InputSchema): FlagDefinition[] {
  if (schema.type !== "object") return [];

  return schema.fields.map((field) => {
    const flag = camelToKebab(field.name);
    if (BUILT_IN_FLAGS.has(flag)) {
      throw new CliError(
        2,
        `Workflow input field '${field.name}' conflicts with built-in flag '--${flag}'`,
      );
    }
    return {
      flag,
      fieldName: field.name,
      fieldType: field.fieldType,
      optional: field.optional,
    };
  });
}

/**
 * Parse CLI argv against derived flag definitions.
 * Returns a record of field names → parsed values.
 *
 * Errors (exit 4):
 * - Unknown flag
 * - Missing required field
 * - Number coercion failure
 */
export function parseInputFlags(
  flags: FlagDefinition[],
  argv: string[],
): Record<string, unknown> {
  const flagMap = new Map<string, FlagDefinition>();
  for (const def of flags) {
    flagMap.set(def.flag, def);
  }

  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      i++;
      continue;
    }

    const flagName = arg.slice(2);
    const def = flagMap.get(flagName);

    if (!def) {
      errors.push(`Unknown flag: --${flagName}`);
      i++;
      continue;
    }

    if (def.fieldType === "boolean") {
      result[def.fieldName] = true;
      i++;
      continue;
    }

    const valueArg = argv[i + 1];
    if (valueArg === undefined || valueArg.startsWith("--")) {
      errors.push(`Flag --${flagName} requires a value`);
      i++;
      continue;
    }

    if (def.fieldType === "number") {
      const num = parseFloat(valueArg);
      if (Number.isNaN(num)) {
        errors.push(`Flag --${flagName}: '${valueArg}' is not a valid number`);
        i += 2;
        continue;
      }
      result[def.fieldName] = num;
    } else {
      result[def.fieldName] = valueArg;
    }

    i += 2;
  }

  // Check for missing required fields
  for (const def of flags) {
    if (!def.optional && !(def.fieldName in result)) {
      if (def.fieldType === "boolean") {
        result[def.fieldName] = false;
      } else {
        errors.push(`Missing required flag: --${def.flag}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new CliError(4, errors.join("\n"));
  }

  return result;
}

/**
 * Format input schema as help text.
 */
export function formatInputHelp(flags: FlagDefinition[]): string {
  if (flags.length === 0) return "";

  const lines: string[] = ["", "Workflow inputs:"];
  for (const def of flags) {
    const req = def.optional ? "(optional)" : "(required)";
    const type = def.fieldType === "boolean" ? "" : ` <${def.fieldType}>`;
    lines.push(`  --${def.flag}${type}  ${req}`);
  }
  return lines.join("\n");
}

function camelToKebab(name: string): string {
  return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
