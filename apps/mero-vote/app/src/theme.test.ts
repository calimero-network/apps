import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_COLOR, THEME_STORAGE_KEY, applyTheme, currentTheme, readStoredTheme, setTheme } from "./theme";

const html = () => document.documentElement;
const meta = () => document.querySelector('meta[name="theme-color"]')!;

beforeEach(() => {
  localStorage.clear();
  html().removeAttribute("data-theme");
  document.head.innerHTML = `<meta name="theme-color" content="${THEME_COLOR.light}" />`;
});

afterEach(() => {
  localStorage.clear();
  html().removeAttribute("data-theme");
});

describe("theme", () => {
  it("defaults to light when nothing was chosen", () => {
    expect(readStoredTheme()).toBe("light");
    applyTheme(readStoredTheme());
    expect(html().getAttribute("data-theme")).toBeNull();
    expect(currentTheme()).toBe("light");
  });

  it("keeps its own key, not one shared with other apps", () => {
    expect(THEME_STORAGE_KEY).toBe("mero-vote:theme");
    localStorage.setItem("app:theme", "dark");
    localStorage.setItem("mero-crm:theme", "dark");
    expect(readStoredTheme()).toBe("light");
  });

  it("reads anything but an explicit \"dark\" as light", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(readStoredTheme()).toBe("light");
  });

  it("setTheme remembers the choice, marks <html> and the browser chrome, and tells subscribers", () => {
    const events: string[] = [];
    const on = (e: Event) => events.push(e.type);
    window.addEventListener("mero-vote:theme-change", on);

    setTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(html().getAttribute("data-theme")).toBe("dark");
    expect(meta().getAttribute("content")).toBe(THEME_COLOR.dark);
    expect(currentTheme()).toBe("dark");

    setTheme("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(html().getAttribute("data-theme")).toBeNull();
    expect(meta().getAttribute("content")).toBe(THEME_COLOR.light);
    expect(events).toEqual(["mero-vote:theme-change", "mero-vote:theme-change"]);
    window.removeEventListener("mero-vote:theme-change", on);
  });

  // The no-flash path: index.html loads this before the bundle. A script file,
  // not an inline one, because the node's CSP forbids inline scripts.
  it("theme-init.js puts a saved dark theme on <html> before the app runs", () => {
    const indexHtml = readFileSync(path.resolve(__dirname, "..", "index.html"), "utf-8");
    expect(indexHtml).toContain('<script src="./theme-init.js"></script>');
    const themeScript = readFileSync(path.resolve(__dirname, "..", "public", "theme-init.js"), "utf-8");
    expect(themeScript).toContain(THEME_STORAGE_KEY);

    new Function(themeScript)();
    expect(html().getAttribute("data-theme")).toBeNull();

    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(themeScript)();
    expect(html().getAttribute("data-theme")).toBe("dark");
    expect(meta().getAttribute("content")).toBe(THEME_COLOR.dark);
  });
});
