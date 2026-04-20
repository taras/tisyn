import { describe, it, expect } from "vitest";
import { validateNewSessionPayload } from "./validate.js";

describe("validateNewSessionPayload", () => {
  it("accepts an empty object", () => {
    expect(() => validateNewSessionPayload({})).not.toThrow();
  });

  it("accepts { model: string }", () => {
    expect(() => validateNewSessionPayload({ model: "claude-sonnet-4-6" })).not.toThrow();
  });

  it("rejects wrapped payload like { config: { model } } with InvalidPayload", () => {
    let caught: Error | null = null;
    try {
      validateNewSessionPayload({ config: { model: "test" } });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.name).toBe("InvalidPayload");
    expect(caught!.message).toContain("unexpected payload key 'config'");
    expect(caught!.message).toContain("Expected payload shape: { model?: string }");
  });

  it("rejects a non-object payload (number) with InvalidPayload", () => {
    let caught: Error | null = null;
    try {
      validateNewSessionPayload(42);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.name).toBe("InvalidPayload");
    expect(caught!.message).toContain("non-object payload");
    expect(caught!.message).toContain("'number'");
  });

  it("rejects a null payload with InvalidPayload", () => {
    let caught: Error | null = null;
    try {
      validateNewSessionPayload(null);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.name).toBe("InvalidPayload");
    expect(caught!.message).toContain("null payload");
  });

  it("rejects an array payload with InvalidPayload", () => {
    let caught: Error | null = null;
    try {
      validateNewSessionPayload(["claude-sonnet-4-6"]);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.name).toBe("InvalidPayload");
    expect(caught!.message).toContain("array payload");
  });

  it("rejects { model: <non-string> } with InvalidPayload", () => {
    let caught: Error | null = null;
    try {
      validateNewSessionPayload({ model: 123 });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.name).toBe("InvalidPayload");
    expect(caught!.message).toContain("non-string 'model'");
    expect(caught!.message).toContain("'number'");
  });
});
