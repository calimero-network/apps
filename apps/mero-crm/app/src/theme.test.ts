import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEME_COLOR, THEME_STORAGE_KEY, applyTheme, currentTheme, readStoredTheme, setTheme } from './theme';

// This project's vitest runs in the node environment (no jsdom), so the few
// browser objects the theme touches are stood up by hand: storage, <html>'s
// attributes, the theme-color meta, and window events.
class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

function fakeElement() {
  const attrs = new Map<string, string>();
  return {
    getAttribute: (k: string) => (attrs.has(k) ? attrs.get(k)! : null),
    setAttribute: (k: string, v: string) => { attrs.set(k, v); },
    removeAttribute: (k: string) => { attrs.delete(k); },
  };
}

type Fake = ReturnType<typeof fakeElement>;
let html: Fake;
let meta: Fake;
let events: string[];

beforeEach(() => {
  html = fakeElement();
  meta = fakeElement();
  meta.setAttribute('content', THEME_COLOR.light);
  events = [];
  const g = globalThis as Record<string, unknown>;
  g.localStorage = new FakeStorage();
  g.document = {
    documentElement: html,
    querySelector: () => meta,
    querySelectorAll: () => [meta],
  };
  g.window = {
    dispatchEvent: (e: { type: string }) => { events.push(e.type); return true; },
  };
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.localStorage;
  delete g.document;
  delete g.window;
});

describe('theme', () => {
  it('defaults to light when nothing was chosen', () => {
    expect(readStoredTheme()).toBe('light');
    applyTheme(readStoredTheme());
    expect(html.getAttribute('data-theme')).toBeNull();
    expect(currentTheme()).toBe('light');
  });

  it('reads anything but an explicit "dark" as light', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readStoredTheme()).toBe('light');
  });

  it('setTheme remembers the choice, marks <html> and the browser chrome, and tells subscribers', () => {
    setTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(html.getAttribute('data-theme')).toBe('dark');
    expect(meta.getAttribute('content')).toBe(THEME_COLOR.dark);
    expect(currentTheme()).toBe('dark');
    expect(events).toEqual(['mero-crm:theme-change']);

    setTheme('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(html.getAttribute('data-theme')).toBeNull();
    expect(meta.getAttribute('content')).toBe(THEME_COLOR.light);
  });

  it('still applies the theme when storage throws', () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(readStoredTheme()).toBe('light');
    setTheme('dark');
    expect(html.getAttribute('data-theme')).toBe('dark');
  });

  // The no-flash path: index.html runs this before the bundle loads.
  it("index.html's theme-init script puts a saved dark theme on <html> before the app runs", () => {
    const themeScript = readFileSync(path.resolve(__dirname, '..', 'public', 'theme-init.js'), 'utf-8');
    expect(themeScript).toContain(THEME_STORAGE_KEY);

    new Function(themeScript)();
    expect(html.getAttribute('data-theme')).toBeNull();

    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(themeScript)();
    expect(html.getAttribute('data-theme')).toBe('dark');
    expect(meta.getAttribute('content')).toBe(THEME_COLOR.dark);
  });
});
