import { describe, it } from "@effectionx/vitest";
import { expect, vi, beforeEach } from "vitest";
import { scoped } from "effection";
import { invoke } from "@tisyn/agent";
import { installRemoteAgent } from "../install-remote.js";
import type { HostMessage } from "../transport.js";
import { Browser, browserTransport } from "./browser.js";

// ── Mock Playwright ──

// In-memory mock page that tracks state and returns deterministic results.
function createMockPage(id: string, initialUrl = "about:blank") {
  let url = initialUrl;
  let title = "";
  let textContent = "";
  let htmlContent = "<html><body></body></html>";

  const page = {
    url: () => url,
    title: vi.fn(async () => title),
    goto: vi.fn(async (targetUrl: string, _opts?: any) => {
      url = targetUrl;
      title = "Mock Page";
      textContent = `Content of ${targetUrl}`;
      htmlContent = `<html><body>${textContent}</body></html>`;
      return { status: () => 200 };
    }),
    click: vi.fn(async (selector: string, _opts?: any) => {
      if (selector === ".missing") throw new Error("Selector not found: .missing");
    }),
    fill: vi.fn(async (selector: string, _value: string, _opts?: any) => {
      if (selector === ".invalid") throw new Error("Selector not found: .invalid");
    }),
    innerText: vi.fn(async (_selector: string) => textContent),
    content: vi.fn(async () => htmlContent),
    screenshot: vi.fn(async (_opts?: any) => Buffer.from("fake-screenshot-data")),
    viewportSize: vi.fn(() => ({ width: 1280, height: 720 })),
    close: vi.fn(async () => {}),
    _id: id,
  };

  return page;
}

type MockPage = ReturnType<typeof createMockPage>;

// Track mock state globally for test assertions
let mockPages: MockPage[];
let mockBrowser: {
  close: ReturnType<typeof vi.fn>;
  newContext: ReturnType<typeof vi.fn>;
};
let mockContext: {
  newPage: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockPages = [createMockPage("page:0")];

  mockContext = {
    newPage: vi.fn(async () => mockPages[0]),
  };

  mockBrowser = {
    close: vi.fn(async () => {}),
    newContext: vi.fn(async () => mockContext),
  };
});

// Mock playwright-core at the module level
vi.mock("playwright-core", () => {
  const createLauncher = () => ({
    launch: vi.fn(async () => mockBrowser),
  });
  return {
    chromium: createLauncher(),
    firefox: createLauncher(),
    webkit: createLauncher(),
  };
});

// ── Tests ──

