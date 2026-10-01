import { describe, it, expect } from 'vitest';
import { namespaceLabel } from '../namespaceLabel';

describe('namespaceLabel', () => {
  it('prefers the name', () => {
    expect(namespaceLabel('Acme')).toBe('Acme');
  });

  it('falls back to a plain label, never the id', () => {
    expect(namespaceLabel()).toBe('Untitled workspace');
    expect(namespaceLabel(null)).toBe('Untitled workspace');
    expect(namespaceLabel('  ')).toBe('Untitled workspace');
  });
});
