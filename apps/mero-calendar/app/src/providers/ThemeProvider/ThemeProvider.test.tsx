/**
 * The in-app theme switch: light by default, the sun/moon toggle flips
 * `<html data-theme>`, and only an explicit choice is saved.
 *
 * The before-first-paint half (index.html's inline script) needs a real
 * document load and lives in e2e/theme.spec.ts.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import { THEME_STORAGE_KEY, ThemeProvider } from "./index";

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

const html = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  html().removeAttribute("data-theme");
});

afterEach(() => {
  localStorage.clear();
});

describe("ThemeProvider + ThemeToggle", () => {
  it("opens light and saves nothing until the person chooses", () => {
    renderToggle();
    expect(html().getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId("theme-toggle").getAttribute("aria-label")).toBe(
      "Switch to dark mode",
    );
  });

  it("flips to dark and back, saving each choice", () => {
    renderToggle();
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(html().getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByTestId("theme-toggle").getAttribute("aria-label")).toBe(
      "Switch to light mode",
    );

    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(html().getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("starts from a saved dark choice", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    renderToggle();
    expect(html().getAttribute("data-theme")).toBe("dark");
  });
});
