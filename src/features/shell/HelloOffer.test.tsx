import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "@/test/render";
import { axeViolations } from "@/test/axe";

const OFF = { hello: "available", hardwareBacked: true, enabled: false, passwordRequired: null };
const ON = { ...OFF, enabled: true };
const OFFERED = { quick_unlock_offer: () => true, quick_unlock_status: () => OFF };
const TITLE = "Unlock faster with Windows Hello";

const offer = () => screen.findByRole("region", { name: TITLE });

describe("the offer to turn on Windows Hello unlock", () => {
  it("stays away unless Rust offers it", async () => {
    const { calls } = await renderApp("/");
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === "quick_unlock_offer")).toBe(true);
    });
    expect(screen.queryByRole("region", { name: TITLE })).not.toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "quick_unlock_status")).toBe(false);
  });

  it("turns it on in one click, with no password field", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/", {
      handlers: { ...OFFERED, quick_unlock_enable_now: () => ON },
    });
    const card = await offer();
    expect(within(card).getByText(/still asked for after a restart and every 7 days/)).toBeInTheDocument();
    expect(within(card).queryByText(/has no TPM/)).not.toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText("Windows Hello unlock is on")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: TITLE })).not.toBeInTheDocument();
    });
    expect(calls.find((c) => c.cmd === "quick_unlock_enable_now")?.args).toEqual({});
    expect(calls.some((c) => c.cmd === "quick_unlock_enable")).toBe(false);
    expect(screen.queryByLabelText("Master password")).not.toBeInTheDocument();
  });

  it("asks for the master password when it was typed too long ago", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/", {
      handlers: {
        ...OFFERED,
        quick_unlock_enable_now: () => {
          throw { code: "quick_unlock_password_required", message: "Enter your master password." };
        },
        quick_unlock_enable: () => ON,
      },
    });
    await user.click(within(await offer()).getByRole("button", { name: "Turn on" }));

    const dialog = await screen.findByRole("dialog", { name: "Turn on Windows Hello unlock" });
    await user.type(within(dialog).getByLabelText("Master password"), "orbit lantern cactus mosaic");
    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(calls.find((c) => c.cmd === "quick_unlock_enable")?.args).toEqual({
      password: "orbit lantern cactus mosaic",
    });
    expect(screen.queryByRole("region", { name: TITLE })).not.toBeInTheDocument();
  });

  it("stays, and says nothing changed, when the Windows Hello prompt is cancelled", async () => {
    const user = userEvent.setup();
    await renderApp("/", {
      handlers: {
        ...OFFERED,
        quick_unlock_enable_now: () => {
          throw { code: "quick_unlock_cancelled", message: "Windows Hello was cancelled." };
        },
      },
    });
    const card = await offer();
    await user.click(within(card).getByRole("button", { name: "Turn on" }));
    expect(await within(card).findByText("Windows Hello was cancelled. Nothing was changed.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Turn on" })).toBeEnabled();
  });

  it.each([
    ["Not now", false],
    ["Don't ask again", true],
  ])("goes away on %s", async (name, forever) => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/", { handlers: OFFERED });
    await user.click(within(await offer()).getByRole("button", { name }));
    expect(screen.queryByRole("region", { name: TITLE })).not.toBeInTheDocument();
    expect(calls.find((c) => c.cmd === "quick_unlock_offer_dismiss")?.args).toEqual({ forever });
    expect(calls.some((c) => c.cmd === "quick_unlock_enable_now")).toBe(false);
  });

  it("warns when this PC has no TPM", async () => {
    await renderApp("/", {
      handlers: { ...OFFERED, quick_unlock_status: () => ({ ...OFF, hardwareBacked: false }) },
    });
    expect(within(await offer()).getByText(/This PC has no TPM/)).toBeInTheDocument();
  });

  it("goes away when Windows Hello unlock is turned on in Settings", async () => {
    const user = userEvent.setup();
    await renderApp("/settings", { handlers: { ...OFFERED, quick_unlock_enable: () => ON } });
    await offer();
    await user.click(screen.getByRole("button", { name: "Turn on Windows Hello unlock" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn on Windows Hello unlock" });
    await user.type(within(dialog).getByLabelText("Master password"), "orbit lantern cactus mosaic");
    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: TITLE })).not.toBeInTheDocument();
    });
  });

  it("has no axe violations", async () => {
    const { container } = await renderApp("/", { handlers: OFFERED });
    await offer();
    expect(await axeViolations(container)).toEqual([]);
  });
});
