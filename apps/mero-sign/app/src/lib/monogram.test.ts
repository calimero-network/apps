import { describe, expect, it } from 'vitest';
import { hueOf, initials } from './monogram';

describe('monogram', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Acme Legal')).toBe('AL');
    expect(initials('fundraising')).toBe('F');
    expect(initials('Contractor agreement — R. Patel')).toBe('CA');
    expect(initials('  ')).toBe('·');
  });

  it('gives a name the same hue every time, within the colour wheel', () => {
    expect(hueOf('Acme Legal')).toBe(hueOf('Acme Legal'));
    for (const name of ['', 'a', 'Acme Legal', 'Series A term sheet']) {
      const h = hueOf(name);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});
