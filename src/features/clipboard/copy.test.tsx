import { describe, expect, it } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { SAMPLE_COPY_TEXT } from "@/features/settings/DevPanel";
import { renderApp } from "@/test/render";
import { CLIPBOARD_TOAST_ID } from "./copy";

const clipboardToast = () => document.querySelector(`[data-toast-id="${CLIPBOARD_TOAST_ID}"]`);

async function copySample(options?: Parameters<typeof renderApp>[1]) {
  const user = userEvent.setup();
  const app = await renderApp("/settings", options);
  await user.click(await screen.findByRole("button", { name: "Copy sample value" }));
  return { user, ...app };
}

describe("copy to clipboard", () => {
  it("copies through Rust and shows a countdown toast", async () => {
    const { calls } = await copySample();
    expect(calls).toContainEqual({ cmd: "clipboard_copy_plain", args: { text: SAMPLE_COPY_TEXT } });

    await waitFor(() => {
      expect(clipboardToast()).toHaveTextContent("Sample value copied");
    });
    expect(clipboardToast()).toHaveTextContent("30s");
    expect(document.querySelector('[data-toast-live="polite"]')).toHaveTextContent(
      "Sample value copied. It will be cleared from the clipboard in 30 seconds.",
    );
  });

  it("Keep in clipboard cancels the clear", async () => {
    const { user, calls } = await copySample();
    await user.click(await screen.findByRole("button", { name: "Keep in clipboard" }));
    expect(calls.some((c) => c.cmd === "clipboard_cancel_clear")).toBe(true);
    await waitFor(() => {
      expect(clipboardToast()).toHaveTextContent("Sample value kept in clipboard");
    });
  });

  it("Clear now clears through Rust", async () => {
    const { user, calls } = await copySample();
    await user.click(await screen.findByRole("button", { name: "Clear now" }));
    expect(calls.some((c) => c.cmd === "clipboard_clear_now")).toBe(true);
    await waitFor(() => {
      expect(clipboardToast()).toHaveTextContent("Clipboard cleared");
    });
  });

  it("switches to cleared when Rust's timer fires", async () => {
    await copySample();
    await screen.findByRole("button", { name: "Keep in clipboard" });
    await act(async () => {
      await emit("clipboard://cleared", null);
    });
    await waitFor(() => {
      expect(clipboardToast()).toHaveTextContent("Clipboard cleared");
    });
  });

  it("says why a copy failed, without raw error text", async () => {
    await copySample({
      handlers: {
        clipboard_copy_plain: () => {
          throw { code: "clipboard_busy", message: "Another app is using the clipboard. Try again." };
        },
      },
    });
    await waitFor(() => {
      expect(clipboardToast()).toHaveTextContent("Couldn't copy");
    });
    expect(document.querySelector('[data-toast-live="assertive"]')).toHaveTextContent(
      "Couldn't copy. Another app is using the clipboard. Try again.",
    );
  });
});
