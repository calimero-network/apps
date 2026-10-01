import { describe, expect, it } from 'vitest';
import { nameCollator } from '../collate';

describe('nameCollator', () => {
  it('ignores case but not accents', () => {
    expect(nameCollator.compare('plan', 'Plan')).toBe(0);
    expect(nameCollator.compare('resume', 'résumé')).not.toBe(0);
    expect(nameCollator.compare('apple', 'Banana')).toBeLessThan(0);
  });
});
