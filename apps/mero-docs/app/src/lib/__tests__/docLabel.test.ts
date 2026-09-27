import { describe, expect, it } from 'vitest';
import { docLabel, UNTITLED_DOC_LABEL } from '../docLabel';

describe('docLabel', () => {
  it('shows the title, or Untitled when it is blank', () => {
    expect(docLabel('Roadmap')).toBe('Roadmap');
    expect(docLabel('')).toBe(UNTITLED_DOC_LABEL);
    expect(docLabel('   ')).toBe(UNTITLED_DOC_LABEL);
    expect(docLabel(undefined)).toBe(UNTITLED_DOC_LABEL);
    expect(UNTITLED_DOC_LABEL).toBe('Untitled');
  });
});
