import { describe, expect, it } from 'vitest';
import {
  foldForSearch,
  matchRanges,
  matchScore,
  normalizeQuery,
  QUERY_MAX,
} from '../match';

function marked(text: string, ranges: [number, number][]): string[] {
  return ranges.map(([a, b]) => text.slice(a, b));
}

describe('foldForSearch', () => {
  it('folds case, accents and width (S-05)', () => {
    expect(foldForSearch('Résumé')).toBe('resume');
    expect(foldForSearch('ROAD')).toBe('road');
    expect(foldForSearch('ＲＯＡＤ')).toBe('road');
    expect(foldForSearch('İstanbul')).toBe('istanbul');
  });

  it('leaves non-latin text and emoji intact (S-06)', () => {
    expect(foldForSearch('日本')).toBe('日本');
    expect(foldForSearch('🚀 Launch')).toBe('🚀 launch');
  });
});

describe('normalizeQuery', () => {
  it('trims', () => {
    expect(normalizeQuery('  road  ')).toEqual({
      text: 'road',
      tagsOnly: false,
    });
  });

  it('treats spaces or punctuation alone as empty (S-07)', () => {
    expect(normalizeQuery('   ')).toEqual({ text: '', tagsOnly: false });
    expect(normalizeQuery(' .,;!? ')).toEqual({ text: '', tagsOnly: false });
    expect(normalizeQuery('🚀')).toEqual({ text: '🚀', tagsOnly: false });
  });

  it('cuts to QUERY_MAX without splitting a surrogate pair (S-08)', () => {
    expect(normalizeQuery('a'.repeat(500)).text).toHaveLength(QUERY_MAX);
    const cut = normalizeQuery('a'.repeat(QUERY_MAX - 1) + '🚀').text;
    expect(cut).toBe('a'.repeat(QUERY_MAX - 1));
  });

  it('switches to tags only on a leading # (S-09)', () => {
    expect(normalizeQuery('#launch')).toEqual({
      text: 'launch',
      tagsOnly: true,
    });
    expect(normalizeQuery(' # ')).toEqual({ text: '', tagsOnly: true });
    expect(normalizeQuery('road #1')).toEqual({
      text: 'road #1',
      tagsOnly: false,
    });
  });
});

describe('matchRanges', () => {
  it('marks every match on the original text', () => {
    expect(matchRanges('Road to the road', 'road')).toEqual([
      [0, 4],
      [12, 16],
    ]);
  });

  it('returns nothing for an empty or missing query', () => {
    expect(matchRanges('Road', '')).toEqual([]);
    expect(matchRanges('Road', 'x')).toEqual([]);
  });

  it('maps through accents that fold to fewer code units (S-05)', () => {
    const text = 'Mon Résumé';
    expect(marked(text, matchRanges(text, 'resume'))).toEqual(['Résumé']);
    const decomposed = 'Résumé draft';
    expect(matchRanges(decomposed, 'resume')).toEqual([[0, 8]]);
    expect(matchRanges(decomposed, 'draft')).toEqual([[9, 14]]);
  });

  it('maps through characters that fold to more code units', () => {
    const text = 'x ﬁle';
    expect(marked(text, matchRanges(text, 'file'))).toEqual(['ﬁle']);
  });

  it('never splits a surrogate pair (S-06)', () => {
    const text = 'Go 🚀 launch 日本';
    expect(marked(text, matchRanges(text, '🚀'))).toEqual(['🚀']);
    expect(marked(text, matchRanges(text, '日本'))).toEqual(['日本']);
    expect(matchRanges(text, 'launch')).toEqual([[6, 12]]);
    expect(matchRanges('🚀', '\ud83d')).toEqual([[0, 2]]);
  });

  it('agrees with foldForSearch on a word-final sigma', () => {
    expect(foldForSearch('ΟΔΟΣ ΜΑΣ')).toBe(foldForSearch('οδοσ μασ'));
    expect(matchRanges('ΟΔΟΣ ΜΑΣ', 'οδος')).toEqual([[0, 4]]);
    expect(matchRanges('οδός', 'ΟΔΟΣ')).toEqual([[0, 4]]);
  });

  it('folds astral characters as whole code points', () => {
    expect(matchRanges('𝐀𝐁 x', 'ab')).toEqual([[0, 4]]);
  });

  it('folds the query the same way as the text', () => {
    expect(matchRanges('road map', 'ROAD')).toEqual([[0, 4]]);
  });
});

describe('matchScore', () => {
  it('ranks prefix, then word start, then substring', () => {
    expect(matchScore('roadmap', 'road')).toBe(0);
    expect(matchScore('the road', 'road')).toBe(1);
    expect(matchScore('old-road', 'road')).toBe(1);
    expect(matchScore('railroad', 'road')).toBe(2);
    expect(matchScore('rail', 'road')).toBeNull();
  });

  it('prefers a later word start over an earlier substring', () => {
    expect(matchScore('railroad road', 'road')).toBe(1);
  });
});
