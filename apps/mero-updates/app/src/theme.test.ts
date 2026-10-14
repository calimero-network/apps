import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY, applyTheme, readStoredTheme, setTheme, useTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = '<meta name="theme-color" content="#f6f7fb" />';
});

describe("theme", () => {
  it("is light until someone picks dark, under this app's own key", () => {
    expect(THEME_STORAGE_KEY).toBe("mero-updates:theme");
    expect(readStoredTheme()).toBe("light");
    localStorage.setItem("mero-crm:theme", "dark");
    expect(readStoredTheme()).toBe("light");
  });

  it("puts dark on <html> and the browser chrome, and removes it again", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#0b0e18");
    applyTheme("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#f6f7fb");
  });

  it("remembers the choice and every useTheme caller follows the toggle", () => {
    const a = renderHook(() => useTheme());
    const b = renderHook(() => useTheme());
    expect(a.result.current.theme).toBe("light");
    act(() => a.result.current.toggleTheme());
    expect(a.result.current.theme).toBe("dark");
    expect(b.result.current.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    act(() => setTheme("light"));
    expect(b.result.current.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
