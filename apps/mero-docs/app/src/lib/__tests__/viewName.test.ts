import { describe, expect, it } from 'vitest';
import { cutViewName, viewNameFits } from '../viewName';

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('viewNameFits', () => {
  it('counts UTF-8 bytes of the trimmed name, as the registry does', () => {
    expect(viewNameFits('a'.repeat(60))).toBe(true);
    expect(viewNameFits('a'.repeat(61))).toBe(false);
    expect(viewNameFits(`  ${'a'.repeat(60)}  `)).toBe(true);
    expect(viewNameFits('名'.repeat(20))).toBe(true); // 60 bytes
    expect(viewNameFits('名'.repeat(21))).toBe(false); // 21 characters, 63 bytes
    expect(viewNameFits('😀'.repeat(16))).toBe(false); // 32 UTF-16 units, 64 bytes
  });
});

describe('cutViewName', () => {
  it('leaves a name that fits alone', () => {
    expect(cutViewName('Design, Q3')).toBe('Design, Q3');
  });

  it('cuts to 60 bytes on a whole character, never half an emoji', () => {
    const cut = cutViewName('😀'.repeat(20));
    expect(cut).toBe('😀'.repeat(15));
    expect(cutViewName(`a${'😀'.repeat(20)}`)).toBe(`a${'😀'.repeat(14)}`);
    expect(bytes(cutViewName('名'.repeat(30)))).toBe(60);
  });

  it('drops the separator a cut leaves at the end', () => {
    expect(cutViewName(`${'a'.repeat(59)}, b`)).toBe('a'.repeat(59));
  });
});
