import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { STATUS, StatusBadge, type Status } from "./StatusBadge";

const ALL = Object.keys(STATUS) as Status[];

describe("StatusBadge", () => {
  it.each(ALL)("%s shows an icon and a text label, not just color", (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.querySelector(`[data-status="${status}"]`);
    expect(badge).not.toBeNull();
    expect(badge?.querySelector("svg")).not.toBeNull();
    expect(badge?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(STATUS[status].label)).toBeVisible();
  });

  it("accepts a more specific label", () => {
    render(<StatusBadge status="risk" label="Reused password" />);
    expect(screen.getByText("Reused password")).toBeInTheDocument();
  });

  it("uses distinct labels for every status", () => {
    const labels = ALL.map((s) => STATUS[s].label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
