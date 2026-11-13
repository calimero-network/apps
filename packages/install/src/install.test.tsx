import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InstallAppButton } from "./index";

describe("InstallAppButton", () => {
  it("renders only once the browser offers installing, and opens its dialog", async () => {
    render(<InstallAppButton>Install</InstallAppButton>);
    expect(screen.queryByTestId("install-app")).toBeNull();

    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event("beforeinstallprompt"), { prompt, userChoice: Promise.resolve({ outcome: "accepted" }) });
    act(() => {
      window.dispatchEvent(event);
    });
    const button = screen.getByTestId("install-app");
    await act(async () => button.click());
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("install-app")).toBeNull();
  });
});
