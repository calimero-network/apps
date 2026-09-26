import { describe, it, expect } from 'vitest';
import { namespaceLabel } from '../namespaceLabel';

describe('namespaceLabel', () => {
  it('prefers the name', () => {
    expect(namespaceLabel('0123456789abcdef', 'Acme')).toBe('Acme');
  });

  it('falls back to the first 8 id characters', () => {
    expect(namespaceLabel('0123456789abcdef')).toBe('01234567');
    expect(namespaceLabel('0123456789abcdef', null)).toBe('01234567');
  });
});
