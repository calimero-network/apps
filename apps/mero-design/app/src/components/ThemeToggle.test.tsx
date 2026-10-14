import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ThemeToggle from "./ThemeToggle";
import { THEME_KEY, readStoredTheme, resetThemeForTests } from "../utils/theme";

describe("theme switch", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    resetThemeForTests();
  });
  afterEach(() => cleanup());

  it("defaults to light", () => {
    render(<ThemeToggle />);
    expect(readStoredTheme()).toBe("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(screen.getByRole("button", { name: "Use dark theme" })).toBeTruthy();
  });

  it("switches to dark, marks <html> and remembers the choice", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Use light theme" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use light theme" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("starts from a stored dark choice", () => {
    localStorage.setItem(THEME_KEY, "dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Use light theme" })).toBeTruthy();
  });

  it("keeps every toggle on the page in step", () => {
    render(<><ThemeToggle /><ThemeToggle /></>);
    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "Use dark theme" })[0]);
    });
    expect(screen.getAllByRole("button", { name: "Use light theme" })).toHaveLength(2);
  });
});
