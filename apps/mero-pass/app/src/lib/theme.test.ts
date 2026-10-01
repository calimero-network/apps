import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME,
  THEME_KEY,
  applyTheme,
  chooseTheme,
  currentTheme,
  getStoredTheme,
} from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('defaults to dark without reading the OS preference', () => {
    expect(DEFAULT_THEME).toBe('dark');
    expect(getStoredTheme()).toBe('dark');
  });

  it('applying a theme does not save it', () => {
    applyTheme('light');
    expect(currentTheme()).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('choosing a theme saves and applies it', () => {
    chooseTheme('light');
    expect(currentTheme()).toBe('light');
    expect(getStoredTheme()).toBe('light');
  });

  it('ignores a stored value it does not know', () => {
    localStorage.setItem(THEME_KEY, 'sepia');
    expect(getStoredTheme()).toBe('dark');
  });
});
