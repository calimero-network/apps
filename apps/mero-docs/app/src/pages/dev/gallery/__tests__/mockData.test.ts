import { describe, it, expect } from 'vitest';
import { DOCS, FOLDERS, TAGS, WORKSPACE_NAME } from '../mockData';

describe('mockData', () => {
  it('has the mockup workspace name', () => {
    expect(WORKSPACE_NAME).toBe('Acme Product');
  });

  it('has 10 docs and 8 tags', () => {
    expect(DOCS).toHaveLength(10);
    expect(TAGS).toHaveLength(8);
  });

  it('nests Specs under Engineering', () => {
    const specs = FOLDERS.find((f) => f.name === 'Specs');
    expect(specs?.parent).toBe('Engineering');
  });
});
