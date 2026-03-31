import { isCompoundExternal, isStructural } from "@tisyn/ir";
import { it, expect } from "vitest";

it("isCompoundExternal('scope') is true", () => expect(isCompoundExternal("scope")).toBe(true));
it("isCompoundExternal('all') still true", () => expect(isCompoundExternal("all")).toBe(true));
it("isStructural('scope') is false", () => expect(isStructural("scope")).toBe(false));
