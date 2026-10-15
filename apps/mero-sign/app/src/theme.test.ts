import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Node environment (no jsdom): just enough of a page for the theme store —
// <html> with attributes, one theme-color meta, localStorage and window events.
class FakeElement {
  attrs = new Map<string, string>();
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
}
const html = new FakeElement();
const meta = new FakeElement();
const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.document = {
  documentElement: html,
  querySelectorAll: (selector: string) =>
    selector === 'meta[name="theme-color"]' ? [meta] : [],
};
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
g.window = new EventTarget();

const {
  THEME_COLOR,
  THEME_STORAGE_KEY,
  applyTheme,
  currentTheme,
  readStoredTheme,
  setTheme,
  toggleTheme,
} = await import('./theme');

beforeEach(() => {
  store.clear();
  html.attrs.clear();
  meta.attrs.clear();
});

describe('theme', () => {
  it('is light unless dark was chosen', () => {
    expect(readStoredTheme()).toBe('light');
    store.set(THEME_STORAGE_KEY, 'something else');
    expect(readStoredTheme()).toBe('light');
    store.set(THEME_STORAGE_KEY, 'dark');
    expect(readStoredTheme()).toBe('dark');
  });

  it('is remembered under a key of its own, not one shared with other apps', () => {
    expect(THEME_STORAGE_KEY).toBe('mero-sign:theme');
  });

  it('puts the theme on <html> and the browser chrome', () => {
    applyTheme('dark');
    expect(html.getAttribute('data-theme')).toBe('dark');
    expect(meta.getAttribute('content')).toBe(THEME_COLOR.dark);
    expect(currentTheme()).toBe('dark');
    applyTheme('light');
    expect(html.getAttribute('data-theme')).toBe('light');
    expect(meta.getAttribute('content')).toBe(THEME_COLOR.light);
  });

  it('toggles, remembers the choice and tells every subscriber', () => {
    let heard = 0;
    window.addEventListener('mero-sign:theme-change', () => heard++);
    applyTheme('light');
    toggleTheme();
    expect(currentTheme()).toBe('dark');
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark');
    toggleTheme();
    expect(currentTheme()).toBe('light');
    expect(store.get(THEME_STORAGE_KEY)).toBe('light');
    setTheme('dark');
    expect(heard).toBe(3);
  });

  it('index.html applies the same key and colours before the app loads', () => {
    const page = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    expect(page).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    expect(page).toContain(`content="${THEME_COLOR.light}"`);
    expect(page).toContain(`'${THEME_COLOR.dark}'`);
    // Before the module script, or it is not "before the first paint".
    expect(page.indexOf(THEME_STORAGE_KEY)).toBeLessThan(
      page.indexOf('src="./src/main.tsx"'),
    );
  });
});
