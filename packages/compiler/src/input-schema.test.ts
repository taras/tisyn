/**
 * Tests for input schema metadata emission.
 *
 * Tests buildInputSchema() parsing and generateCode() inputSchemas export.
 */

import { describe, it, expect } from "vitest";
import { buildInputSchema, generateWorkflowModule } from "./index.js";

describe("buildInputSchema", () => {
  it("zero parameters → { type: 'none' }", () => {
    expect(buildInputSchema([])).toEqual({ type: "none" });
  });

  it("flat object parameter → structured fields", () => {
    const schema = buildInputSchema(["{ maxTurns: number; model: string; verbose: boolean }"]);
    expect(schema).toEqual({
      type: "object",
      fields: [
        { name: "maxTurns", fieldType: "number", optional: false },
        { name: "model", fieldType: "string", optional: false },
        { name: "verbose", fieldType: "boolean", optional: false },
      ],
    });
  });

  it("optional fields preserve optionality", () => {
    const schema = buildInputSchema(["{ required: string; optional?: number }"]);
    expect(schema).toEqual({
      type: "object",
      fields: [
        { name: "required", fieldType: "string", optional: false },
        { name: "optional", fieldType: "number", optional: true },
      ],
    });
  });

  it("unsupported nested object → { type: 'unsupported' }", () => {
    const schema = buildInputSchema(["{ nested: { inner: string } }"]);
    expect(schema.type).toBe("unsupported");
  });

  it("unsupported multiple parameters → { type: 'unsupported' }", () => {
    const schema = buildInputSchema(["string", "number"]);
    expect(schema).toEqual({ type: "unsupported", reason: "multiple parameters" });
  });

  it("unsupported array type → { type: 'unsupported' }", () => {
    const schema = buildInputSchema(["string[]"]);
    expect(schema.type).toBe("unsupported");
  });

  it("unsupported union type field → { type: 'unsupported' }", () => {
    const schema = buildInputSchema(["{ value: string | number }"]);
    expect(schema.type).toBe("unsupported");
  });
});

describe("generateCode inputSchemas emission", () => {
  it("generated module contains inputSchemas export for zero-param workflow", () => {
    const result = generateWorkflowModule(`
      export function* hello(): Workflow<string> {
        return "hello";
      }
    `);
    expect(result.source).toContain("export const inputSchemas");
    expect(result.source).toContain('"type":"none"');
  });

  it("generated module contains inputSchemas export for parameterized workflow", () => {
    const result = generateWorkflowModule(`
      export function* greet(input: { name: string; loud?: boolean }): Workflow<string> {
        return "hello";
      }
    `);
    expect(result.source).toContain("export const inputSchemas");
    expect(result.source).toContain('"type":"object"');
    expect(result.source).toContain('"name":"name"');
    expect(result.source).toContain('"fieldType":"string"');
    expect(result.source).toContain('"name":"loud"');
    expect(result.source).toContain('"optional":true');
  });
});
