import { describe, it, expect } from 'vitest';
import { initials } from '../initials';

describe('initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Acme Product Team')).toBe('AP');
  });

  it('takes the first two letters of a single word', () => {
    expect(initials('  bob ')).toBe('BO');
  });
});
