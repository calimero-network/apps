import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallPage, browserName, extensionsPage } from "./InstallPage";

afterEach(cleanup);

const nav = (ua: string, brave = false) => ({ userAgent: ua, ...(brave ? { brave: {} } : {}) }) as unknown as Navigator;
const CHROME = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

describe("install page", () => {
  it("knows Brave, Edge and Chrome, and their extensions pages", () => {
    expect(browserName(nav(CHROME, true))).toBe("brave");
    expect(browserName(nav(`${CHROME} Edg/131.0`))).toBe("edge");
    expect(browserName(nav(CHROME))).toBe("chrome");
    expect(browserName(nav("Mozilla/5.0 Firefox/130.0"))).toBe("other");
    expect(extensionsPage("brave")).toBe("brave://extensions");
    expect(extensionsPage("edge")).toBe("edge://extensions");
    expect(extensionsPage("chrome")).toBe("chrome://extensions");
  });

  it("offers the zip, the version and the steps, and copies the extensions address", async () => {
    const write = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: write } });
    const onBack = vi.fn();
    render(<InstallPage onBack={onBack} backLabel="All meetings" />);
    const link = screen.getByTestId("download-extension") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("./sylence-extension.zip");
    expect(link.getAttribute("download")).toBe("sylence-extension.zip");
    expect(screen.getByText(/Version \d+\.\d+\.\d+/)).toBeTruthy();
    expect(screen.getByText(/Load unpacked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(write).toHaveBeenCalledWith(screen.getByTestId("extensions-address").textContent);
    expect(await screen.findByText("Copied")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /All meetings/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
