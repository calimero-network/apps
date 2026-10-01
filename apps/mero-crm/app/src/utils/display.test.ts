import { describe, it, expect } from 'vitest';
import { avatarColor, labelColor, initial, truncateKey, relativeTime, formatDate } from './display';

describe('display helpers', () => {
  it('avatarColor is deterministic and a hex swatch', () => {
    expect(avatarColor('ronit')).toBe(avatarColor('ronit'));
    expect(avatarColor('ronit')).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('labelColor is stable per label', () => {
    expect(labelColor('sync')).toBe(labelColor('sync'));
  });

  it('initial is the lowercased first char', () => {
    expect(initial('Ronit')).toBe('r');
    expect(initial('  ')).toBe('?');
  });

  it('truncateKey keeps short strings and shortens long keys', () => {
    expect(truncateKey('ronit')).toBe('ronit');
    expect(truncateKey('4f8a2c9e1234c2e14f8a2c9e1234c2e1')).toBe('4f8a…c2e1');
  });

  it('truncateKey leaves an alias-length display string unchanged', () => {
    expect(truncateKey('alexander-dev')).toBe('alexander-dev');
  });

  it('relativeTime is compact and unit-aware', () => {
    const now = 10_000_000_000_000;
    expect(relativeTime(now, now)).toBe('now');
    expect(relativeTime(now - 2 * 3600_000, now)).toBe('2h');
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe('3d');
    // seconds-based epoch is upscaled to ms
    expect(relativeTime((now - 3600_000) / 1000, now)).toBe('1h');
  });

  it('formatDate handles empty', () => {
    expect(formatDate(0)).toBe('-');
    expect(formatDate(1_700_000_000_000)).toMatch(/\d{4}/);
  });
});
