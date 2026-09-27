import { describe, it, expect } from 'vitest';
import { folderLabel } from '../folderLabel';

describe('folderLabel', () => {
  it('prefers the name', () => {
    expect(folderLabel('Plans')).toBe('Plans');
  });

  it('falls back to a plain label, never the id', () => {
    expect(folderLabel()).toBe('Untitled folder');
    expect(folderLabel(null)).toBe('Untitled folder');
    expect(folderLabel('  ')).toBe('Untitled folder');
  });
});
