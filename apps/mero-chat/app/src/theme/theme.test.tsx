import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ThemeToggle from "../components/navbar/ThemeToggle";
import { THEME_STORAGE_KEY, applyTheme, readStoredTheme } from "./theme";
import themeInit from "../../public/theme-init.js?raw";

const root = document.documentElement;

// What index.html loads in <head>, before the bundle: the no-flash path.
function runIndexHtmlThemeScript() {
  expect(themeInit, "theme-init.js sets the theme before first paint").toContain(THEME_STORAGE_KEY);
  new Function(themeInit)();
}

describe("theme switch", () => {
  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute("data-theme");
  });
  afterEach(() => {
    localStorage.clear();
    root.removeAttribute("data-theme");
  });

  it("defaults to light", () => {
    expect(readStoredTheme()).toBe("light");
    applyTheme(readStoredTheme());
    render(<ThemeToggle />);

    expect(root).not.toHaveAttribute("data-theme");
    expect(screen.getByRole("button", { name: "Use dark theme" })).toBeInTheDocument();
  });

  it("switches to dark and back, and remembers the choice", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }));
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Use light theme" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use light theme" }));
    expect(root).not.toHaveAttribute("data-theme");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(screen.getByRole("button", { name: "Use dark theme" })).toBeInTheDocument();
  });

  it("comes back dark after a reload, before the app renders", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }));

    // A reload: a fresh document with nothing on <html> yet.
    root.removeAttribute("data-theme");
    runIndexHtmlThemeScript();
    expect(root).toHaveAttribute("data-theme", "dark");
  });

  it("leaves a first visit light before the app renders", () => {
    runIndexHtmlThemeScript();
    expect(root).not.toHaveAttribute("data-theme");
  });

  it("keeps every toggle in step", () => {
    render(
      <>
        <ThemeToggle />
        <ThemeToggle />
      </>,
    );
    const [first] = screen.getAllByRole("button", { name: "Use dark theme" });
    act(() => {
      fireEvent.click(first);
    });
    expect(screen.getAllByRole("button", { name: "Use light theme" })).toHaveLength(2);
  });
});
