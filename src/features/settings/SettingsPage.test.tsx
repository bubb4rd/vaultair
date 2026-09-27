import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_SESSION_CONFIG, renderApp } from "@/test/render";
import { axeViolations } from "@/test/axe";

function policy(mode: string, level: string) {
  return {
    ...DEFAULT_SESSION_CONFIG,
    captureMode: mode,
    captureLevel: level,
    captureProtection: mode === "always",
  };
}

describe("screenshot protection settings", () => {
  it("saves the mode and the account rating", async () => {
    const user = userEvent.setup();
    const { calls } = await renderApp("/settings", {
      handlers: {
        capture_policy_set: (args) => policy(String(args.mode), String(args.level)),
      },
    });

    const mode = await screen.findByLabelText("Screenshot protection");
    const level = screen.getByLabelText("Protect accounts rated");
    expect(mode).toHaveValue("always");
    expect(level).toBeDisabled();
    expect(mode).toHaveAccessibleDescription(/including the lock screen/);

    await user.selectOptions(mode, "custom");
    expect(calls).toContainEqual({ cmd: "capture_policy_set", args: { mode: "custom", level: "risk" } });
    expect(level).toBeEnabled();
    expect(mode).toHaveAccessibleDescription(/High risk/);

    await user.selectOptions(level, "warning");
    expect(calls).toContainEqual({ cmd: "capture_policy_set", args: { mode: "custom", level: "warning" } });
    expect(mode).toHaveAccessibleDescription(/Warning and worse/);

    await user.selectOptions(mode, "off");
    expect(level).toBeDisabled();
    expect(calls).toContainEqual({ cmd: "capture_policy_set", args: { mode: "off", level: "warning" } });
  });

  it("has no axe violations", async () => {
    const { container } = await renderApp("/settings");
    await screen.findByLabelText("Screenshot protection");
    expect(await axeViolations(container)).toEqual([]);
  });
});
