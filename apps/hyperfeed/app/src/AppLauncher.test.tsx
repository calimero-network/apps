import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AppLauncher, launcherGroups } from "./AppLauncher";

describe("launcherGroups", () => {
  it("splits the apps on your node from the rest, by the keys installed packages file under", () => {
    const { yours, more } = launcherGroups(["chat", "issue-tracker", "drive-docs", "notes"]);
    expect(yours).toEqual(["chat", "issues", "docs"]);
    expect(more).toContain("sheets");
    expect(more).not.toContain("chat");
  });

  it("lists every app as yours until the node says what is installed", () => {
    const { yours, more } = launcherGroups(null);
    expect(yours).toContain("chat");
    expect(yours).toContain("stream");
    expect(more).toEqual([]);
  });
});

describe("AppLauncher", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens an installed app in a new tab, signed in, and sends the rest to install", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const onInstall = vi.fn();
    const href = vi.fn((app: string) => `https://${app}.example/#access_token=t`);
    render(<AppLauncher installed={["chat"]} href={href} onInstall={onInstall} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apps" }));
    const panel = screen.getByRole("dialog", { name: "Apps" });
    expect(within(panel).getByText("On your node")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: /Chat/ }));
    expect(href).toHaveBeenCalledWith("chat");
    expect(open).toHaveBeenCalledWith("https://chat.example/#access_token=t", "_blank", "noopener,noreferrer");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Apps" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Sheets.*Install/ }));
    expect(onInstall).toHaveBeenCalledOnce();
    expect(href).not.toHaveBeenCalledWith("sheets");
  });

  it("closes on Escape", () => {
    render(<AppLauncher installed={null} href={() => null} />);
    fireEvent.click(screen.getByRole("button", { name: "Apps" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
