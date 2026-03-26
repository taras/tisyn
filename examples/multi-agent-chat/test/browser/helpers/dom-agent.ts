import { call } from "effection";
import { agent, operation } from "@tisyn/agent";
import { screen, waitFor } from "@testing-library/dom";

export function createDomAgent() {
  return agent("dom", {
    fill: operation<{ input: { name: string; value: string } }, void>(),
    click: operation<{ input: { role: string; name: string } }, void>(),
    pressKey: operation<{ input: { key: string } }, void>(),
    expectVisible: operation<{ input: { text: string } }, void>(),
    expectNotVisible: operation<{ input: { text: string } }, void>(),
    expectDisabled: operation<{ input: { role: string; name: string } }, void>(),
    expectEnabled: operation<{ input: { role: string; name: string } }, void>(),
    expectTranscript: operation<{ input: { messages: string[] } }, void>(),
    expectStatusText: operation<{ input: { text: string } }, void>(),
  });
}

export function createDomAgentHandlers() {
  return {
    *fill({ input }: { input: { name: string; value: string } }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.getByRole("textbox", {
              name: input.name,
            }) as HTMLInputElement;
            if (el.disabled)
              throw new Error(`Textbox "${input.name}" is disabled`);
            const nativeSetter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            )!.set!;
            nativeSetter.call(el, input.value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
          },
          { timeout: 5000 },
        ),
      );
    },

    *click({ input }: { input: { role: string; name: string } }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.getByRole(input.role as any, {
              name: input.name,
            }) as HTMLButtonElement;
            if (el.disabled)
              throw new Error(`${input.role} "${input.name}" is disabled`);
            el.click();
          },
          { timeout: 5000 },
        ),
      );
    },

    *pressKey({ input }: { input: { key: string } }) {
      yield* call(() =>
        waitFor(() => {
          const active = document.activeElement;
          if (!active) throw new Error("No focused element");
          active.dispatchEvent(
            new KeyboardEvent("keydown", { key: input.key, bubbles: true }),
          );
          active.dispatchEvent(
            new KeyboardEvent("keyup", { key: input.key, bubbles: true }),
          );
        }),
      );
    },

    *expectVisible({ input }: { input: { text: string } }) {
      yield* call(() =>
        waitFor(
          () => {
            screen.getByText(input.text);
          },
          { timeout: 5000 },
        ),
      );
    },

    *expectNotVisible({ input }: { input: { text: string } }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.queryByText(input.text);
            if (el)
              throw new Error(`Expected "${input.text}" to not be visible`);
          },
          { timeout: 5000 },
        ),
      );
    },

    *expectDisabled({ input }: { input: { role: string; name: string } }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.getByRole(input.role as any, {
              name: input.name,
            }) as HTMLInputElement;
            if (!el.disabled)
              throw new Error(
                `Expected ${input.role} "${input.name}" to be disabled`,
              );
          },
          { timeout: 5000 },
        ),
      );
    },

    *expectEnabled({ input }: { input: { role: string; name: string } }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.getByRole(input.role as any, {
              name: input.name,
            }) as HTMLInputElement;
            if (el.disabled)
              throw new Error(
                `Expected ${input.role} "${input.name}" to be enabled`,
              );
          },
          { timeout: 5000 },
        ),
      );
    },

    *expectStatusText({ input }: { input: { text: string } }) {
      yield* call(() =>
        waitFor(
          () => {
            const el = screen.getByRole("status");
            const actual = el.textContent?.trim();
            if (actual !== input.text) {
              throw new Error(
                `Expected status "${input.text}" but got "${actual}"`,
              );
            }
          },
          { timeout: 5000 },
        ),
      );
    },

    // Uses the transcript DOM contract: role="log" > .message children
    *expectTranscript({ input }: { input: { messages: string[] } }) {
      yield* call(() =>
        waitFor(
          () => {
            const log = screen.getByRole("log");
            const messageEls = log.querySelectorAll(".message");
            if (messageEls.length !== input.messages.length) {
              throw new Error(
                `Expected ${input.messages.length} messages, got ${messageEls.length}`,
              );
            }
            for (let i = 0; i < input.messages.length; i++) {
              const actual = messageEls[i]!.textContent?.trim();
              if (actual !== input.messages[i]) {
                throw new Error(
                  `Message ${i}: expected "${input.messages[i]}" but got "${actual}"`,
                );
              }
            }
          },
          { timeout: 5000 },
        ),
      );
    },
  };
}