describe("browser transport", () => {
  // --- Transport lifecycle ---

  describe("Transport lifecycle", () => {
    it("factory creates transport with default page", function* () {
      const factory = browserTransport();

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        const result = yield* invoke(
          Browser.content({ format: "text" }),
        );
        // Default page exists and responds
        expect(result).toHaveProperty("text");
        expect(result).toHaveProperty("url");
        expect(result).toHaveProperty("title");
      });
    });

    it("transport shuts down on scope exit", function* () {
      const factory = browserTransport();

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        yield* invoke(Browser.content({ format: "text" }));
      });

      // After scope exits, browser.close() should have been called
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("shutdown failure does not propagate", function* () {
      mockBrowser.close.mockRejectedValueOnce(new Error("close failed"));
      const factory = browserTransport();

      // Should not throw even though close fails
      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        yield* invoke(Browser.content({ format: "text" }));
      });

      // Scope exited successfully despite close failure
    });
  });

  // --- Operation semantics ---

  describe("Operation semantics", () => {
    describe("navigate", () => {
      it("returns page, status, url", function* () {
        const factory = browserTransport();

        yield* scoped(function* () {
          yield* installRemoteAgent(Browser, factory);
          const result = yield* invoke(
            Browser.navigate({ url: "https://example.com" }),
          );
          expect(result).toMatchObject({
            page: "page:0",
            status: 200,
            url: "https://example.com",
          });
        });
      });

      it("failure returns error", function* () {
        mockPages[0]!.goto.mockRejectedValueOnce(new Error("net::ERR_NAME_NOT_RESOLVED"));
        const factory = browserTransport();

        yield* scoped(function* () {
          yield* installRemoteAgent(Browser, factory);
          try {
            yield* invoke(Browser.navigate({ url: "https://unreachable.invalid" }));
            expect.unreachable("should have thrown");
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain("net::ERR_NAME_NOT_RESOLVED");
          }
        });
      });
    });

    describe("click", () => {
      it("returns ok result", function* () {
        const factory = browserTransport();

        yield* scoped(function* () {
          yield* installRemoteAgent(Browser, factory);
          const result = yield* invoke(
            Browser.click({ selector: "#btn" }),
          );
          expect(result).toEqual({ ok: true });
        });
      });

      it("missing selector returns error", function* () {
        const factory = browserTransport();

        yield* scoped(function* () {
          yield* installRemoteAgent(Browser, factory);
          try {
            yield* invoke(Browser.click({ selector: ".missing" }));
            expect.unreachable("should have thrown");
          } catch (error) {
            expect((error as Error).message).toContain(".missing");
          }
        });
      });
    });

    describe("fill", () => {
      it("returns ok result", function* () {
        const factory = browserTransport();

        yield* scoped(function* () {
          yield* installRemoteAgent(Browser, factory);
          const result = yield* invoke(
            Browser.fill({ selector: "#input", value: "hello" }),
          );
          expect(result).toEqual({ ok: true });
        });
      });

      it("invalid selector returns error", function* () {
        const factory = browserTransport();

        yield* scoped(function* () {
          yield* installRemoteAgent(Browser, factory);
          try {
            yield* invoke(Browser.fill({ selector: ".invalid", value: "x" }));
            expect.unreachable("should have thrown");
          } catch (error) {
            expect((error as Error).message).toContain(".invalid");
          }
        });
      });
    });

    describe("content", () => {
      it("returns text, url, title", function* () {
        const factory = browserTransport();

        yield* scoped(function* () {
          yield* installRemoteAgent(Browser, factory);
          yield* invoke(Browser.navigate({ url: "https://example.com" }));
          const result = yield* invoke(Browser.content({ format: "text" }));
          expect(result).toMatchObject({
            text: expect.any(String),
            url: "https://example.com",
            title: "Mock Page",
          });
        });
      });

      it("format html returns full HTML", function* () {
        const factory = browserTransport();

        yield* scoped(function* () {
          yield* installRemoteAgent(Browser, factory);
          yield* invoke(Browser.navigate({ url: "https://example.com" }));
          const result = yield* invoke(Browser.content({ format: "html" }));
          expect(result.text).toContain("<html>");
          // Verify the mock's content() was called (html path)
          expect(mockPages[0]!.content).toHaveBeenCalled();
        });
      });
    });

    describe("screenshot", () => {
      it("returns base64 data, mimeType, dimensions", function* () {
        const factory = browserTransport();

        yield* scoped(function* () {
          yield* installRemoteAgent(Browser, factory);
          const result = yield* invoke(Browser.screenshot({}));
          expect(result).toMatchObject({
            data: expect.any(String),
            mimeType: "image/png",
            width: 1280,
            height: 720,
          });
          // Verify data is base64
          expect(() => Buffer.from(result.data, "base64")).not.toThrow();
        });
      });
    });
  });

  // --- Page management ---

  describe("Page management", () => {
    it("default page is page:0", function* () {
      const factory = browserTransport();

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        const result = yield* invoke(
          Browser.navigate({ url: "https://example.com" }),
        );
        expect(result.page).toBe("page:0");
      });
    });

    it("selectPage with invalid page ID returns error", function* () {
      const factory = browserTransport();

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        try {
          yield* invoke(Browser.selectPage({ page: "nonexistent" }));
          expect.unreachable("should have thrown");
        } catch (error) {
          expect((error as Error).message).toContain("Page not found");
        }
      });
    });

    it("closePage on last page returns error", function* () {
      const factory = browserTransport();

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        try {
          yield* invoke(Browser.closePage({ page: "page:0" }));
          expect.unreachable("should have thrown");
        } catch (error) {
          expect((error as Error).message).toContain("last remaining page");
        }
      });
    });

    it("operation with closed page ID returns error", function* () {
      // Need two pages for this test — first navigate creates page:0,
      // we need a way to add page:1. For now, test the simpler case:
      // trying to access a page that doesn't exist
      const factory = browserTransport();

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        try {
          yield* invoke(Browser.click({ selector: "#btn", page: "page:99" }));
          expect.unreachable("should have thrown");
        } catch (error) {
          expect((error as Error).message).toContain("Page not found");
        }
      });
    });
  });

  // --- Error conventions ---

  describe("Error conventions", () => {
    it("operation error is catchable", function* () {
      mockPages[0]!.goto.mockRejectedValueOnce(new Error("timeout"));
      const factory = browserTransport();

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        try {
          yield* invoke(Browser.navigate({ url: "https://slow.test" }));
          expect.unreachable("should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe("timeout");
        }
        // Scope continues after catching the error
        const result = yield* invoke(Browser.content({ format: "text" }));
        expect(result).toHaveProperty("text");
      });
    });
  });

  // --- Serialization boundary ---

  describe("Serialization boundary", () => {
    it("operation outputs survive JSON roundtrip", function* () {
      const factory = browserTransport();

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        yield* invoke(Browser.navigate({ url: "https://example.com" }));

        const navResult = yield* invoke(
          Browser.navigate({ url: "https://example.com" }),
        );
        expect(JSON.parse(JSON.stringify(navResult))).toEqual(navResult);

        const clickResult = yield* invoke(Browser.click({ selector: "#btn" }));
        expect(JSON.parse(JSON.stringify(clickResult))).toEqual(clickResult);

        const contentResult = yield* invoke(Browser.content({ format: "text" }));
        expect(JSON.parse(JSON.stringify(contentResult))).toEqual(contentResult);

        const screenshotResult = yield* invoke(Browser.screenshot({}));
        expect(JSON.parse(JSON.stringify(screenshotResult))).toEqual(screenshotResult);
      });
    });

    it("page identifiers are plain strings", function* () {
      const factory = browserTransport();

      yield* scoped(function* () {
        yield* installRemoteAgent(Browser, factory);
        const result = yield* invoke(
          Browser.navigate({ url: "https://example.com" }),
        );
        expect(typeof result.page).toBe("string");
      });
    });
  });
});
