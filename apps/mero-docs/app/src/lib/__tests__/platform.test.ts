import { describe, it, expect } from 'vitest';
import { shortcutLabel } from '../platform';

describe('shortcutLabel', () => {
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

  it('uses modifier symbols on Apple devices', () => {
    expect(shortcutLabel('Mod-Alt-1', MAC)).toBe('⌘⌥1');
    expect(shortcutLabel('Mod-Shift-8', MAC)).toBe('⌘⇧8');
    expect(shortcutLabel('Mod-Alt-c', MAC)).toBe('⌘⌥C');
    expect(shortcutLabel('Mod-K', MAC)).toBe('⌘K');
    expect(shortcutLabel('Mod-↵', MAC)).toBe('⌘↵');
  });

  it('spells modifiers out everywhere else', () => {
    expect(shortcutLabel('Mod-Alt-1', WINDOWS)).toBe('Ctrl Alt 1');
    expect(shortcutLabel('Mod-Shift-8', WINDOWS)).toBe('Ctrl Shift 8');
    expect(shortcutLabel('Mod-Alt-c', '')).toBe('Ctrl Alt C');
    expect(shortcutLabel('Mod-K', WINDOWS)).toBe('Ctrl K');
    expect(shortcutLabel('Mod-↵', WINDOWS)).toBe('Ctrl ↵');
  });
});
