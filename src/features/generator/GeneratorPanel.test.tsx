import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { Button } from "@/components/ui/button";
import type { Generated } from "@/ipc/client";
import { axeViolations } from "@/test/axe";
import { renderApp } from "@/test/render";
import { GeneratorPopover } from "./GeneratorPopover";
import { resetGeneratorSettings } from "./useGenerator";

/** Distinct values per call, so "Generate another" is visible. */
function fakeGenerator() {
  let n = 0;
  return () => {
    n += 1;
    return { value: `Kq7#vR2!mZ9$wT4@pL${String(n)}`, entropyBits: 129.4, score: 4 } satisfies Generated;
  };
}

function renderGenerator(handlers: Parameters<typeof renderApp>[1] = {}) {
  const next = fakeGenerator();
  return renderApp("/generator", {
    ...handlers,
    handlers: { generate_password: next, generate_passphrase: next, ...handlers.handlers },
  });
}

const value = () => screen.getByTestId("generated-value");
const lastCall = (calls: { cmd: string; args: Record<string, unknown> }[], cmd: string) =>
  calls.filter((c) => c.cmd === cmd).at(-1)?.args;

beforeEach(() => {
  resetGeneratorSettings();
});

describe("generator page", () => {
  it("generates with the defaults and shows strength as text", async () => {
    const { calls } = await renderGenerator();
    expect(await screen.findByRole("heading", { level: 1, name: "Generator" })).toBeInTheDocument();
    await waitFor(() => {
      expect(value()).toHaveTextContent("Kq7#vR2!mZ9$wT4@pL1");
    });
    expect(lastCall(calls, "generate_password")).toEqual({
      options: {
        length: 20,
        uppercase: true,
        lowercase: true,
        digits: true,
        symbols: true,
        excludeAmbiguous: false,
        exclude: "",
      },
    });
    expect(screen.getByTestId("strength-label")).toHaveTextContent("Strong");
    expect(screen.getByText("129 bits")).toBeInTheDocument();
  });

  it("regenerates when an option changes", async () => {
    const user = userEvent.setup();
    const { calls } = await renderGenerator();
    await waitFor(() => {
      expect(value()).toHaveTextContent("pL1");
    });
    await user.click(screen.getByRole("switch", { name: "Symbols" }));
    await waitFor(() => {
      expect(lastCall(calls, "generate_password")).toMatchObject({ options: { symbols: false } });
    });
    await user.click(screen.getByRole("switch", { name: "Avoid look-alike characters" }));
    await waitFor(() => {
      expect(lastCall(calls, "generate_password")).toMatchObject({ options: { excludeAmbiguous: true } });
    });
    const length = screen.getByRole("spinbutton", { name: "Length" });
    await user.clear(length);
    await user.type(length, "32");
    await waitFor(() => {
      expect(lastCall(calls, "generate_password")).toMatchObject({ options: { length: 32 } });
    });
    expect(screen.getByRole("slider", { name: "Length" })).toHaveAttribute("aria-valuenow", "32");
  });

  it("ignores out-of-range lengths while typing", async () => {
    const user = userEvent.setup();
    const { calls } = await renderGenerator();
    const length = await screen.findByRole("spinbutton", { name: "Length" });
    await user.clear(length);
    // "1" is too short, "12" is valid, "129" is too long: the last valid value sticks.
    await user.type(length, "129");
    await user.tab();
    expect(calls.filter((c) => c.cmd === "generate_password").every((c) => {
      const n = (c.args.options as { length: number }).length;
      return n >= 8 && n <= 128;
    })).toBe(true);
    expect(length).toHaveValue(12);
  });

  it("won't turn off the last character type", async () => {
    const user = userEvent.setup();
    await renderGenerator();
    for (const name of ["Uppercase letters", "Lowercase letters", "Numbers"]) {
      await user.click(await screen.findByRole("switch", { name }));
    }
    const symbols = screen.getByRole("switch", { name: "Symbols" });
    expect(symbols).toBeChecked();
    expect(symbols).toBeDisabled();
    expect(symbols).toHaveAccessibleDescription(/At least one type of character is needed/);
    await user.click(screen.getByRole("switch", { name: "Numbers" }));
    expect(symbols).toBeEnabled();
  });

  it("explains an exclusion that empties a type, and blocks Copy", async () => {
    const user = userEvent.setup();
    await renderGenerator({
      handlers: {
        generate_password: (args) => {
          const { exclude } = args.options as { exclude: string };
          if (exclude.includes("0123456789")) {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw { code: "invalid_input", message: "Check the highlighted field.", field: "exclude" };
          }
          return { value: "Kq7#vR2!mZ9$wT4@pLxY", entropyBits: 129.4, score: 4 };
        },
      },
    });
    const exclude = await screen.findByRole("textbox", { name: "Leave out characters" });
    await user.type(exclude, "0123456789");
    expect(await screen.findByText(/leaves a selected character type with nothing to use/)).toBeInTheDocument();
    expect(exclude).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
  });

  it("copies through Rust and shows the clipboard toast", async () => {
    const user = userEvent.setup();
    const { calls } = await renderGenerator();
    await waitFor(() => {
      expect(value()).toHaveTextContent("pL1");
    });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(lastCall(calls, "clipboard_copy_plain")).toEqual({ text: "Kq7#vR2!mZ9$wT4@pL1" });
    await waitFor(() => {
      expect(document.querySelector('[data-toast-id="clipboard"]')).toHaveTextContent("Password copied");
    });
  });

  it("Generate another asks Rust again", async () => {
    const user = userEvent.setup();
    await renderGenerator();
    await waitFor(() => {
      expect(value()).toHaveTextContent("pL1");
    });
    await user.click(screen.getByRole("button", { name: "Generate another" }));
    await waitFor(() => {
      expect(value()).toHaveTextContent("pL2");
    });
  });

  it("switches to passphrases", async () => {
    const user = userEvent.setup();
    const { calls } = await renderGenerator();
    await user.click(await screen.findByRole("radio", { name: "Passphrase" }));
    await waitFor(() => {
      expect(lastCall(calls, "generate_passphrase")).toEqual({
        options: { words: 5, separator: "-", capitalize: false, includeNumber: false },
      });
    });
    await user.click(screen.getByRole("radio", { name: "Space" }));
    await user.click(screen.getByRole("switch", { name: "Add a number" }));
    await waitFor(() => {
      expect(lastCall(calls, "generate_passphrase")).toMatchObject({
        options: { separator: " ", includeNumber: true },
      });
    });
    expect(screen.queryByRole("switch", { name: "Symbols" })).not.toBeInTheDocument();
  });

  it("is reachable from the sidebar and the palette", async () => {
    const user = userEvent.setup();
    await renderApp("/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Generator" })).toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("combobox"), "passphrase");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "Generator" })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = await renderGenerator();
    await waitFor(() => {
      expect(value()).toHaveTextContent("pL1");
    });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("generator popover", () => {
  it("hands the value to the form and closes", async () => {
    const user = userEvent.setup();
    const next = fakeGenerator();
    mockIPC((cmd) => (cmd === "generate_password" ? next() : null));
    const onUse = vi.fn();
    render(
      <GeneratorPopover onUse={onUse}>
        <Button>Generate</Button>
      </GeneratorPopover>,
    );
    await user.click(screen.getByRole("button", { name: "Generate" }));
    const dialog = await screen.findByRole("dialog", { name: "Generate a password" });
    await waitFor(() => {
      expect(within(dialog).getByTestId("generated-value")).toHaveTextContent("pL1");
    });
    await user.click(within(dialog).getByRole("button", { name: "Use password" }));
    expect(onUse).toHaveBeenCalledWith("Kq7#vR2!mZ9$wT4@pL1");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
