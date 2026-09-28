import { describe, it, expect } from 'vitest';
import { keyLabels } from '../platform';

describe('keyLabels', () => {
  it('names ⌘ on Apple devices', () => {
    for (const ua of [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
    ]) {
      expect(keyLabels(ua)).toEqual({ search: '⌘K', newTab: '⌘↵' });
    }
  });

  it('names Ctrl everywhere else', () => {
    for (const ua of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Mozilla/5.0 (X11; Linux x86_64)',
      '',
    ]) {
      expect(keyLabels(ua)).toEqual({ search: 'Ctrl K', newTab: 'Ctrl ↵' });
    }
  });
});
