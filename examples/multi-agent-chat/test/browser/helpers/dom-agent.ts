import { call } from "effection";
import { screen, waitFor } from "@testing-library/dom";

export function createDomAgentHandlers() {
  return {
    *fill({ name, value }: { name: string; value: string }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.getByRole("textbox", {
              name,
            }) as HTMLInputElement;
            if (el.disabled) {
              throw new Error(`Textbox "${name}" is disabled`);
            }
            const nativeSetter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            )!.set!;
            nativeSetter.call(el, value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
          },
          { timeout: 5000 },
        ),
      );
    },

    *click({ role, name }: { role: string; name: string }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.getByRole(role as any, {
              name,
            }) as HTMLButtonElement;
            if (el.disabled) {
              throw new Error(`${role} "${name}" is disabled`);
            }
            el.click();
          },
          { timeout: 5000 },
        ),
      );
    },

    *pressKey({ key }: { key: string }) {
      yield* call(() =>
        waitFor(() => {
          const active = document.activeElement;
          if (!active) {
            throw new Error("No focused element");
          }
          active.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
          active.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
        }),
      );
    },

    *expectVisible({ text }: { text: string }) {
      yield* call(() =>
        waitFor(
          () => {
            screen.getByText(text);
          },
          { timeout: 5000 },
        ),
      );
    },

    *expectNotVisible({ text }: { text: string }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.queryByText(text);
            if (el) {
              throw new Error(`Expected "${text}" to not be visible`);
            }
          },
          { timeout: 5000 },
        ),
      );
    },

    *expectDisabled({ role, name }: { role: string; name: string }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.getByRole(role as any, {
              name,
            }) as HTMLInputElement;
            if (!el.disabled) {
              throw new Error(`Expected ${role} "${name}" to be disabled`);
            }
          },
          { timeout: 5000 },
        ),
      );
    },

    *expectEnabled({ role, name }: { role: string; name: string }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.getByRole(role as any, {
              name,
            }) as HTMLInputElement;
            if (el.disabled) {
              throw new Error(`Expected ${role} "${name}" to be enabled`);
            }
          },
          { timeout: 5000 },
        ),
      );
    },

    *expectStatusText({ text }: { text: string }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.getByRole("status");
            const actual = el.textContent?.trim();
            if (actual !== text) {
              throw new Error(`Expected status "${text}" but got "${actual}"`);
            }
          },
          { timeout: 5000 },
        ),
      );
    },

    // Uses the transcript DOM contract: role="log" > .message children
    *expectTranscript({ messages }: { messages: string[] }) {
      yield* call(() =>
        waitFor(
          () => {
            const log = screen.getByRole("log");
            const messageEls = log.querySelectorAll(".message");
            if (messageEls.length !== messages.length) {
              throw new Error(`Expected ${messages.length} messages, got ${messageEls.length}`);
            }
            for (let i = 0; i < messages.length; i++) {
              const actual = messageEls[i]!.textContent?.trim();
              if (actual !== messages[i]) {
                throw new Error(`Message ${i}: expected "${messages[i]}" but got "${actual}"`);
              }
            }
          },
          { timeout: 5000 },
        ),
      );
    },
  };
}
